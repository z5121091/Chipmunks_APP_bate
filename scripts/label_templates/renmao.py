"""Renmao's 100 x 50 mm label with the original space-separated QR layout."""

from decimal import Decimal, InvalidOperation

from .code128 import build_reprint_barcode_command
from .common import (
    NATIVE_LABEL_COPIES,
    NATIVE_LABEL_FONT_SIZE_PIXELS,
    build_native_text_bitmap,
    build_reprint_qr_image,
    get_excel_cell_text,
    get_native_arial_font,
    get_native_image_mask,
    get_native_qr_payload,
)


_QR_FIELDS = ('version', 'model', 'package', 'batch', 'quantity', 'production_date', 'source_no')
_FIELD_NAMES = {
    'version': '版本号', 'model': '型号', 'package': '封装', 'batch': '批次',
    'quantity': '数量', 'production_date': '生产日期', 'source_no': '箱号',
}
# Caption, value, and its own barcode occupy one row; the lower right remains
# available for the QR and compliance marks. Date and box stay in QR data only.
_VISIBLE_ROWS = (
    ('version', 'MATERIAL:', 24, 28, 430),
    ('model', 'PART NO:', 24, 138, 430),
    ('package', 'PACKAGE:', 24, 248, 430),
    ('batch', 'LOT NO:', 454, 28, 776),
    ('quantity', 'QTY:', 454, 138, 776),
)


def _safe_field(value, field_name):
    # Spaces are structural delimiters, including at either end of a field.
    # Check before the Excel convenience conversion can strip them away.
    original = value if isinstance(value, str) else get_excel_cell_text(value)
    if ' ' in original:
        raise ValueError(f'仁懋标签{field_name}含二维码分隔符空格，无法完整打印')
    if any(ord(char) < 33 or ord(char) > 126 or char == '"' for char in original):
        raise ValueError(f'仁懋标签{field_name}含无法安全完整打印的字符')
    if len(original) > 1000:
        raise ValueError(f'仁懋标签{field_name}内容超过1000字符，无法完整打印')
    return original


def _quantity(value):
    try:
        quantity = Decimal(value)
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValueError('仁懋标签数量须为有效的正整数') from error
    if (
        not quantity.is_finite() or quantity <= 0
        or quantity > 9007199254740991
        or quantity != quantity.to_integral_value()
    ):
        raise ValueError('仁懋标签数量须为有效的正整数')
    return quantity


def _field_values(record, source_qr=None):
    values = {key: _safe_field(record.get(key), _FIELD_NAMES[key]) for key in _QR_FIELDS}
    for key in _QR_FIELDS:
        if not values[key]:
            raise ValueError(f'仁懋标签缺少{_FIELD_NAMES[key]}')
    quantity = _quantity(values['quantity'])
    if source_qr is None:
        values['quantity'] = format(quantity, 'f').split('.')[0]
        return values

    source = get_native_qr_payload('', source_qr)
    # Accept repeated ASCII space delimiters while retaining the exact source
    # bytes below. A newline/tab is never a second supported separator here.
    segments = [segment for segment in source.split(' ') if segment]
    if len(segments) != 8:
        raise ValueError('仁懋原始二维码须包含完整的八个空格分隔字段')
    if segments[0] != 'B':
        raise ValueError('仁懋原始二维码第1段固定标识应为B')
    original = {}
    for key, segment in zip(_QR_FIELDS, segments[1:]):
        original[key] = _safe_field(segment, _FIELD_NAMES[key])
        matches = (
            _quantity(original[key]) == quantity
            if key == 'quantity' else original[key] == values[key]
        )
        if not matches:
            raise ValueError(f'仁懋原始二维码{_FIELD_NAMES[key]}与解析结果不一致，请核对该字段和解析规则')
    return original


def _check_text(text, width, field_name):
    font = get_native_arial_font(bold=True)
    ink = font.getmask(text, mode='1').getbbox()
    if max(font.getlength(text), ink[2] if ink else 0) > width:
        raise ValueError(f'仁懋标签{field_name}文字超出模板宽度，请核对该字段内容和解析规则')


def build_native_renmao_label(record, _template=None, copies=NATIVE_LABEL_COPIES, source_qr=None):
    values = _field_values(record, source_qr)
    payload = get_native_qr_payload('B ' + ' '.join(values[key] for key in _QR_FIELDS), source_qr)
    font = get_native_arial_font(bold=True)
    text_items = []
    barcode_commands = []
    for key, caption, x, y, right_edge in _VISIBLE_ROWS:
        value_x = x + round(font.getlength(caption)) + 6
        displayed_value = values[key] + (' PCS' if key == 'quantity' else '')
        _check_text(displayed_value, right_edge - value_x, _FIELD_NAMES[key])
        text_items.extend(((x, y, caption, True), (value_x, y, displayed_value, True)))
        text_height = max(
            font.getbbox(caption, anchor='lt')[3],
            font.getbbox(displayed_value, anchor='lt')[3],
        )
        barcode_commands.append(build_reprint_barcode_command(
            values[key], x, y + text_height + 4, 32, 2, right_edge, _FIELD_NAMES[key],
        ))

    qr = build_reprint_qr_image(payload, 144, (446, 202, 644, 394), 466, 222)
    rohs = 'RoHS'
    rohs_x = round((714 + 776 - font.getlength(rohs)) / 2)
    text_items.append((rohs_x, 252, rohs, True, NATIVE_LABEL_FONT_SIZE_PIXELS))
    images = (
        (qr.image, (qr.x, qr.y)),
        (get_native_image_mask('pb-logo.png', 56, 56), (650, 210)),
        (get_native_image_mask('renmao-logo.png', 136), (642, 310)),
    )
    # Black monochrome check mark and two unobtrusive lower stripes echo the
    # original blue/green label. No QC stamp is reproduced.
    lines = (
        (((723, 224), (736, 237), (764, 207)), 6),
        (((24, 380), (430, 380)), 5),
        (((650, 380), (776, 380)), 5),
    )
    setup = b'SIZE 100 mm,50 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n'
    commands = '\r\n'.join((*barcode_commands, f'PRINT 1,{copies}', '')).encode('ascii')
    return setup + build_native_text_bitmap(text_items, images, line_items=lines) + commands
