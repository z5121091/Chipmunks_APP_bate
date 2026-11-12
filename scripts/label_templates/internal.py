import re

from .common import (
    NATIVE_LABEL_COPIES,
    build_native_text_bitmap,
    build_reprint_qr_image,
    get_native_chinese_font,
)


INTERNAL_LABEL_SEPARATOR = '~#~'
INTERNAL_LABEL_PREFIX = f'HLS{INTERNAL_LABEL_SEPARATOR}'
MAX_SAFE_INTEGER = 9007199254740991
_TEXT_X = 24
_VALUE_X = 176
_VALUE_WIDTH = 342
_MIN_TEXT_SIZE = 18
_SPECIFICATION_Y = 206
_QUANTITY_Y = 294
_MAX_QUANTITY_Y = 336
_QUANTITY_GAP = 12


def is_internal_label_qr(value):
    return isinstance(value, str) and value.startswith(INTERNAL_LABEL_PREFIX)


def _positive_integer(value, field):
    text = str(value)
    if not re.fullmatch(r'[1-9][0-9]{0,15}', text) or int(text) > MAX_SAFE_INTEGER:
        raise ValueError(f'内部标签{field}须为有效的正整数')
    return text


def _label_text(value, field):
    if not isinstance(value, str) or len(value) > 1000:
        raise ValueError(f'内部标签{field}含无法完整打印的字符或过长')
    # ERP fields can contain line breaks or tabs. Layout owns wrapping, and
    # preserving ordinary spaces keeps existing print job fingerprints valid.
    printable = re.sub(r'[ \r\n\t]+', lambda match: match.group() if match.group().strip(' ') == '' else ' ', value)
    if printable and not printable.isprintable():
        raise ValueError(f'内部标签{field}含无法完整打印的字符或过长')
    return printable.strip()


def normalize_internal_label_record(record):
    payload = record.get('source_qr')
    if not is_internal_label_qr(payload) or len(payload) > 4096:
        raise ValueError('内部标签二维码格式无效')
    parts = payload.split(INTERNAL_LABEL_SEPARATOR)
    if len(parts) != 5:
        raise ValueError('内部标签二维码须包含固定前缀及四个字段')
    _, inventory_code, quantity, package_id, revision = parts
    if (
        not inventory_code or len(inventory_code) > 120 or inventory_code != inventory_code.strip()
        or any(not 32 <= ord(char) <= 126 or char == '"' for char in inventory_code)
    ):
        raise ValueError('内部标签二维码中的存货编码无效')
    _positive_integer(quantity, '二维码数量')
    _positive_integer(revision, '版本')
    if not re.fullmatch(r'[A-Z0-9]{12,32}', package_id):
        raise ValueError('内部标签二维码中的包装编号无效')
    if record.get('inventory_code') != inventory_code:
        raise ValueError('内部标签二维码中的存货编码与打印信息不一致')
    if _positive_integer(record.get('quantity'), '数量') != quantity:
        raise ValueError('内部标签二维码中的数量与打印信息不一致')
    inventory_name = _label_text(record.get('inventory_name'), '存货名称')
    if not inventory_name:
        raise ValueError('内部标签缺少存货名称')
    specification = record.get('specification')
    return {
        'source_qr': payload,
        'inventory_code': inventory_code,
        'inventory_name': inventory_name,
        'specification': _label_text('' if specification is None else specification, '规格型号'),
        'quantity': quantity,
    }


def _value_items(text, name, y, size, bold, allow_wrap):
    def fits(value, font):
        left, _, right, _ = font.getbbox(value, anchor='lt')
        return right - min(left, 0) <= _VALUE_WIDTH

    for candidate in range(size, _MIN_TEXT_SIZE - 1, -1):
        font = get_native_chinese_font(bold=bold, size_pixels=candidate)
        if fits(text, font):
            return [(_VALUE_X, y, text, bold, candidate)]
    if allow_wrap:
        cut = 1
        while cut < len(text) and fits(text[:cut], font):
            cut += 1
        first, second = text[:cut - 1].rstrip(), text[cut - 1:].lstrip()
        if first and second and fits(second, font):
            return [(_VALUE_X, y, first, bold, _MIN_TEXT_SIZE),
                    (_VALUE_X, y + 24, second, bold, _MIN_TEXT_SIZE)]
    raise ValueError(f'内部标签{name}内容过长，无法完整打印')


def _wrap_specification(text):
    """Use the largest type that fits above the quantity, without clipping text."""
    for size in range(29, _MIN_TEXT_SIZE - 1, -1):
        font = get_native_chinese_font(bold=False, size_pixels=size)
        items = []
        y = _SPECIFICATION_Y
        remaining = text
        while remaining:
            if y + size > _MAX_QUANTITY_Y - _QUANTITY_GAP:
                break
            end = 0
            while end < len(remaining):
                left, _, right, _ = font.getbbox(remaining[:end + 1], anchor='lt')
                if right - min(left, 0) > _VALUE_WIDTH:
                    break
                end += 1
            if end == 0:
                break
            if end < len(remaining):
                # Keep the following field or model code together when the line contains a separator.
                breaks = [match.end() for match in re.finditer(r'[ ,，、;；/]', remaining[:end])]
                if breaks:
                    end = breaks[-1]
            line = remaining[:end].rstrip()
            height = max(size, font.getbbox(line, anchor='lt')[3])
            bottom = y + height
            if bottom > _MAX_QUANTITY_Y - _QUANTITY_GAP:
                break
            items.append((_VALUE_X, y, line, False, size))
            remaining = remaining[end:].lstrip()
            y = bottom + 5
        if not remaining:
            return items, max(_QUANTITY_Y, bottom + _QUANTITY_GAP)
    raise ValueError('内部标签规格型号内容过长，无法完整打印')


def build_native_internal_label(record, _template=None, copies=NATIVE_LABEL_COPIES, source_qr=None):
    if source_qr is not None and source_qr != record.get('source_qr'):
        raise ValueError('内部标签原始二维码与打印信息不一致')
    values = normalize_internal_label_record(record)
    specification_items, quantity_y = _wrap_specification(values['specification'] or '-')
    rows = (
        ('存货编码', values['inventory_code'], 42, 29, False, False),
        ('存货名称', values['inventory_name'], 124, 29, False, True),
    )
    text_items = []
    for name, value, y, size, bold, allow_wrap in rows:
        text_items.append((_TEXT_X, y, f'{name}：', bold, 27))
        text_items.extend(_value_items(value, name, y, size, bold, allow_wrap))
    text_items.append((_TEXT_X, _SPECIFICATION_Y, '规格型号：', False, 27))
    text_items.extend(specification_items)
    text_items.append((_TEXT_X, quantity_y, '数量：', True, 27))
    text_items.extend(_value_items(values['quantity'], '数量', quantity_y, 40, True, False))

    qr = build_reprint_qr_image(values['source_qr'], 188, (536, 42, 778, 356), 564, 106, center_x=657)
    setup = b'SIZE 100 mm,50 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n'
    return setup + build_native_text_bitmap(
        text_items, ((qr.image, (qr.x, qr.y)),), font_loader=get_native_chinese_font,
    ) + f'PRINT 1,{copies}\r\n'.encode('ascii')
