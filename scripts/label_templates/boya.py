from .common import (
    NATIVE_LABEL_COPIES,
    NATIVE_LABEL_DPI,
    NATIVE_LABEL_QR_MASK,
    NATIVE_LABEL_QR_MODEL,
    build_native_text_bitmap,
    get_native_centered_text_x,
    get_native_image_mask,
    normalize_tspl_value,
)


NATIVE_LABEL_BOYA_HEADER_FONT_SIZE_PIXELS = round(14 * NATIVE_LABEL_DPI / 72)
NATIVE_LABEL_BOYA_QR_X = 610
NATIVE_LABEL_BOYA_QR_Y = 190
NATIVE_LABEL_BOYA_QR_CELL_DOTS = 6

_BOYA_LOGO_POSITION = (28, 8)
_BOYA_ROHS_ELLIPSE = (694, 92, 770, 168)


def build_native_boya_label(record, _template=None, copies=NATIVE_LABEL_COPIES):
    """生成珠海博雅的 100x50mm 拆包标签。"""
    model = normalize_tspl_value(record.get('model'), 22)
    quantity = normalize_tspl_value(record.get('quantity'), 12)
    batch = normalize_tspl_value(record.get('batch'), 18)
    production_date = normalize_tspl_value(record.get('production_date'), 10)
    package = normalize_tspl_value(record.get('package'), 18)
    source_no = normalize_tspl_value(record.get('source_no'), 18)
    scan_payload = '/'.join(field.replace('/', '-') for field in (
        model,
        package,
        quantity,
        batch,
        production_date,
        source_no,
    ))

    header = 'BOYA MICROELECTRONICS'
    text_items = [
        (
            get_native_centered_text_x(
                header,
                size_pixels=NATIVE_LABEL_BOYA_HEADER_FONT_SIZE_PIXELS,
            ),
            28,
            header,
            False,
            NATIVE_LABEL_BOYA_HEADER_FONT_SIZE_PIXELS,
        ),
        (28, 80, 'PART NO.:', False),
        (210, 80, model, False),
        (28, 130, 'PACKAGE:', False),
        (210, 130, package, False),
        (28, 180, 'QUANTITY:', False),
        (210, 180, quantity, False),
        (28, 230, 'LOT ID:', False),
        (210, 230, batch, False),
        (28, 280, 'DATE CODE:', False),
        (210, 280, production_date, False),
        (28, 330, 'Track ID:', False),
        (210, 330, source_no, False),
        (28, 365, 'MSL3', True),
        (701, 122, 'RoHS', True),
    ]
    setup_commands = '\r\n'.join([
        'SIZE 100 mm,50 mm',
        'GAP 3 mm,0 mm',
        'DIRECTION 1',
        'CLS',
        '',
    ]).encode('ascii')
    print_commands = '\r\n'.join([
        f'QRCODE {NATIVE_LABEL_BOYA_QR_X},{NATIVE_LABEL_BOYA_QR_Y},L,{NATIVE_LABEL_BOYA_QR_CELL_DOTS},A,0,{NATIVE_LABEL_QR_MODEL},{NATIVE_LABEL_QR_MASK},"{scan_payload}"',
        f'PRINT 1,{copies}',
        '',
    ]).encode('ascii')
    image_items = ((get_native_image_mask('boya-logo.png', 70), _BOYA_LOGO_POSITION),)
    ellipse_items = ((_BOYA_ROHS_ELLIPSE, 3),)
    return (
        setup_commands
        + build_native_text_bitmap(text_items, image_items, ellipse_items)
        + print_commands
    )
