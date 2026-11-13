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
DONGWEI_LABEL_FIELD_COUNTS = (6, 7)


def normalize_dongwei_field_count(value):
    """A count snapshot disambiguates a terminator from an empty seventh field."""
    if value is None or value == '':
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError('东微二维码段数须为6或7，请核对原码和解析规则')
    text = get_excel_cell_text(value)
    if text not in (str(count) for count in DONGWEI_LABEL_FIELD_COUNTS):
        raise ValueError('东微二维码段数须为6或7，请核对原码和解析规则')
    return int(text)


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
    field_count = normalize_dongwei_field_count(record.get('qr_field_count'))
    if not parsed['model']:
        raise ValueError('东微标签缺少型号')
    parsed_quantity = _quantity(parsed['quantity'])
    if source_qr is None:
        parsed['quantity'] = format(parsed_quantity, 'f').split('.')[0]
        if field_count == 6:
            if parsed['source_no']:
                raise ValueError('东微六段标签不能包含箱号，请核对原码和解析规则')
            del parsed['source_no']
        return parsed

    payload = get_native_qr_payload('', source_qr)
    fields = payload.split(';')
    # Old tasks default to seven fields. New tasks always snapshot the count,
    # so a six-field terminator and a seven-field empty box are not guessed.
    if field_count is None:
        field_count = 6 if len(fields) == 6 else 7
    if len(fields) == field_count + 1 and not fields[-1].strip():
        fields.pop()
    if len(fields) != field_count:
        raise ValueError('东微原始二维码须包含完整的六个或七个字段')
    if field_count == 6 and parsed['source_no']:
        raise ValueError('东微六段标签不能包含箱号，请核对原码和解析规则')
    qr_fields = _QR_FIELDS[:field_count]
    original = {
        key: _safe_field(value, _FIELD_NAMES[key])
        for key, value in zip(qr_fields, fields)
    }
    for key in qr_fields:
        matches = (
            _quantity(original[key]) == parsed_quantity
            if key == 'quantity' else original[key] == parsed[key]
        )
        if not matches:
            raise ValueError(f'东微原始二维码{_FIELD_NAMES[key]}与解析结果不一致，请核对该字段和解析规则')
    return original


def build_native_dongwei_label(record, _template=None, copies=NATIVE_LABEL_COPIES, source_qr=None):
    """Build the six- or seven-field 100x50 mm Oriental Semi label."""
    saved_source = record.get('source_qr')
    if source_qr is None:
        source_qr = None if saved_source in (None, '') else saved_source
    values = _field_values(record, source_qr)
    has_box = 'source_no' in values
    qr_fields = _QR_FIELDS if has_box else _QR_FIELDS[:-1]
    payload = ';'.join(values[key] for key in qr_fields) + (';' if has_box else '')
    payload = get_native_qr_payload(payload, source_qr)

    text_items = []
    for index, (key, caption, name) in enumerate(_ROWS):
        if key == 'source_no' and not has_box:
            continue
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
