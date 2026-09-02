from .apm import build_native_apm_label
from .boya import build_native_boya_label
from .common import get_excel_cell_text


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

NATIVE_LABEL_TEMPLATE_BY_SUPPLIER = {
    '珠海极海半导体有限公司': NATIVE_LABEL_TEMPLATE_GEEHY,
    '珠海领芯科技有限公司': NATIVE_LABEL_TEMPLATE_LEADCORE,
    '珠海博雅科技股份有限公司': NATIVE_LABEL_TEMPLATE_BOYA,
}


def get_native_label_template(record):
    supplier = get_excel_cell_text(record.get('supplier')).strip()
    return NATIVE_LABEL_TEMPLATE_BY_SUPPLIER.get(supplier)


def build_native_label(record, template):
    return template['builder'](record, template)
