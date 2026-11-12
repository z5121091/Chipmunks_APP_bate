from .apm import build_native_apm_label
from .boya import build_native_boya_label
from .common import get_excel_cell_text
from .dongwei import build_native_dongwei_label
from .internal import build_native_internal_label, is_internal_label_qr
from .linearin import build_native_linearin_label
from .rongpai import build_native_rongpai_label
from .renmao import build_native_renmao_label
from .union import build_native_union_label
from .wch import build_native_wch_label


NATIVE_LABEL_TEMPLATE_GEEHY = {
    'key': 'geehy',
    'name': '极海',
    'include_logo': True,
    'builder': build_native_apm_label,
}
NATIVE_LABEL_TEMPLATE_LEADCORE = {
    'key': 'leadcore',
    'name': '珠海领芯',
    'include_logo': False,
    'builder': build_native_apm_label,
}
NATIVE_LABEL_TEMPLATE_BOYA = {
    'key': 'boya',
    'name': '珠海博雅',
    'include_logo': True,
    'builder': build_native_boya_label,
}
NATIVE_LABEL_TEMPLATE_UNION = {
    'key': 'union',
    'name': '盈力半导体',
    'include_logo': True,
    'builder': build_native_union_label,
}
NATIVE_LABEL_TEMPLATE_WCH = {
    'key': 'wch',
    'name': '南京沁恒',
    'include_logo': True,
    'builder': build_native_wch_label,
}

NATIVE_LABEL_TEMPLATE_DONGWEI = {
    'key': 'dongwei',
    'name': '苏州东微',
    'include_logo': True,
    'builder': build_native_dongwei_label,
}

NATIVE_LABEL_TEMPLATE_RONGPAI = {
    'key': 'rongpai',
    'name': '荣湃半导体',
    'include_logo': True,
    'builder': build_native_rongpai_label,
}

NATIVE_LABEL_TEMPLATE_LINEARIN = {
    'key': 'linearin',
    'name': '上海先积',
    'include_logo': True,
    'builder': build_native_linearin_label,
}

NATIVE_LABEL_TEMPLATE_RENMAO = {
    'key': 'renmao',
    'name': '广东仁懋',
    'include_logo': True,
    'builder': build_native_renmao_label,
}

NATIVE_LABEL_TEMPLATE_INTERNAL = {
    'key': 'internal',
    'name': '内部标签',
    'builder': build_native_internal_label,
}

NATIVE_LABEL_TEMPLATE_BY_SUPPLIER = {
    '珠海极海半导体有限公司': NATIVE_LABEL_TEMPLATE_GEEHY,
    '珠海领芯科技有限公司': NATIVE_LABEL_TEMPLATE_LEADCORE,
    '珠海博雅科技股份有限公司': NATIVE_LABEL_TEMPLATE_BOYA,
    '盈力半导体(上海)有限公司': NATIVE_LABEL_TEMPLATE_UNION,
    '南京沁恒微电子股份有限公司': NATIVE_LABEL_TEMPLATE_WCH,
    '苏州东微半导体股份有限公司': NATIVE_LABEL_TEMPLATE_DONGWEI,
    '荣湃半导体(上海)有限公司': NATIVE_LABEL_TEMPLATE_RONGPAI,
    '上海先积集成电路有限公司': NATIVE_LABEL_TEMPLATE_LINEARIN,
    '广东仁懋电子有限公司': NATIVE_LABEL_TEMPLATE_RENMAO,
}


def get_native_label_template(record):
    if is_internal_label_qr(record.get('source_qr')):
        return NATIVE_LABEL_TEMPLATE_INTERNAL
    supplier = get_excel_cell_text(record.get('supplier')).strip()
    return NATIVE_LABEL_TEMPLATE_BY_SUPPLIER.get(supplier)


def build_native_label(record, template, source_qr=None):
    if source_qr is None:
        return template['builder'](record, template)
    return template['builder'](record, template, source_qr=source_qr)
