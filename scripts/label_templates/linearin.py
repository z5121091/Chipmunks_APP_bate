from decimal import Decimal, InvalidOperation

from .common import (
    NATIVE_LABEL_COPIES,
    assert_native_text_width,
    build_native_text_bitmap,
    build_reprint_qr_image,
    get_excel_cell_text,
    get_native_arial_font,
    get_native_image_mask,
    get_native_qr_payload,
)


# D/C is the supplier's version/marking; DATE is the production date.
_ROWS = (
    ('model', 'P/N:', '型号'),
    ('package', 'PKG:', '封装'),
    ('quantity', 'QTY:', '数量'),
    ('version', 'D/C:', '版本号'),
    ('batch', 'LOT:', '批次'),
    ('production_date', 'DATE:', '生产日期'),
)
_LABEL_X = 24
_VALUE_X = 112
_FIRST_ROW_Y = 150
_ROW_STEP = 40
_VALUE_RIGHT = 536


def _text_ink_bounds(text, size_pixels):
    font = get_native_arial_font(bold=True, size_pixels=size_pixels)
    mask, offset = font.getmask2(text, mode='1', anchor='lt')
    left, top, right, bottom = mask.getbbox()
    return left + offset[0], top + offset[1], right + offset[0], bottom + offset[1]


def _centered_text_item(text, bounds, size_pixels):
    left, top, right, bottom = _text_ink_bounds(text, size_pixels)
    x1, y1, x2, y2 = bounds
    x = round((x1 + x2 - left - right) / 2)
    y = round((y1 + y2 - top - bottom) / 2)
    return x, y, text, True, size_pixels


def _safe_field(value, field_name):
    # Check the original string before trimming: a field cannot contain a QR
    # line separator, even when that separator is at either end of the field.
    if isinstance(value, str) and any(
        ord(char) < 32 or ord(char) > 126 or char == '"' for char in value
    ):
        raise ValueError(f'{field_name}含无法安全完整打印的字符')
    text = get_excel_cell_text(value)
    if any(ord(char) < 32 or ord(char) > 126 or char == '"' for char in text):
        raise ValueError(f'{field_name}含无法安全完整打印的字符')
    return text


def _quantity(value):
    try:
        quantity = Decimal(value)
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValueError('先积标签数量须为有效的正整数') from error
    if (
        not quantity.is_finite() or quantity <= 0
        or quantity > 9007199254740991
        or quantity != quantity.to_integral_value()
    ):
        raise ValueError('先积标签数量须为有效的正整数')
    return quantity


def _field_values(record, source_qr=None):
    parsed = {key: _safe_field(record.get(key), name) for key, _prefix, name in _ROWS}
    if not parsed['model']:
        raise ValueError('先积标签缺少型号')
    parsed_quantity = _quantity(parsed['quantity'])
    if source_qr is None:
        parsed['quantity'] = format(parsed_quantity, 'f').split('.')[0]
        return parsed

    payload = get_native_qr_payload('', source_qr)
    # The supplier uses both CR/LF-delimited rows and comma-delimited records.
    # Accept either layout for validation while preserving the exact source QR
    # bytes in the printed QR bitmap below.
    lines = payload.splitlines()
    if len(lines) == 1 and ',' in payload:
        lines = payload.split(',')
    if len(lines) != len(_ROWS):
        raise ValueError('先积原始二维码须包含完整的六个字段（支持换行或逗号分隔）')
    original = {}
    for index, ((key, prefix, name), line) in enumerate(zip(_ROWS, lines), 1):
        if not line.startswith(prefix):
            raise ValueError(
                f'先积原始二维码第{index}个字段应以{prefix}开头，请核对该字段和解析规则'
            )
        original[key] = _safe_field(line[len(prefix):], name)
        matches = (
            _quantity(original[key]) == parsed_quantity
            if key == 'quantity' else original[key] == parsed[key]
        )
        if not matches:
            raise ValueError(f'先积原始二维码{name}与解析结果不一致，请核对该字段和解析规则')
    return original


def build_native_linearin_label(record, _template=None, copies=NATIVE_LABEL_COPIES, source_qr=None):
    """Build the 100x50 mm LINEARIN label, with prefixed CR-separated QR data."""
    values = _field_values(record, source_qr)
    payload = '\r'.join(prefix + values[key] for key, prefix, _name in _ROWS)
    payload = get_native_qr_payload(payload, source_qr)

    # Center the actual one-bit ink, not the font's advance or line height.
    rohs_height = _text_ink_bounds('RoHS', 28)[3]
    compliant_height = _text_ink_bounds('COMPLIANT', 14)[3]
    group_height = rohs_height + 10 + compliant_height
    group_top = round(66 - group_height / 2)
    text_items = [
        _centered_text_item('GP', (568, 26, 648, 106), 36),
        _centered_text_item('RoHS', (664, group_top, 774, group_top + rohs_height), 28),
        _centered_text_item(
            'COMPLIANT', (664, group_top + rohs_height + 10, 774, group_top + group_height), 14,
        ),
        (431, 122, 'ORIGIN: MADE IN CHINA', True, 22),
    ]
    for index, (key, caption, name) in enumerate(_ROWS):
        value = values[key] or '-'
        assert_native_text_width(value, _VALUE_RIGHT - _VALUE_X, field_name=name)
        y = _FIRST_ROW_Y + index * _ROW_STEP
        text_items.extend(((_LABEL_X, y, caption, False), (_VALUE_X, y, value, False)))

    qr = build_reprint_qr_image(payload, 184, (552, 148, 792, 392), 582, 182, center_x=672)
    logo = get_native_image_mask('linearin-logo.png', 400)
    # Lay out the ink, excluding transparent padding in the supplied artwork.
    logo_bounds = logo.getbbox()
    if logo_bounds:
        logo = logo.crop(logo_bounds)
    images = (
        (logo, (24, 24)),
        (get_native_image_mask('pb-logo.png', 84), (466, 24)),
        (qr.image, (qr.x, qr.y)),
    )
    ellipse_items = (((568, 26, 648, 106), 3),)
    line_items = ((((664, 26), (774, 26), (774, 106), (664, 106), (664, 26)), 3),)
    setup = b'SIZE 100 mm,50 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n'
    return setup + build_native_text_bitmap(
        text_items, images, ellipse_items=ellipse_items, line_items=line_items,
    ) + f'PRINT 1,{copies}\r\n'.encode('ascii')
