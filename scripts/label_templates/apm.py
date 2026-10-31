import math

from .common import (
    NATIVE_LABEL_COPIES,
    NATIVE_LABEL_QR_MASK,
    NATIVE_LABEL_QR_MODEL,
    build_native_text_bitmap,
    get_excel_cell_text,
    get_native_image_mask,
    get_native_right_aligned_text_x,
    get_native_arial_font,
    get_native_qr_payload,
    build_reprint_qr_image,
    assert_native_text_width,
    normalize_tspl_value,
)
from .code128 import build_reprint_barcode_command, get_reprint_barcode_width


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


def _record_text(record, key, strict):
    value = record.get(key)
    if strict:
        return '' if value is None else str(value)
    return get_excel_cell_text(value)


def build_native_apm_label(record, template, copies=NATIVE_LABEL_COPIES, source_qr=None):
    """生成极海或领芯的 100x50mm 拆包标签。"""
    strict = source_qr is not None
    model = normalize_tspl_value(record.get('model'), 22, strict=strict, field_name='型号')
    quantity = normalize_tspl_value(record.get('quantity'), 12, strict=strict, field_name='数量')
    batch = normalize_tspl_value(record.get('batch'), 18, strict=strict, field_name='批次')
    production_date = normalize_tspl_value(record.get('production_date'), 10, strict=strict, field_name='生产日期')
    package = normalize_tspl_value(record.get('package'), 18, strict=strict, field_name='封装')
    raw_trace_no = _record_text(record, 'trace_no', strict)
    trace_no = normalize_tspl_value(raw_trace_no, 28, strict=strict, field_name='追溯码') if raw_trace_no else ''
    source_no = normalize_tspl_value(record.get('source_no'), 18, strict=strict, field_name='箱号')
    raw_version = _record_text(record, 'version', strict)
    raw_inventory_code = _record_text(record, 'inventory_code', strict)
    version_is_apm_part_number = len(raw_version) == 12 and raw_version.isdigit()
    version = (
        ''
        if version_is_apm_part_number or not raw_version
        else normalize_tspl_value(raw_version, 12, strict=strict, field_name='版本号')
    )
    part_number = normalize_tspl_value(
        raw_version if version_is_apm_part_number else raw_inventory_code,
        18,
        strict=strict,
        field_name='P/N',
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
    scan_payload = get_native_qr_payload(scan_payload, source_qr, max_bytes=192)
    reprint_qr = None
    compliance_first_y = NATIVE_LABEL_COMPLIANCE_FIRST_Y
    compliance_row_gap = NATIVE_LABEL_COMPLIANCE_ROW_GAP_DOTS
    pb_position = _PB_POSITION
    trace_text_y = 242
    trace_barcode_y = 268
    trace_barcode_x = 350
    trace_barcode_right = 700
    upper_value_x = NATIVE_LABEL_RIGHT_VALUE_X
    trace_value_x = NATIVE_LABEL_RIGHT_VALUE_X
    barcode_dots = {
        'model': 1, 'quantity': 2, 'batch': 2, 'production_date': 2,
        'package': 2, 'trace_no': 2, 'part_number': 2, 'source_no': 2,
    }
    if strict:
        reprint_qr = build_reprint_qr_image(
            scan_payload, NATIVE_LABEL_QR_SIZE_DOTS,
            (528, 0, 800, 246), NATIVE_LABEL_QR_X, NATIVE_LABEL_QR_Y,
            error_correction='H', keep_symbol_position=True,
        )
        # The original slot counted the QR's black symbol as its entire box.
        # Reserve the full quiet border without reducing the template footprint.
        compliance_first_y = 250
        compliance_row_gap = 26
        pb_position = (_PB_POSITION[0], compliance_first_y + 86)
        trace_text_y = 250
        trace_barcode_y = 276
        upper_value_x = 435
        trace_value_x = 445
        upper_right_edge = reprint_qr.x - 4
        left_right_edge = 350 - 4  # Four dots before the right-hand captions.
        for field_name, value in (('型号', model), ('批次', batch), ('封装', package), ('P/N', part_number)):
            assert_native_text_width(value, left_right_edge - NATIVE_LABEL_LEFT_VALUE_X, field_name=field_name)
        for field_name, value in (('数量', quantity), ('生产日期', production_date)):
            assert_native_text_width(value, upper_right_edge - upper_value_x, field_name=field_name)
        trace_text_right = get_native_right_aligned_text_x('COO:CN', NATIVE_LABEL_RIGHT_EDGE_X, True) - 4
        font = get_native_arial_font()
        trace_ink = font.getmask(trace_no or '-', mode='1').getbbox()
        trace_width = max(font.getlength(trace_no or '-'), trace_ink[2] if trace_ink else 0)
        # Use the blank space after T/C: before considering any font change.
        # Most labels keep the established position; longer serial suffixes
        # shift left by only the dots actually needed, without touching COO.
        trace_min_value_x = 350 + math.ceil(font.getlength('T/C:')) + 8
        trace_value_x = max(trace_min_value_x, min(trace_value_x, math.floor(trace_text_right - trace_width)))
        assert_native_text_width(trace_no or '-', trace_text_right - trace_value_x, field_name='追溯码')
        assert_native_text_width(source_no, 720 - NATIVE_LABEL_RIGHT_VALUE_X, field_name='箱号')
        if version:
            assert_native_text_width(f'VER: {version}', upper_right_edge - 300, field_name='版本号')
        if trace_no:
            # Trace and package bars share a row. Reserve a 10-module quiet
            # zone from the actual package bars and the compliance text,
            # then use any otherwise blank space to retain two-dot bars.
            quiet_dots = 10 * barcode_dots['trace_no']
            trace_barcode_right = min(
                get_native_right_aligned_text_x(caption, NATIVE_LABEL_RIGHT_EDGE_X, True)
                for caption in ('RoHS', 'MSL3')
            ) - quiet_dots
            package_right = 30 + get_reprint_barcode_width(package, barcode_dots['package'], '封装')
            trace_width = get_reprint_barcode_width(trace_no, barcode_dots['trace_no'], '追溯码')
            trace_barcode_x = max(package_right + quiet_dots, min(350, trace_barcode_right - trace_width))

    text_items = [
        *(([(300, 22, f'VER: {version}', False)]) if version else []),
        (30, 82, 'DEVICE:', False),
        (NATIVE_LABEL_LEFT_VALUE_X, 82, model, False),
        (350, 82, 'QTY:', False),
        (upper_value_x, 82, quantity, False),
        (30, 164, 'LOT NO:', False),
        (NATIVE_LABEL_LEFT_VALUE_X, 164, batch, False),
        (350, 164, 'DATE:', False),
        (upper_value_x, 164, production_date, False),
        (30, 242, 'PKG:', False),
        (NATIVE_LABEL_LEFT_VALUE_X, 242, package, False),
        (350, trace_text_y, 'T/C:', False),
        (trace_value_x, trace_text_y, trace_no or '-', False),
        (30, 320, 'P/N:', False),
        (NATIVE_LABEL_LEFT_VALUE_X, 320, part_number, False),
        (350, 320, 'BOX ID:', False),
        (NATIVE_LABEL_RIGHT_VALUE_X, 320, source_no, False),
        (
            get_native_right_aligned_text_x('COO:CN', NATIVE_LABEL_RIGHT_EDGE_X, True),
            compliance_first_y,
            'COO:CN',
            True,
        ),
        (
            get_native_right_aligned_text_x('RoHS', NATIVE_LABEL_RIGHT_EDGE_X, True),
            compliance_first_y + compliance_row_gap,
            'RoHS',
            True,
        ),
        (
            get_native_right_aligned_text_x('MSL3', NATIVE_LABEL_RIGHT_EDGE_X, True),
            compliance_first_y + compliance_row_gap * 2,
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
    barcode_commands = [
        f'BARCODE 30,108,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{barcode_dots["model"]},{barcode_dots["model"]},"{model}"',
        f'BARCODE 350,108,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{barcode_dots["quantity"]},{barcode_dots["quantity"]},"{quantity}"',
        f'BARCODE 30,190,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{barcode_dots["batch"]},{barcode_dots["batch"]},"{batch}"',
        f'BARCODE 350,190,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{barcode_dots["production_date"]},{barcode_dots["production_date"]},"{production_date}"',
        f'BARCODE 30,268,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{barcode_dots["package"]},{barcode_dots["package"]},"{package}"',
        *(([f'BARCODE 350,268,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{barcode_dots["trace_no"]},{barcode_dots["trace_no"]},"{trace_no}"']) if trace_no else []),
        f'BARCODE 30,346,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{barcode_dots["part_number"]},{barcode_dots["part_number"]},"{part_number}"',
        f'BARCODE 350,346,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{barcode_dots["source_no"]},{barcode_dots["source_no"]},"{source_no}"',
    ]
    if strict:
        barcode_commands = [
            build_reprint_barcode_command(value, x, y, NATIVE_LABEL_BARCODE_HEIGHT_DOTS,
                                          barcode_dots[key], right, field_name)
            for key, field_name, value, x, y, right in (
                ('model', '型号', model, 30, 108, left_right_edge),
                ('quantity', '数量', quantity, 350, 108, upper_right_edge),
                ('batch', '批次', batch, 30, 190, left_right_edge),
                ('production_date', '生产日期', production_date, 350, 190, upper_right_edge),
                ('package', '封装', package, 30, 268, left_right_edge),
                ('trace_no', '追溯码', trace_no, trace_barcode_x, trace_barcode_y, trace_barcode_right),
                ('part_number', 'P/N', part_number, 30, 346, left_right_edge),
                ('source_no', '箱号', source_no, 350, 346, 720),
            ) if value
        ]
    print_commands = '\r\n'.join([
        *barcode_commands,
        *([] if strict else [f'QRCODE {NATIVE_LABEL_QR_X},{NATIVE_LABEL_QR_Y},L,{NATIVE_LABEL_QR_CELL_DOTS},A,0,{NATIVE_LABEL_QR_MODEL},{NATIVE_LABEL_QR_MASK},"{scan_payload}"']),
        f'PRINT 1,{copies}',
        '',
    ]).encode('ascii')

    image_items = []
    if template.get('include_logo'):
        image_items.append((get_native_image_mask('geehy-logo.png', 200), _GEEHY_LOGO_POSITION))
    image_items.append((get_native_image_mask('pb-logo.png', _PB_SIZE_DOTS, _PB_SIZE_DOTS), pb_position))
    if reprint_qr is not None:
        image_items.append((reprint_qr.image, (reprint_qr.x, reprint_qr.y)))
    return setup_commands + build_native_text_bitmap(text_items, image_items) + print_commands
