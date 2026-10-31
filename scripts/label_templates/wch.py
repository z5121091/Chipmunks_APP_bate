from decimal import Decimal, InvalidOperation

from .common import (
    NATIVE_LABEL_COPIES,
    NATIVE_LABEL_FONT_SIZE_PIXELS,
    NATIVE_LABEL_QR_MASK,
    NATIVE_LABEL_QR_MODEL,
    build_reprint_qr_image,
    build_native_text_bitmap,
    get_excel_cell_text,
    get_native_arial_font,
    get_native_image_mask,
    get_native_qr_payload,
)


_ROWS = (
    ('model', 'Part No:'),
    ('version', 'item No:'),
    ('code_no', 'Code NO:'),
    ('package', 'Package:'),
    ('batch', 'LOT NO:'),
    ('quantity', 'QTY:'),
    ('production_date', 'DATE:'),
    ('origin', 'Origin:'),
)
_QR_FIELDS = tuple(key for key, _caption in _ROWS) + ('trace_no',)
_LABEL_X = 32
_VALUE_X = 154
_VALUE_RIGHT = 480
_FIRST_ROW_Y = 24
_ROW_STEP = 43
_QR_CENTER_X = 638
_QR_Y = 100
_TRACE_LEFT = 490
_TRACE_RIGHT = 780
_TRACE_Y = 330


def _field_values(record, source_qr=None):
    if source_qr is not None:
        fields = get_native_qr_payload('', source_qr, max_bytes=367).split(',')
        if len(fields) != len(_QR_FIELDS):
            raise ValueError('沁恒原始二维码须包含完整的九个字段')
        # Code NO and Origin are often ignored by the parser. Read all printed
        # fields from this supplier's original QR to keep the text consistent.
        values = dict(zip(_QR_FIELDS, fields))
        if values['model'].strip() != get_excel_cell_text(record.get('model')):
            raise ValueError('沁恒原始二维码型号与解析结果不一致')
        try:
            raw_quantity = Decimal(values['quantity'])
            parsed_quantity = Decimal(get_excel_cell_text(record.get('quantity')))
        except InvalidOperation as error:
            raise ValueError('沁恒原始二维码数量须为有效的正整数') from error
        if (
            not raw_quantity.is_finite() or raw_quantity <= 0
            or raw_quantity != raw_quantity.to_integral_value()
            or raw_quantity > 9007199254740991 or raw_quantity != parsed_quantity
        ):
            raise ValueError('沁恒原始二维码数量与解析结果不一致或数量无效')
    else:
        values = {
            key: get_excel_cell_text(record.get(key))
            for key in _QR_FIELDS if key not in ('code_no', 'origin')
        }
        values.update(code_no='---', origin='China')
    for key, value in values.items():
        if any(ord(char) < 32 or ord(char) > 126 for char in value):
            raise ValueError(f'沁恒标签字段 {key} 含无法打印的字符')
        if ',' in value or '"' in value:
            raise ValueError(f'沁恒标签字段 {key} 含二维码分隔符或打印指令引号')
    for key in ('model', 'quantity', 'trace_no'):
        if not values[key]:
            raise ValueError(f'沁恒标签缺少字段 {key}')
    return values


def _fit_font_size(text, width, field_name):
    size = NATIVE_LABEL_FONT_SIZE_PIXELS
    if get_native_arial_font(size_pixels=size).getlength(text) <= width:
        return size
    raise ValueError(f'沁恒标签字段 {field_name} 内容过长，无法完整打印')


def _qr_cell_dots(payload):
    # Conservative Model 2 / L byte-mode bounds for versions 4, 6, 8 and 12.
    # Each choice reserves four blank modules around the symbol, including
    # above the separately printed trace number; never truncate the payload.
    # Capacity reference: https://www.qrcode.com/en/about/version.html
    for byte_capacity, cell_dots in ((78, 6), (134, 5), (192, 4), (367, 3)):
        if len(payload) <= byte_capacity:
            return cell_dots
    raise ValueError('沁恒标签二维码内容过长，无法完整放入标签')


def build_native_wch_label(record, _template=None, copies=NATIVE_LABEL_COPIES, source_qr=None):
    """Build WCH's 100x50 mm unpack label without changing trace data."""
    values = _field_values(record, source_qr)
    text_items = []
    for index, (key, caption) in enumerate(_ROWS):
        y = _FIRST_ROW_Y + index * _ROW_STEP
        displayed_value = values[key] or '-'
        size = _fit_font_size(displayed_value, _VALUE_RIGHT - _VALUE_X, caption)
        value_y = y
        if key == 'code_no':
            # Top alignment puts short dash glyphs above the caption's center.
            font = get_native_arial_font(size_pixels=size)
            caption_ink = font.getmask(caption).getbbox()
            value_ink = font.getmask(displayed_value).getbbox()
            caption_center = (caption_ink[1] + caption_ink[3]) / 2
            value_center = (value_ink[1] + value_ink[3]) / 2
            value_y += round(caption_center - value_center)
        text_items.extend((
            (_LABEL_X, y, caption, False),
            (_VALUE_X, value_y, displayed_value, False, size),
        ))

    trace_text = values['trace_no']
    trace_max_width = 2 * min(_QR_CENTER_X - _TRACE_LEFT, _TRACE_RIGHT - _QR_CENTER_X)
    trace_size = _fit_font_size(trace_text, trace_max_width, '追溯码')
    trace_width = get_native_arial_font(size_pixels=trace_size).getlength(trace_text)
    trace_x = round(_QR_CENTER_X - trace_width / 2)
    text_items.append((trace_x, _TRACE_Y, trace_text, False, trace_size))

    # Fit the supplied 162x42 logo into a 20x5 mm box, retaining its ratio.
    logo = get_native_image_mask('wch-logo.png', 154)
    images = ((logo, (_QR_CENTER_X - logo.width // 2, 24)),)
    payload = ','.join(values[key] for key in _QR_FIELDS)
    payload = get_native_qr_payload(payload, source_qr, max_bytes=367)
    if source_qr is None:
        cell_dots = _qr_cell_dots(payload)
        # J2 centers the legacy native symbol on the trace text's axis.
        qr_commands = (
            f'QRCODE {_QR_CENTER_X},{_QR_Y},L,{cell_dots},A,0,J2,'
            f'{NATIVE_LABEL_QR_MODEL},{NATIVE_LABEL_QR_MASK},"{payload}"\r\n'
        )
    else:
        qr_image = build_reprint_qr_image(
            payload, 198, (484, 78, 800, 326), 539, 100, center_x=_QR_CENTER_X,
        )
        images += ((qr_image.image, (qr_image.x, qr_image.y)),)
        qr_commands = ''
    setup = b'SIZE 100 mm,50 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n'
    commands = (
        qr_commands +
        f'PRINT 1,{copies}\r\n'
    ).encode('ascii')
    return setup + build_native_text_bitmap(text_items, images) + commands
