"""Rongpai's 100 x 50 mm label, including the supplier's ten-field QR."""

from decimal import Decimal, InvalidOperation

from .code128 import build_reprint_barcode_command
from .common import (
    NATIVE_LABEL_COPIES,
    NATIVE_LABEL_DPI,
    NATIVE_LABEL_FONT_SIZE_PIXELS,
    build_native_text_bitmap,
    build_reprint_qr_image,
    get_excel_cell_text,
    get_native_arial_font,
    get_native_image_mask,
    get_native_qr_payload,
)


_LARGE_FONT = round(10 * NATIVE_LABEL_DPI / 72)
_TITLE_FONT = round(12 * NATIVE_LABEL_DPI / 72)
_QR_FIELDS = (
    'model', 'batch', 'production_date', 'quantity', 'trace_no',
    None, 'version', 'source_no', None, 'package',
)
_FIXED_FIELDS = {5: 'A', 8: '1'}
_FIELD_NAMES = {
    'model': '型号', 'batch': '批次', 'production_date': '生产日期',
    'quantity': '数量', 'trace_no': '追溯码', 'version': '版本号',
    'source_no': '箱号', 'package': '封装（原库位）',
}
_VISIBLE_ROWS = (
    ('model', 'Part Number:', False, NATIVE_LABEL_FONT_SIZE_PIXELS),
    ('batch', 'Lot No.:', True, NATIVE_LABEL_FONT_SIZE_PIXELS),
    ('production_date', 'Date Code:', False, NATIVE_LABEL_FONT_SIZE_PIXELS),
    ('quantity', 'Quantity:', True, _LARGE_FONT),
    ('trace_no', 'Tracking No.:', False, NATIVE_LABEL_FONT_SIZE_PIXELS),
)


def _safe_field(value, field_name):
    text = get_excel_cell_text(value)
    if ';' in text:
        raise ValueError(f'荣湃标签{field_name}含二维码分隔符分号，无法完整打印')
    if any(ord(char) < 32 or ord(char) > 126 or char == '"' for char in text):
        raise ValueError(f'荣湃标签{field_name}含无法安全完整打印的字符')
    return text


def _quantity(value):
    try:
        quantity = Decimal(value)
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValueError('荣湃标签数量须为有效的正整数') from error
    if (
        not quantity.is_finite() or quantity <= 0
        or quantity > 9007199254740991
        or quantity != quantity.to_integral_value()
    ):
        raise ValueError('荣湃标签数量须为有效的正整数')
    return quantity


def _field_values(record, source_qr=None):
    values = {key: _safe_field(record.get(key), name) for key, name in _FIELD_NAMES.items()}
    for key in ('model', 'trace_no'):
        if not values[key]:
            raise ValueError(f'荣湃标签缺少{_FIELD_NAMES[key]}')
    quantity = _quantity(values['quantity'])
    if source_qr is None:
        values['quantity'] = format(quantity, 'f').split('.')[0]
        return values

    source = get_native_qr_payload('', source_qr)
    segments = source.split(';')
    if len(segments) == 11 and not segments[-1].strip():
        segments.pop()
    if len(segments) != 10:
        raise ValueError('荣湃原始二维码须包含完整的十个字段')
    original = {}
    for index, key in enumerate(_QR_FIELDS):
        if key is None:
            if segments[index].strip() != _FIXED_FIELDS[index]:
                raise ValueError(f'荣湃原始二维码第{index + 1}段固定标识应为{_FIXED_FIELDS[index]}')
            continue
        original[key] = _safe_field(segments[index], _FIELD_NAMES[key])
        matches = (
            _quantity(original[key]) == quantity
            if key == 'quantity' else original[key] == values[key]
        )
        if not matches:
            raise ValueError(f'荣湃原始二维码{_FIELD_NAMES[key]}与解析结果不一致，请核对该字段和解析规则')
    return original


def _check_text(value, width, field_name, bold=False, size=NATIVE_LABEL_FONT_SIZE_PIXELS):
    font = get_native_arial_font(bold=bold, size_pixels=size)
    ink = font.getmask(value, mode='1').getbbox()
    if max(font.getlength(value), ink[2] if ink else 0) > width:
        raise ValueError(f'荣湃标签{field_name}文字超出模板宽度，请核对该字段内容和解析规则')


def build_native_rongpai_label(record, _template=None, copies=NATIVE_LABEL_COPIES, source_qr=None):
    values = _field_values(record, source_qr)
    payload = ';'.join(
        _FIXED_FIELDS[index] if key is None else values[key]
        for index, key in enumerate(_QR_FIELDS)
    ) + ';'
    payload = get_native_qr_payload(payload, source_qr)

    _check_text(values['model'], 516, '型号', bold=True, size=_TITLE_FONT)
    text_items = [(24, 18, values['model'], True, _TITLE_FONT)]
    barcode_commands = []
    for index, (key, caption, bold, size) in enumerate(_VISIBLE_ROWS):
        y = 60 + index * 64
        value = values[key] or '-'
        _check_text(value, 540 - 180, _FIELD_NAMES[key], bold, size)
        text_items.extend(((24, y, caption, False), (180, y, value, bold, size)))
        if values[key]:
            # Attach the barcode to its own text. The remaining row space belongs
            # between this barcode and the next field, including for larger values.
            text_height = max(
                get_native_arial_font().getbbox(caption, anchor='lt')[3],
                get_native_arial_font(bold=bold, size_pixels=size).getbbox(value, anchor='lt')[3],
            )
            # Keep the same readable two-dot module width for unpack and reprint.
            # The measured Code128 B/C encoding rejects overflow without truncation.
            barcode_commands.append(build_reprint_barcode_command(
                values[key], 24, y + text_height + 4, 24, 2, 540, _FIELD_NAMES[key],
            ))

    msl = 'MSL: ' + (values['version'] or '-')
    _check_text(msl, 240, '版本号', bold=True)
    text_items.extend(((632, 86, 'RoHS', False), (552, 120, msl, True),
                       (610, 360, '2Pai Semi', True, _LARGE_FONT)))
    qr = build_reprint_qr_image(payload, 164, (552, 152, 792, 344), 594, 166, center_x=672)
    images = (
        (get_native_image_mask('pb-logo.png', 64, 64), (638, 12)),
        (qr.image, (qr.x, qr.y)),
        (get_native_image_mask('rongpai-logo.png', 42, 42), (558, 350)),
    )
    setup = b'SIZE 100 mm,50 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n'
    commands = '\r\n'.join((*barcode_commands, f'PRINT 1,{copies}', '')).encode('ascii')
    return setup + build_native_text_bitmap(text_items, images) + commands
