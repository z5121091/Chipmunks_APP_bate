from .common import (
    NATIVE_LABEL_COPIES,
    NATIVE_LABEL_QR_MASK,
    NATIVE_LABEL_QR_MODEL,
    build_native_text_bitmap,
    get_excel_cell_text,
    get_native_image_mask,
    get_native_right_aligned_text_x,
    normalize_tspl_value,
)


NATIVE_LABEL_BARCODE_HEIGHT_DOTS = 32
NATIVE_LABEL_BARCODE_STRICT_WIDTH_DOTS = 1
NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS = 2
NATIVE_LABEL_QR_CELL_DOTS = 6
NATIVE_LABEL_QR_X = 575
NATIVE_LABEL_QR_Y = 20
NATIVE_LABEL_QR_MODULE_COUNT = 33
NATIVE_LABEL_QR_SIZE_DOTS = NATIVE_LABEL_QR_MODULE_COUNT * NATIVE_LABEL_QR_CELL_DOTS
NATIVE_LABEL_RIGHT_EDGE_X = NATIVE_LABEL_QR_X + NATIVE_LABEL_QR_SIZE_DOTS
NATIVE_LABEL_COMPLIANCE_FIRST_Y = NATIVE_LABEL_QR_Y + NATIVE_LABEL_QR_SIZE_DOTS + 2
NATIVE_LABEL_COMPLIANCE_ROW_GAP_DOTS = 28
NATIVE_LABEL_LEFT_VALUE_X = 150
NATIVE_LABEL_RIGHT_VALUE_X = 455

_GEEHY_LOGO_POSITION = (30, 5)
_PB_SIZE_DOTS = 40
_PB_POSITION = (
    NATIVE_LABEL_RIGHT_EDGE_X - _PB_SIZE_DOTS,
    NATIVE_LABEL_COMPLIANCE_FIRST_Y + 86,
)


def build_native_scan_payload(
    model,
    batch,
    package,
    version,
    quantity,
    production_date,
    trace_no,
    source_no,
):
    fields = (
        model,
        batch,
        package,
        version,
        quantity,
        production_date,
        trace_no,
        source_no,
    )
    return '/'.join(field.replace('/', '-') for field in fields)


def build_native_apm_label(record, template, copies=NATIVE_LABEL_COPIES):
    """生成极海或领芯的 100x50mm 拆包标签。"""
    model = normalize_tspl_value(record.get('model'), 22)
    quantity = normalize_tspl_value(record.get('quantity'), 12)
    batch = normalize_tspl_value(record.get('batch'), 18)
    production_date = normalize_tspl_value(record.get('production_date'), 10)
    package = normalize_tspl_value(record.get('package'), 18)
    raw_trace_no = get_excel_cell_text(record.get('trace_no'))
    trace_no = normalize_tspl_value(raw_trace_no, 28) if raw_trace_no else ''
    source_no = normalize_tspl_value(record.get('source_no'), 18)
    raw_version = get_excel_cell_text(record.get('version'))
    raw_inventory_code = get_excel_cell_text(record.get('inventory_code'))
    version_is_apm_part_number = len(raw_version) == 12 and raw_version.isdigit()
    version = (
        ''
        if version_is_apm_part_number or not raw_version
        else normalize_tspl_value(raw_version, 12)
    )
    part_number = normalize_tspl_value(
        raw_version if version_is_apm_part_number else raw_inventory_code,
        18,
    )
    scan_identifier = version or part_number
    scan_payload = build_native_scan_payload(
        model,
        batch,
        package,
        scan_identifier,
        quantity,
        production_date,
        trace_no,
        source_no,
    )

    text_items = [
        *(([(300, 22, f'VER: {version}', False)]) if version else []),
        (30, 82, 'DEVICE:', False),
        (NATIVE_LABEL_LEFT_VALUE_X, 82, model, False),
        (350, 82, 'QTY:', False),
        (NATIVE_LABEL_RIGHT_VALUE_X, 82, quantity, False),
        (30, 164, 'LOT NO:', False),
        (NATIVE_LABEL_LEFT_VALUE_X, 164, batch, False),
        (350, 164, 'DATE:', False),
        (NATIVE_LABEL_RIGHT_VALUE_X, 164, production_date, False),
        (30, 242, 'PKG:', False),
        (NATIVE_LABEL_LEFT_VALUE_X, 242, package, False),
        (350, 242, 'T/C:', False),
        (NATIVE_LABEL_RIGHT_VALUE_X, 242, trace_no or '-', False),
        (30, 320, 'P/N:', False),
        (NATIVE_LABEL_LEFT_VALUE_X, 320, part_number, False),
        (350, 320, 'BOX ID:', False),
        (NATIVE_LABEL_RIGHT_VALUE_X, 320, source_no, False),
        (
            get_native_right_aligned_text_x('COO:CN', NATIVE_LABEL_RIGHT_EDGE_X, True),
            NATIVE_LABEL_COMPLIANCE_FIRST_Y,
            'COO:CN',
            True,
        ),
        (
            get_native_right_aligned_text_x('RoHS', NATIVE_LABEL_RIGHT_EDGE_X, True),
            NATIVE_LABEL_COMPLIANCE_FIRST_Y + NATIVE_LABEL_COMPLIANCE_ROW_GAP_DOTS,
            'RoHS',
            True,
        ),
        (
            get_native_right_aligned_text_x('MSL3', NATIVE_LABEL_RIGHT_EDGE_X, True),
            NATIVE_LABEL_COMPLIANCE_FIRST_Y + NATIVE_LABEL_COMPLIANCE_ROW_GAP_DOTS * 2,
            'MSL3',
            True,
        ),
    ]
    setup_commands = '\r\n'.join([
        'SIZE 100 mm,50 mm',
        'GAP 3 mm,0 mm',
        'DIRECTION 1',
        'CLS',
        '',
    ]).encode('ascii')
    print_commands = '\r\n'.join([
        f'BARCODE 30,108,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{NATIVE_LABEL_BARCODE_STRICT_WIDTH_DOTS},{NATIVE_LABEL_BARCODE_STRICT_WIDTH_DOTS},"{model}"',
        f'BARCODE 350,108,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},"{quantity}"',
        f'BARCODE 30,190,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},"{batch}"',
        f'BARCODE 350,190,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},"{production_date}"',
        f'BARCODE 30,268,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},"{package}"',
        *(([f'BARCODE 350,268,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},"{trace_no}"']) if trace_no else []),
        f'BARCODE 30,346,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},"{part_number}"',
        f'BARCODE 350,346,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{NATIVE_LABEL_BARCODE_STRICT_WIDTH_DOTS},{NATIVE_LABEL_BARCODE_STRICT_WIDTH_DOTS},"{source_no}"',
        f'QRCODE {NATIVE_LABEL_QR_X},{NATIVE_LABEL_QR_Y},L,{NATIVE_LABEL_QR_CELL_DOTS},A,0,{NATIVE_LABEL_QR_MODEL},{NATIVE_LABEL_QR_MASK},"{scan_payload}"',
        f'PRINT 1,{copies}',
        '',
    ]).encode('ascii')

    image_items = []
    if template.get('include_logo'):
        image_items.append((get_native_image_mask('geehy-logo.png', 200), _GEEHY_LOGO_POSITION))
    image_items.append((get_native_image_mask('pb-logo.png', _PB_SIZE_DOTS, _PB_SIZE_DOTS), _PB_POSITION))
    return setup_commands + build_native_text_bitmap(text_items, image_items) + print_commands
