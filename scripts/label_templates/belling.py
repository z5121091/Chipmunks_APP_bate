"""Shanghai Belling's 100 x 50 mm label and original seven-field QR format."""

import os
import re
from datetime import date
from functools import lru_cache

from .common import (
    NATIVE_LABEL_COPIES,
    NATIVE_LABEL_WIDTH_DOTS,
    build_native_text_bitmap,
    build_reprint_qr_image,
    get_excel_cell_text,
    get_native_arial_font,
    get_native_qr_payload,
)


_SEPARATOR = '||'
_FIELDS = {
    'model': '型号',
    'package': '封装',
    'quantity': '数量',
    'production_date': '生产日期',
    'batch': '批次',
    'source_no': '箱号',
    'trace_no': '追溯码',
}
_BAD_WEEK = '贝岭标签生产周须为有效的 YYWW 格式，请核对二维码生产日期'
_BAD_SEGMENTS = '贝岭原始二维码须包含完整的七个双竖线分隔字段'

# 40 x 40 pixel monochrome emblem from the alpha channel of the right-hand
# Belling symbol supplied as logo_new.png. Each five-byte group is one row.
_EMBLEM = bytes.fromhex('''
    00003ffff8 00807ffffc 0180fffffe 0381fffffe
    0783ffffff 0f87ffffff 1f8fffffff 3f9fffffff
    7fffffffff ff800001fe ff800001fc ff800001f0
    ff800001e0 ff800001c0 ff80000100 ff807ffff0
    ff80fffffc ff81fffffe ff83fffffe ff87ffffff
    ff8fffffff ff9fffffff ff9fffffff ffffffffff
    ff800001fe ff800001fc ff800001f0 ff800001e0
    ff800001c0 ff80000100 ffffffff7e fffffffffe
    fffffffffc fffffffff8 fffffffff0 7ffffffff0
    3fffffffe0 3fffffffc0 0fffffff80 07ffffff00
''')


def _field(value, field_name):
    text = value if isinstance(value, str) else get_excel_cell_text(value)
    if any(not 32 <= ord(char) <= 126 or char in '"|' for char in text):
        raise ValueError(f'贝岭标签{field_name}含无法安全完整打印的字符')
    text = text.strip()
    if not text:
        raise ValueError(f'贝岭标签缺少{field_name}')
    if len(text) > 1000:
        raise ValueError(f'贝岭标签{field_name}内容超过1000字符，无法完整打印')
    return text


def _quantity(text):
    if not re.fullmatch(r'[0-9]+', text) or not 0 < int(text) <= 9007199254740991:
        raise ValueError('贝岭标签数量须为有效的正整数')
    return int(text)


def _week_monday(week_code):
    if not re.fullmatch(r'[0-9]{4}', week_code):
        raise ValueError(_BAD_WEEK)
    try:
        monday = date.fromisocalendar(2000 + int(week_code[:2]), int(week_code[2:]), 1)
    except ValueError as error:
        raise ValueError(_BAD_WEEK) from error
    return monday.strftime('%m-%d-%Y')


def _validated_fields(record, source_qr):
    values = {key: _field(record.get(key), name) for key, name in _FIELDS.items()}
    quantity = _quantity(values['quantity'])
    monday = _week_monday(values['production_date'])
    if source_qr is None:
        values['quantity'] = str(quantity)
        return values, monday, _SEPARATOR.join(values.values())

    payload = get_native_qr_payload('', source_qr, max_bytes=4096)
    body = re.fullmatch(r'([^\r\n]+)(?:\r\n|\r|\n)?', payload)
    parts = body[1].split(_SEPARATOR) if body else []
    if len(parts) != len(_FIELDS) or any(not part.strip() for part in parts):
        raise ValueError(_BAD_SEGMENTS)
    originals = {key: _field(part, name) for (key, name), part in zip(_FIELDS.items(), parts)}
    for key, name in _FIELDS.items():
        matches = _quantity(originals[key]) == quantity if key == 'quantity' else originals[key] == values[key]
        if not matches:
            raise ValueError(f'贝岭原始二维码{name}与解析结果不一致，请核对该字段和解析规则')
    return originals, monday, payload


@lru_cache(maxsize=1)
def _header_image():
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as error:
        raise RuntimeError('缺少 Pillow，无法生成贝岭标签') from error
    windows_root = os.environ.get('WINDIR') or os.environ.get('SystemRoot') or 'C:/Windows'
    font_path = os.path.join(windows_root, 'Fonts', 'timesbd.ttf')
    font = (
        ImageFont.truetype(font_path, 39) if os.path.isfile(font_path)
        else get_native_arial_font(bold=True, size_pixels=36)
    )
    title = 'Shanghai Belling Corporation Limited.'
    left, top, right, bottom = font.getbbox(title, anchor='lt')
    title_bitmap = Image.new('1', (right - left, bottom - top), 0)
    ImageDraw.Draw(title_bitmap).text((-left, -top), title, font=font, fill=1, anchor='lt')
    title_bitmap = title_bitmap.crop(title_bitmap.getbbox())

    emblem_size, gap, height = 40, 8, 46
    title_x = (NATIVE_LABEL_WIDTH_DOTS - title_bitmap.width) // 2
    header = Image.new('1', (NATIVE_LABEL_WIDTH_DOTS, height), 0)
    header.paste(
        Image.frombytes('1', (emblem_size, emblem_size), _EMBLEM),
        (title_x - gap - emblem_size, (height - emblem_size) // 2),
    )
    header.paste(title_bitmap, (title_x, (height - title_bitmap.height) // 2))
    return header


def _check_width(text, size, width, field_name):
    font = get_native_arial_font(bold=True, size_pixels=size)
    ink = font.getmask(text, mode='1').getbbox()
    if max(font.getlength(text), ink[2] if ink else 0) > width:
        raise ValueError(f'贝岭标签{field_name}文字超出模板宽度，请核对该字段内容和解析规则')


def build_native_belling_label(record, _template=None, copies=NATIVE_LABEL_COPIES, source_qr=None):
    if source_qr is None:
        source_qr = record.get('source_qr') or None
    values, monday, payload = _validated_fields(record, source_qr)
    # Match the mask read from the original Belling label.
    qr = build_reprint_qr_image(payload, 156, (578, 96, 785, 330), 606, 124, center_x=681, mask_pattern=2)
    rows = (
        ('PROD:', values['model'], '型号'),
        ('PKG:', values['package'], '封装'),
        ('QTY:', values['quantity'], '数量'),
        ('D/C:', values['production_date'], '生产日期'),
        ('BS Date:', monday, '生产日期'),
        ('LOT ID:', values['batch'] + '/' + values['source_no'], '批次和箱号'),
    )
    text_items = []
    for index, (caption, value, field_name) in enumerate(rows):
        y = 76 + 38 * index
        _check_width(value, 26, 410 if index != 3 else 276, field_name)
        text_items.extend(((26, y, caption, True, 26), (167, y, value, True, 26)))

    trace = values['trace_no']
    _check_width(trace, 18, 327, '追溯码')
    text_items.extend((
        (26, 309, 'ATL:', True, 26),
        (54, 360, trace, True, 18),
        (454, 190, 'MSL3', True, 31),
        (399, 354, 'MADE IN CHINA', True, 24),
    ))
    ellipses = (((599, 339, 676, 382), 2), ((686, 339, 779, 382), 2))
    font = get_native_arial_font(bold=True, size_pixels=22)
    for ((left, top, right, bottom), _stroke), text in zip(ellipses, ('H.F', 'RoHS')):
        x = round((left + right - font.getlength(text)) / 2)
        height = font.getbbox(text, anchor='lt')[3]
        text_items.append((x, round((top + bottom - height) / 2), text, True, 22))

    images = ((_header_image(), (0, 16)), (qr.image, (qr.x, qr.y)))
    setup = b'SIZE 100 mm,50 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n'
    return setup + build_native_text_bitmap(text_items, images, ellipse_items=ellipses) + f'PRINT 1,{copies}\r\n'.encode('ascii')
