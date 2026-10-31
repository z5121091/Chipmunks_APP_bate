from decimal import Decimal, InvalidOperation

from .common import (
    NATIVE_LABEL_COPIES,
    assert_native_text_width,
    build_native_text_bitmap,
    build_reprint_qr_image,
    get_excel_cell_text,
    get_native_image_mask,
    get_native_qr_payload,
)


_ROWS = (
    ('model', 'Part no:', '型号'),
    ('version', 'Mark:', '版本号'),
    ('package', 'Package:', '封装'),
    ('batch', 'Lot no:', '批次'),
    ('production_date', 'DC:', '生产日期'),
    ('quantity', 'QTY:', '数量'),
    ('source_no', 'Box:', '箱号'),
)
# The supplier's QR has quantity before date; the visible rows have date first.
_QR_FIELDS = ('model', 'version', 'package', 'batch', 'quantity', 'production_date', 'source_no')
_FIELD_NAMES = {key: name for key, _caption, name in _ROWS}
_LABEL_X = 28
_VALUE_X = 176
_FIRST_ROW_Y = 132
_ROW_STEP = 36


def _safe_field(value, field_name):
    text = get_excel_cell_text(value)
    if ';' in text:
        raise ValueError(f'东微标签{field_name}含二维码分隔符分号，无法完整打印')
    if any(ord(char) < 32 or ord(char) > 126 or char == '"' for char in text):
        raise ValueError(f'{field_name}含无法安全完整打印的字符')
    return text


def _quantity(value):
    try:
        quantity = Decimal(value)
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValueError('东微标签数量须为有效的正整数') from error
    if (
        not quantity.is_finite() or quantity <= 0
        or quantity > 9007199254740991
        or quantity != quantity.to_integral_value()
    ):
        raise ValueError('东微标签数量须为有效的正整数')
    return quantity


def _field_values(record, source_qr=None):
    parsed = {key: _safe_field(record.get(key), _FIELD_NAMES[key]) for key in _QR_FIELDS}
    if not parsed['model']:
        raise ValueError('东微标签缺少型号')
    parsed_quantity = _quantity(parsed['quantity'])
    if source_qr is None:
        parsed['quantity'] = format(parsed_quantity, 'f').split('.')[0]
        return parsed

    payload = get_native_qr_payload('', source_qr)
    fields = payload.split(';')
    if len(fields) == 8 and not fields[-1].strip():
        fields.pop()
    if len(fields) != len(_QR_FIELDS):
        raise ValueError('东微原始二维码须包含完整的七个字段')
    original = {
        key: _safe_field(value, _FIELD_NAMES[key])
        for key, value in zip(_QR_FIELDS, fields)
    }
    for key in _QR_FIELDS:
        matches = (
            _quantity(original[key]) == parsed_quantity
            if key == 'quantity' else original[key] == parsed[key]
        )
        if not matches:
            raise ValueError(f'东微原始二维码{_FIELD_NAMES[key]}与解析结果不一致，请核对该字段和解析规则')
    return original


def build_native_dongwei_label(record, _template=None, copies=NATIVE_LABEL_COPIES, source_qr=None):
    """Build the 100x50 mm Oriental Semi label with the supplier's field order."""
    values = _field_values(record, source_qr)
    payload = ';'.join(values[key] for key in _QR_FIELDS) + ';'
    payload = get_native_qr_payload(payload, source_qr)

    text_items = []
    for index, (key, caption, name) in enumerate(_ROWS):
        y = _FIRST_ROW_Y + index * _ROW_STEP
        value = values[key] or '-'
        # Leave the Green marking beside the model, and reserve the QR column.
        right_edge = 464 if key == 'model' else 548
        assert_native_text_width(value, right_edge - _VALUE_X, field_name=name)
        text_items.extend(((_LABEL_X, y, caption, False), (_VALUE_X, y, value, False)))
    text_items.append((480, _FIRST_ROW_Y, 'Green', False))

    # Render both new unpack codes and exact reprints as a measured QR matrix,
    # keeping the quiet zone and avoiding printer-specific QR sizing differences.
    qr = build_reprint_qr_image(payload, 180, (560, 8, 792, 260), 590, 32, center_x=676)
    images = (
        (get_native_image_mask('dongwei-logo.png', 400), (28, 14)),
        (qr.image, (qr.x, qr.y)),
    )
    setup = b'SIZE 100 mm,50 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n'
    return setup + build_native_text_bitmap(text_items, images) + f'PRINT 1,{copies}\r\n'.encode('ascii')
