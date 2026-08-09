from __future__ import annotations

import copy
import json
import os
import re
import shutil
import sys
import uuid
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = 1
DEFAULT_TEMPLATE_REVISION = 2
DEFAULT_TEMPLATE_ID = 'apm-default'
SETTINGS_FILE_NAME = 'settings.json'

BUILTIN_FIELDS: tuple[tuple[str, str], ...] = (
    ('warehouse_name', '仓库名称'),
    ('label_type', '标签类型'),
    ('order_no', '订单号'),
    ('customer_name', '客户名称'),
    ('inventory_code', '存货编码'),
    ('model', '型号'),
    ('version', '版本号'),
    ('display_version', '显示版本号'),
    ('part_number', '标签料号'),
    ('scan_identifier', '二维码版本/料号'),
    ('package', '封装'),
    ('batch', '批次'),
    ('original_quantity', '原数量'),
    ('quantity', '标签数量'),
    ('production_date', '生产日期'),
    ('trace_no', '追溯码'),
    ('source_no', '箱号'),
    ('unpacked_at', '拆包时间'),
)

FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    'warehouse_name': ('warehouse_name', '仓库名称', '仓库'),
    'label_type': ('label_type', '标签类型'),
    'order_no': ('order_no', '订单号', '出库单号'),
    'customer_name': ('customer_name', '客户名称', '客户'),
    'inventory_code': ('inventory_code', '存货编码'),
    'model': ('model', '型号', '规格型号'),
    'version': ('version', '版本号', '版本'),
    'package': ('package', '封装'),
    'batch': ('batch', '批次'),
    'original_quantity': ('original_quantity', '原数量'),
    'quantity': ('quantity', 'new_quantity', '标签数量', '数量'),
    'production_date': ('production_date', 'productionDate', '生产日期'),
    'trace_no': ('trace_no', 'new_traceNo', 'traceNo', '追溯码'),
    'source_no': ('source_no', 'sourceNo', '箱号'),
    'unpacked_at': ('unpacked_at', '拆包时间'),
}

ELEMENT_TYPES = {'text', 'barcode', 'qrcode', 'image'}
CONTENT_MODES = {'fixed', 'linked'}
HORIZONTAL_ALIGNMENTS = {'left', 'center', 'right'}
VERTICAL_ALIGNMENTS = {'top', 'middle', 'bottom'}
QR_ECC_LEVELS = {'L', 'M', 'Q', 'H'}
QR_MODELS = {'M2'}
QR_MASKS = {f'S{index}' for index in range(9)}


def resource_path(relative_path: str) -> Path:
    base_path = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
    return (base_path / relative_path).resolve()


def get_default_template_directory() -> Path:
    configured = os.environ.get('PALM_WAREHOUSE_TEMPLATE_DIR', '').strip()
    if configured:
        return Path(configured).expanduser().resolve()

    data_root = os.environ.get('PALM_WAREHOUSE_SYNC_DIR', '').strip()
    if data_root:
        return (Path(data_root).expanduser().resolve() / 'label-templates')

    if Path('D:/').is_dir():
        return Path('D:/数据同步/label-templates')
    return Path.home() / 'Documents' / '掌上仓库同步' / 'label-templates'


def normalize_text(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return ' '.join(str(value).replace('\r', ' ').replace('\n', ' ').split())


def normalize_record(record: dict[str, Any] | None) -> dict[str, str]:
    source = record or {}
    normalized = {str(key): normalize_text(value) for key, value in source.items()}
    for field_key, aliases in FIELD_ALIASES.items():
        if normalized.get(field_key):
            continue
        for alias in aliases:
            value = normalized.get(alias)
            if value:
                normalized[field_key] = value
                break
        normalized.setdefault(field_key, '')
    raw_version = normalized.get('version', '')
    inventory_code = normalized.get('inventory_code', '')
    version_is_apm_part_number = len(raw_version) == 12 and raw_version.isdigit()
    if not normalized.get('display_version'):
        normalized['display_version'] = '' if version_is_apm_part_number else raw_version
    if not normalized.get('part_number'):
        normalized['part_number'] = raw_version if version_is_apm_part_number else inventory_code
    # 二维码中的这一段只代表真实版本/料号来源。版本为空时必须留空，
    # 不能回退到存货编码，否则扫码后会把存货编码误识别成版本号。
    if not normalized.get('scan_identifier'):
        normalized['scan_identifier'] = raw_version
    return normalized


def make_element_id(prefix: str = 'element') -> str:
    normalized_prefix = re.sub(r'[^a-zA-Z0-9_-]+', '-', prefix).strip('-') or 'element'
    return f'{normalized_prefix}-{uuid.uuid4().hex[:10]}'


def make_template_id(name: str) -> str:
    ascii_slug = re.sub(r'[^a-zA-Z0-9_-]+', '-', name).strip('-').lower()
    return f'{ascii_slug or "template"}-{uuid.uuid4().hex[:8]}'


def _require_number(value: Any, label: str, minimum: float, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f'{label}必须是数字') from error
    if number < minimum or number > maximum:
        raise ValueError(f'{label}必须在 {minimum:g} 至 {maximum:g} 之间')
    return number


def _validate_content(content: Any, label: str) -> None:
    if not isinstance(content, dict):
        raise ValueError(f'{label}缺少内容配置')
    mode = content.get('mode', 'fixed')
    if mode not in CONTENT_MODES:
        raise ValueError(f'{label}内容方式无效')
    if mode == 'linked' and not normalize_text(content.get('field')):
        raise ValueError(f'{label}必须选择关联字段')


def validate_template(template: Any) -> dict[str, Any]:
    if not isinstance(template, dict):
        raise ValueError('模板必须是 JSON 对象')
    if int(template.get('schemaVersion', 0)) != SCHEMA_VERSION:
        raise ValueError(f'暂不支持模板版本：{template.get("schemaVersion")}')
    if not normalize_text(template.get('id')):
        raise ValueError('模板缺少 ID')
    if not normalize_text(template.get('name')):
        raise ValueError('模板名称不能为空')

    label = template.get('label')
    if not isinstance(label, dict):
        raise ValueError('模板缺少纸张设置')
    _require_number(label.get('widthMm'), '纸张宽度', 10, 300)
    _require_number(label.get('heightMm'), '纸张高度', 10, 300)
    if label.get('widthDots') is not None:
        _require_number(label.get('widthDots'), '纸张点阵宽度', 80, 10000)
    if label.get('heightDots') is not None:
        _require_number(label.get('heightDots'), '纸张点阵高度', 80, 10000)
    dpi = int(_require_number(label.get('dpi', 203), '打印精度', 100, 1200))
    if dpi not in {203, 300, 600}:
        raise ValueError('打印精度仅支持 203、300 或 600 DPI')
    _require_number(label.get('copies', 1), '打印份数', 1, 100)
    _require_number(label.get('gapMm', 0), '标签间距', 0, 50)

    elements = template.get('elements')
    if not isinstance(elements, list):
        raise ValueError('模板元素必须是数组')
    element_ids: set[str] = set()
    for index, element in enumerate(elements, start=1):
        element_label = f'第 {index} 个元素'
        if not isinstance(element, dict):
            raise ValueError(f'{element_label}格式无效')
        element_id = normalize_text(element.get('id'))
        if not element_id:
            raise ValueError(f'{element_label}缺少 ID')
        if element_id in element_ids:
            raise ValueError(f'元素 ID 重复：{element_id}')
        element_ids.add(element_id)
        element_type = element.get('type')
        if element_type not in ELEMENT_TYPES:
            raise ValueError(f'{element_label}类型无效：{element_type}')
        _require_number(element.get('x', 0), f'{element_label} X', 0, 10000)
        _require_number(element.get('y', 0), f'{element_label} Y', 0, 10000)
        _require_number(element.get('width', 1), f'{element_label}宽度', 1, 10000)
        _require_number(element.get('height', 1), f'{element_label}高度', 1, 10000)

        if element_type in {'text', 'barcode'}:
            _validate_content(element.get('content'), element_label)
        if element_type == 'text':
            if element.get('horizontalAlign', 'left') not in HORIZONTAL_ALIGNMENTS:
                raise ValueError(f'{element_label}水平对齐方式无效')
            if element.get('verticalAlign', 'top') not in VERTICAL_ALIGNMENTS:
                raise ValueError(f'{element_label}垂直对齐方式无效')
            _require_number(element.get('fontSizePt', 8), f'{element_label}字号', 4, 96)
        elif element_type == 'barcode':
            _require_number(element.get('heightDots', element.get('height', 32)), f'{element_label}条码高度', 4, 1000)
            _require_number(element.get('narrowDots', 1), f'{element_label}模块宽度', 1, 10)
            _require_number(element.get('wideDots', 1), f'{element_label}宽条宽度', 1, 10)
        elif element_type == 'qrcode':
            segments = element.get('segments')
            if not isinstance(segments, list) or not segments:
                raise ValueError(f'{element_label}至少需要一个二维码内容段')
            for segment_index, segment in enumerate(segments, start=1):
                _validate_content(segment, f'{element_label}二维码第 {segment_index} 段')
            _require_number(element.get('cellDots', 4), f'{element_label}二维码单元', 1, 10)
            if element.get('ecc', 'L') not in QR_ECC_LEVELS:
                raise ValueError(f'{element_label}二维码纠错等级无效')
            if element.get('model', 'M2') not in QR_MODELS:
                raise ValueError(f'{element_label}二维码型号无效')
            if element.get('mask', 'S7') not in QR_MASKS:
                raise ValueError(f'{element_label}二维码掩码无效')
        elif element_type == 'image' and not normalize_text(element.get('path')):
            raise ValueError(f'{element_label}缺少图片路径')

    return template


def resolve_content(content: dict[str, Any], record: dict[str, str]) -> str:
    mode = content.get('mode', 'fixed')
    if mode == 'linked':
        field = normalize_text(content.get('field'))
        value = record.get(field, '')
        if not value and field in FIELD_ALIASES:
            for alias in FIELD_ALIASES[field]:
                if record.get(alias):
                    value = record[alias]
                    break
        if not value:
            value = normalize_text(content.get('fallback'))
        if content.get('required') and not value:
            raise ValueError(f'关联字段“{field}”没有数据')
        return value
    return normalize_text(content.get('value'))


def build_qr_content(element: dict[str, Any], record: dict[str, Any]) -> str:
    normalized_record = normalize_record(record)
    values = [resolve_content(segment, normalized_record) for segment in element.get('segments', [])]
    if element.get('skipEmpty', True):
        values = [value for value in values if value]
    delimiter = str(element.get('delimiter', '/'))
    prefix = str(element.get('prefix', ''))
    suffix = str(element.get('suffix', ''))
    return f'{prefix}{delimiter.join(values)}{suffix}'


def get_template_sample_record(template: dict[str, Any]) -> dict[str, str]:
    values = template.get('sampleValues')
    return normalize_record(values if isinstance(values, dict) else {})


class TemplateStore:
    def __init__(self, directory: str | Path | None = None):
        self.directory = Path(directory).expanduser().resolve() if directory else get_default_template_directory()
        self.builtin_template_path = resource_path('templates/apm-default.json')

    @property
    def settings_path(self) -> Path:
        return self.directory / SETTINGS_FILE_NAME

    def ensure_ready(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        default_target = self.directory / f'{DEFAULT_TEMPLATE_ID}.json'
        if not default_target.exists():
            shutil.copy2(self.builtin_template_path, default_target)
        if not self.settings_path.exists():
            self._write_json_atomic(self.settings_path, {'activeTemplateId': DEFAULT_TEMPLATE_ID})

    def list_templates(self) -> list[dict[str, Any]]:
        self.ensure_ready()
        templates: list[dict[str, Any]] = []
        for path in sorted(self.directory.glob('*.json')):
            if path.name == SETTINGS_FILE_NAME:
                continue
            try:
                template = self.load_path(path)
            except Exception:
                continue
            templates.append(template)
        return sorted(templates, key=lambda item: normalize_text(item.get('name')).lower())

    def get_active_template_id(self) -> str:
        self.ensure_ready()
        try:
            settings = json.loads(self.settings_path.read_text(encoding='utf-8'))
            template_id = normalize_text(settings.get('activeTemplateId'))
            return template_id or DEFAULT_TEMPLATE_ID
        except Exception:
            return DEFAULT_TEMPLATE_ID

    def set_active_template_id(self, template_id: str) -> None:
        normalized_id = normalize_text(template_id)
        if not normalized_id:
            raise ValueError('活动模板 ID 不能为空')
        self.load(normalized_id)
        self._write_json_atomic(self.settings_path, {'activeTemplateId': normalized_id})

    def load_active(self) -> dict[str, Any]:
        try:
            return self.load(self.get_active_template_id())
        except Exception:
            return self.load(DEFAULT_TEMPLATE_ID)

    def load(self, template_id: str) -> dict[str, Any]:
        self.ensure_ready()
        normalized_id = normalize_text(template_id)
        path = self.directory / f'{normalized_id}.json'
        return self.load_path(path)

    def load_path(self, path: Path) -> dict[str, Any]:
        template = json.loads(path.read_text(encoding='utf-8'))
        template, migrated = self._migrate_template(template)
        validate_template(template)
        if migrated and path.resolve() != self.builtin_template_path.resolve():
            self._write_json_atomic(path, template)
        return template

    @staticmethod
    def _migrate_template(template: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        if template.get('id') != DEFAULT_TEMPLATE_ID:
            return template, False
        revision = int(template.get('templateRevision', 0) or 0)
        if revision >= DEFAULT_TEMPLATE_REVISION:
            return template, False

        migrated = copy.deepcopy(template)
        for element in migrated.get('elements', []):
            if element.get('id') not in {'text-trace', 'text-box'}:
                continue
            if float(element.get('width', 0)) == 220:
                element['width'] = 440
            if element.get('overflow') == 'shrink':
                element['overflow'] = 'clip'
        migrated['templateRevision'] = DEFAULT_TEMPLATE_REVISION
        return migrated, True

    def load_builtin_default(self) -> dict[str, Any]:
        return self.load_path(self.builtin_template_path)

    def save(self, template: dict[str, Any], make_active: bool = True) -> dict[str, Any]:
        self.ensure_ready()
        normalized = copy.deepcopy(template)
        validate_template(normalized)
        template_id = normalize_text(normalized['id'])
        self._write_json_atomic(self.directory / f'{template_id}.json', normalized)
        if make_active:
            self.set_active_template_id(template_id)
        return normalized

    def save_as(self, template: dict[str, Any], name: str) -> dict[str, Any]:
        copied = copy.deepcopy(template)
        copied['id'] = make_template_id(name)
        copied['name'] = normalize_text(name) or '未命名模板'
        for element in copied.get('elements', []):
            element['id'] = make_element_id(element.get('type', 'element'))
        return self.save(copied, make_active=True)

    def restore_default(self) -> dict[str, Any]:
        template = self.load_builtin_default()
        return self.save(template, make_active=True)

    def delete(self, template_id: str) -> None:
        self.ensure_ready()
        normalized_id = normalize_text(template_id)
        if normalized_id == DEFAULT_TEMPLATE_ID:
            raise ValueError('内置 APM 默认模板不能删除')
        path = self.directory / f'{normalized_id}.json'
        if path.exists():
            path.unlink()
        if self.get_active_template_id() == normalized_id:
            self.set_active_template_id(DEFAULT_TEMPLATE_ID)

    @staticmethod
    def _write_json_atomic(path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_name(f'{path.name}.{uuid.uuid4().hex}.tmp')
        try:
            temp_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + '\n',
                encoding='utf-8',
            )
            os.replace(temp_path, path)
        finally:
            if temp_path.exists():
                temp_path.unlink()


def collect_linked_fields(template: dict[str, Any]) -> list[str]:
    fields: list[str] = []
    for element in template.get('elements', []):
        contents: Iterable[dict[str, Any]]
        if element.get('type') == 'qrcode':
            contents = element.get('segments', [])
        elif isinstance(element.get('content'), dict):
            contents = [element['content']]
        else:
            contents = []
        for content in contents:
            if content.get('mode') == 'linked':
                field = normalize_text(content.get('field'))
                if field and field not in fields:
                    fields.append(field)
    return fields
