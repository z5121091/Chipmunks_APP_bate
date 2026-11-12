"""Warehouse export destinations shared by the roster and workbook routes."""

import hashlib
import json
import os
import re
import tempfile
import threading
from pathlib import Path


WAREHOUSE_ARCHIVE_API_VERSION = 1
DOCUMENT_FOLDERS = {
    'outbound': '扫码出库订单',
    'inbound': '扫码入库订单',
    'inventory': '库存盘点单',
}
_REGISTRY_NAME = '.warehouse-archive.json'
_ARCHIVE_LOCK = threading.Lock()
_INVALID_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_DEVICE = re.compile(r'CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³]', re.IGNORECASE)
_MAX_FOLDER_LENGTH = 64


def warehouse_name(value):
    name = value.strip() if isinstance(value, str) else ''
    if not name or len(name) > 255:
        raise ValueError('仓库名称为空或过长')
    name.encode('utf-8')
    return name


def _safe_folder(name):
    folder = _INVALID_CHARS.sub('_', name)[:_MAX_FOLDER_LENGTH].rstrip(' .') or '仓库'
    if _WINDOWS_DEVICE.fullmatch(folder.split('.', 1)[0].rstrip()):
        folder = f'仓库_{folder}'[:_MAX_FOLDER_LENGTH].rstrip(' .')
    return folder


def _checked_child(parent, name):
    child = parent / name
    if child.parent != parent or child.resolve() != child:
        raise OSError('仓库归档目录包含无效路径或目录链接')
    return child


def _read_registry(path):
    if not path.exists():
        return {}
    try:
        registry = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(registry, dict):
            raise ValueError('registry must be an object')
        if any(warehouse_name(name) != name or not isinstance(folder, str) or
               not folder or _safe_folder(folder) != folder or
               folder.casefold() == _REGISTRY_NAME.casefold()
               for name, folder in registry.items()):
            raise ValueError('invalid warehouse directory mapping')
        if len({folder.casefold() for folder in registry.values()}) != len(registry):
            raise ValueError('duplicate warehouse directory mapping')
        return registry
    except (UnicodeError, ValueError) as error:
        raise OSError('仓库归档目录登记文件无效') from error


def _write_registry(path, registry):
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode='w', encoding='utf-8', dir=path.parent, prefix='.warehouse-archive-',
            suffix='.tmp', delete=False,
        ) as output:
            temp_path = Path(output.name)
            json.dump(registry, output, ensure_ascii=False, indent=2)
        os.replace(temp_path, path)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def _allocate_folder(name, occupied):
    base = _safe_folder(name)
    # Invalid or truncated names get their own stable spelling, keeping the clean
    # spelling available to a warehouse whose actual name matches it.
    if base == name and base.casefold() not in occupied and not base.casefold().endswith(('.xlsx', '.json')):
        return base
    digest = hashlib.sha256(name.encode('utf-8')).hexdigest()
    for length in (8, 12, 16, 24, 32):
        suffix = f' ({digest[:length]})'
        candidate = f'{base[:_MAX_FOLDER_LENGTH - len(suffix)].rstrip(" .")}{suffix}'
        if candidate.casefold() not in occupied:
            return candidate
    raise OSError('无法为该仓库分配归档目录')


def ensure_warehouse_folders(data_root, names):
    """Create missing folders. The exact display name is shared by PDA and ERP records."""
    names = list(dict.fromkeys(warehouse_name(name) for name in names))
    if not names:
        return {}

    with _ARCHIVE_LOCK:
        root = Path(data_root).resolve()
        root.mkdir(parents=True, exist_ok=True)
        registry_path = _checked_child(root, _REGISTRY_NAME)
        registry = _read_registry(registry_path)
        added_names = [name for name in names if name not in registry]
        if added_names:
            occupied = {child.name.casefold() for child in root.iterdir()}
            occupied.update(folder.casefold() for folder in registry.values())
            occupied.add(_REGISTRY_NAME.casefold())
            for name in added_names:
                registry[name] = _allocate_folder(name, occupied)
                occupied.add(registry[name].casefold())

        folders = {name: _checked_child(root, registry[name]) for name in names}
        children = [
            _checked_child(folder, category)
            for folder in folders.values()
            for category in DOCUMENT_FOLDERS.values()
        ]
        # Commit assignments before creating directories so an interrupted mkdir
        # can retry with the same names rather than allocating alternate folders.
        if added_names:
            _write_registry(registry_path, registry)
        for folder in children:
            folder.mkdir(parents=True, exist_ok=True)
        return folders


def get_document_save_path(data_root, filename, document_type, name=''):
    if isinstance(name, str) and not name.strip():
        return os.path.join(data_root, filename)
    name = warehouse_name(name)
    root = ensure_warehouse_folders(data_root, [name])[name]
    return str(_checked_child(root / DOCUMENT_FOLDERS[document_type], filename))
