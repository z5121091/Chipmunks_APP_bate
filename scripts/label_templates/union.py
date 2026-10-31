from .common import (
    NATIVE_LABEL_COPIES,
    NATIVE_LABEL_QR_MASK,
    NATIVE_LABEL_QR_MODEL,
    build_reprint_qr_image,
    build_native_text_bitmap,
    get_excel_cell_text,
    get_native_arial_font,
    get_native_image_mask,
    get_native_qr_payload,
)
from .code128 import build_reprint_barcode_command


_FIELDS = (
    ('model', 'P/N:', 20, 100, 95, 131, 20, 430),
    ('quantity', 'QTY:', 20, 164, 95, 195, 20, 430),
    ('trace_no', 'TRACE NO.:', 20, 228, 166, 259, 20, 430),
    ('batch', 'LOT NO.:', 20, 292, 136, 323, 20, 430),
    ('source_no', 'DATE CODE:', 450, 100, 600, 131, 450, 780),
    ('version', 'MARK:', 450, 164, 540, 195, 450, 780),
    ('production_date', 'DATE:', 450, 228, 530, 259, 450, 610),
)


def _field_value(record, key):
    value = get_excel_cell_text(record.get(key)) or '-'
    if any(ord(char) < 32 or ord(char) > 126 for char in value):
        raise ValueError(f'盈力标签字段 {key} 含无法打印的字符')
    if ';' in value or '"' in value:
        raise ValueError(f'盈力标签字段 {key} 含二维码分隔符或打印指令引号')
    return value


def _qr_cell_dots(payload):
    # Byte-mode capacities give a conservative bound for the fixed bottom-right area.
    if len(payload) <= 78:
        return 4
    if len(payload) <= 192:
        return 3
    raise ValueError('盈力标签二维码内容过长，无法放入右下角')


def _barcode_module_dots(value, x, right_edge):
    codewords = len(value) + 2
    if value.isdigit() and len(value) % 2 == 0:
        codewords = len(value) // 2 + 2
    estimated_modules = codewords * 11 + 13
    return 2 if x + estimated_modules * 2 <= right_edge else 1


def build_native_union_label(record, _template=None, copies=NATIVE_LABEL_COPIES, source_qr=None):
    """Build Union Semiconductor's 100x50 mm unpack label from one Excel row."""
    values = {key: _field_value(record, key) for key, *_ in _FIELDS}
    text_items = []
    barcode_commands = []
    font = get_native_arial_font()
    for key, caption, label_x, text_y, value_x, barcode_y, barcode_x, right_edge in _FIELDS:
        value = values[key]
        if value_x + font.getlength(value) > right_edge:
            raise ValueError(f'盈力标签字段 {caption} 内容过长，无法完整打印')
        text_items.extend(((label_x, text_y, caption, False), (value_x, text_y, value, False)))
        if value != '-':
            barcode_right_edge = 610 if key == 'production_date' else 800 if barcode_x == 450 else 430
            if source_qr is not None:
                field_name = {
                    'model': '型号', 'quantity': '数量', 'trace_no': '追溯码',
                    'batch': '批次', 'source_no': '箱号', 'version': '版本号',
                    'production_date': '生产日期',
                }[key]
                barcode_commands.append(build_reprint_barcode_command(
                    value, barcode_x, barcode_y, 22, 2, barcode_right_edge, field_name,
                ))
            else:
                module_dots = _barcode_module_dots(value, barcode_x, barcode_right_edge)
                barcode_commands.append(
                    f'BARCODE {barcode_x},{barcode_y},"128",22,0,0,{module_dots},{module_dots},"{value}"'
                )

    text_items.extend(((494, 20, 'RoHS', True), (587, 20, 'HF', True)))
    images = (
        (get_native_image_mask('union-logo.png', 260), (20, 8)),
        (get_native_image_mask('pb-logo.png', 42, 42), (308, 12)),
        (get_native_image_mask('esd-warning.png', 47), (365, 10)),
        (get_native_image_mask('keep-dry.png', 47), (422, 7)),
    )
    boxes = (
        (((485, 8), (566, 8), (566, 56), (485, 56), (485, 8)), 2),
        (((579, 8), (634, 8), (634, 56), (579, 56), (579, 8)), 2),
    )
    scan_payload = ';'.join(values[key] for key, *_ in _FIELDS)
    scan_payload = get_native_qr_payload(scan_payload, source_qr, max_bytes=192)
    qr_commands = []
    if source_qr is None:
        qr_cell_dots = _qr_cell_dots(scan_payload)
        qr_commands.append(
            f'QRCODE 620,235,L,{qr_cell_dots},A,0,{NATIVE_LABEL_QR_MODEL},{NATIVE_LABEL_QR_MASK},"{scan_payload}"'
        )
    else:
        qr_image = build_reprint_qr_image(
            scan_payload, 132, (614, 221, 800, 400), 620, 235,
        )
        images += ((qr_image.image, (qr_image.x, qr_image.y)),)
    setup = b'SIZE 100 mm,50 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n'
    commands = '\r\n'.join((
        *barcode_commands,
        *qr_commands,
        f'PRINT 1,{copies}',
        '',
    )).encode('ascii')
    return setup + build_native_text_bitmap(text_items, images, line_items=boxes) + commands
