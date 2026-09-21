import datetime
import os
from functools import lru_cache

from .common import (
    NATIVE_LABEL_FONT_SIZE_PIXELS,
    NATIVE_LABEL_WIDTH_DOTS,
    build_native_text_bitmap,
    get_excel_cell_text,
)


@lru_cache(maxsize=32)
def get_unpack_time_font(bold=False, size_pixels=NATIVE_LABEL_FONT_SIZE_PIXELS):
    from PIL import ImageFont

    windows_root = os.environ.get('WINDIR') or os.environ.get('SystemRoot') or 'C:/Windows'
    font_path = os.path.join(windows_root, 'Fonts', 'msyhbd.ttc' if bold else 'msyh.ttc')
    if not os.path.isfile(font_path):
        raise RuntimeError('未找到微软雅黑字体，无法打印中文拆包时间标签')
    return ImageFont.truetype(font_path, size_pixels)


def format_unpack_time(value):
    text = get_excel_cell_text(value)
    try:
        return datetime.datetime.fromisoformat(text.replace('/', '-')).strftime('%Y-%m-%d %H:%M')
    except ValueError:
        # Missing historical timestamps must not become the current print time.
        return '-'


def build_native_unpack_time_label(record):
    """每次拆包额外打印一张 100x50mm 记录标签，不改变供应商标签。"""
    rows = (
        ('物料型号：', get_excel_cell_text(record.get('model')) or '-'),
        ('存货编码：', get_excel_cell_text(record.get('inventory_code')) or '-'),
        ('湿敏等级：', 'MSL-3'),
        ('最后拆包时间：', format_unpack_time(record.get('unpacked_at'))),
        ('状态：', '已入干燥柜 / 敞口存放'),
    )
    text_items = []
    for index, (title, value) in enumerate(rows):
        y = 64 + index * 60
        value = ' '.join(value.split())
        size = NATIVE_LABEL_FONT_SIZE_PIXELS
        while size > 16 and get_unpack_time_font(size_pixels=size).getlength(value) > NATIVE_LABEL_WIDTH_DOTS - 270:
            size -= 1
        if get_unpack_time_font(size_pixels=size).getlength(value) > NATIVE_LABEL_WIDTH_DOTS - 270:
            raise ValueError(f'拆包时间标签的{title}内容过长，无法完整打印')
        text_items.extend(((40, y, title, False), (230, y, value, False, size)))

    setup = b'SIZE 100 mm,50 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n'
    return setup + build_native_text_bitmap(text_items, font_loader=get_unpack_time_font) + b'PRINT 1,1\r\n'
