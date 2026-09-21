import datetime
import os
import sys


NATIVE_LABEL_COPIES = 2
NATIVE_LABEL_DPI = 203
NATIVE_LABEL_WIDTH_DOTS = 800
NATIVE_LABEL_HEIGHT_DOTS = 400
NATIVE_LABEL_FONT_SIZE_PIXELS = round(8 * NATIVE_LABEL_DPI / 72)
NATIVE_LABEL_QR_MODEL = 'M2'
NATIVE_LABEL_QR_MASK = 'S7'

NATIVE_LABEL_FIELD_HEADERS = {
    'model': '型号',
    'quantity': '标签数量',
    'batch': '批次',
    'production_date': '生产日期',
    'package': '封装',
    'trace_no': '追溯码',
    'inventory_code': '存货编码',
    'source_no': '箱号',
    'version': '版本号',
    'label_type': '标签类型',
    'supplier': '供应商',
    'unpacked_at': '拆包时间',
}
NATIVE_LABEL_REQUIRED_HEADERS = ('型号', '标签数量', '追溯码')
NATIVE_LABEL_REQUIRED_VALUES = (('型号', 'model'), ('标签数量', 'quantity'))

_FONT_CACHE = {}
_IMAGE_CACHE = {}


def get_excel_cell_text(value):
    """把 Excel 单元格转换为稳定文本，避免数量被写成 2500.0。"""
    if value is None:
        return ''
    if isinstance(value, datetime.datetime):
        return value.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(value, datetime.date):
        return value.strftime('%Y-%m-%d')
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def get_native_label_records(workbook):
    """按统一字段规范读取标签 Excel。"""
    sheet = workbook.active
    header_values = next(sheet.iter_rows(min_row=1, max_row=1, values_only=True), None)
    if not header_values:
        raise ValueError('标签 Excel 缺少表头')

    header_indexes = {
        get_excel_cell_text(header).replace(' ', ''): index
        for index, header in enumerate(header_values)
        if get_excel_cell_text(header)
    }
    missing_headers = [
        header for header in NATIVE_LABEL_REQUIRED_HEADERS
        if header not in header_indexes
    ]
    if missing_headers:
        raise ValueError(f'标签 Excel 缺少字段：{"、".join(missing_headers)}')

    def get_value(row, header):
        index = header_indexes.get(header)
        return get_excel_cell_text(row[index]) if index is not None and index < len(row) else ''

    records = []
    for row_number, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
        if not any(value is not None and get_excel_cell_text(value) for value in row):
            continue

        record = {
            key: get_value(row, header)
            for key, header in NATIVE_LABEL_FIELD_HEADERS.items()
        }
        missing_values = [
            label for label, key in NATIVE_LABEL_REQUIRED_VALUES if not record[key]
        ]
        if missing_values:
            raise ValueError(
                f'标签 Excel 第 {row_number} 行缺少：{"、".join(missing_values)}'
            )
        records.append(record)

    if not records:
        raise ValueError('标签 Excel 没有可打印的数据')
    return records


def normalize_tspl_value(value, max_length):
    """限制为安全 ASCII，避免字段内容破坏 TSPL 指令或超出标签范围。"""
    text = ' '.join(str(value or '').replace('\r', ' ').replace('\n', ' ').split())
    text = ''.join(character for character in text if ord(character) >= 32)
    text = text.replace('"', "'")
    ascii_text = text.encode('ascii', 'replace').decode('ascii')
    return ascii_text[:max_length] or '-'


def get_native_arial_font(bold=False, size_pixels=NATIVE_LABEL_FONT_SIZE_PIXELS):
    cache_key = ('bold' if bold else 'regular', size_pixels)
    cached_font = _FONT_CACHE.get(cache_key)
    if cached_font is not None:
        return cached_font

    try:
        from PIL import ImageFont
    except ImportError as error:
        raise RuntimeError('缺少 Pillow，无法生成 Arial 标签文字') from error

    windows_root = os.environ.get('WINDIR') or os.environ.get('SystemRoot') or 'C:/Windows'
    font_path = os.path.join(
        windows_root,
        'Fonts',
        'arialbd.ttf' if bold else 'arial.ttf',
    )
    if not os.path.isfile(font_path):
        raise RuntimeError(f'未找到 Windows 字体文件：{font_path}')

    font = ImageFont.truetype(font_path, size_pixels)
    _FONT_CACHE[cache_key] = font
    return font


def get_native_right_aligned_text_x(text, right_edge_x, bold=False):
    text_width = get_native_arial_font(bold=bold).getlength(text)
    return max(0, right_edge_x - int(text_width + 0.999))


def get_native_centered_text_x(
    text,
    bold=False,
    size_pixels=NATIVE_LABEL_FONT_SIZE_PIXELS,
):
    text_width = get_native_arial_font(
        bold=bold,
        size_pixels=size_pixels,
    ).getlength(text)
    return max(0, (NATIVE_LABEL_WIDTH_DOTS - int(text_width + 0.999)) // 2)


def _resource_path(relative_path):
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    scripts_directory = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(scripts_directory, relative_path)


def get_native_image_mask(asset_name, target_width, target_height=None):
    cache_key = (asset_name, target_width, target_height)
    cached_image = _IMAGE_CACHE.get(cache_key)
    if cached_image is not None:
        return cached_image

    try:
        from PIL import Image
    except ImportError as error:
        raise RuntimeError('缺少 Pillow，无法生成标签图片') from error

    image_path = _resource_path(os.path.join('assets', asset_name))
    if not os.path.isfile(image_path):
        raise RuntimeError(f'未找到标签图片文件：{image_path}')

    with Image.open(image_path) as source_image:
        rgba_image = source_image.convert('RGBA')
        white_background = Image.new('RGBA', rgba_image.size, (255, 255, 255, 255))
        white_background.alpha_composite(rgba_image)
        grayscale_image = white_background.convert('L')

    if target_height is None:
        target_height = max(
            1,
            round(grayscale_image.height * target_width / grayscale_image.width),
        )
    resampling = getattr(Image, 'Resampling', Image)
    resized_image = grayscale_image.resize(
        (target_width, target_height),
        resampling.LANCZOS,
    )
    image_mask = resized_image.point(
        lambda value: 255 if value < 224 else 0,
        mode='1',
    )
    _IMAGE_CACHE[cache_key] = image_mask
    return image_mask


def build_native_text_bitmap(
    text_items,
    image_items=(),
    ellipse_items=(),
    line_items=(),
    font_loader=get_native_arial_font,
):
    """把模板中的文字、图片和简单线条合并为一个 TSPL 位图层。"""
    try:
        from PIL import Image, ImageDraw
    except ImportError as error:
        raise RuntimeError('缺少 Pillow，无法生成 Arial 标签文字') from error

    image = Image.new('1', (NATIVE_LABEL_WIDTH_DOTS, NATIVE_LABEL_HEIGHT_DOTS), 0)
    draw = ImageDraw.Draw(image)
    for image_mask, position in image_items:
        image.paste(image_mask, position)
    for bounds, width in ellipse_items:
        draw.ellipse(bounds, outline=1, width=width)
    for points, width in line_items:
        draw.line(points, fill=1, width=width)
    for x, y, text, bold, *font_sizes in text_items:
        draw.text(
            (x, y),
            text,
            font=font_loader(
                bold=bold,
                size_pixels=font_sizes[0] if font_sizes else NATIVE_LABEL_FONT_SIZE_PIXELS,
            ),
            fill=1,
            anchor='lt',
        )

    width_bytes = (NATIVE_LABEL_WIDTH_DOTS + 7) // 8
    # TTP-244 Pro 的 BITMAP 位值是 0 打印、1 留白，与 Pillow 的蒙版相反。
    bitmap_data = bytes(value ^ 0xFF for value in image.tobytes())
    expected_size = width_bytes * NATIVE_LABEL_HEIGHT_DOTS
    if len(bitmap_data) != expected_size:
        raise RuntimeError('Arial 标签文字位图尺寸异常')

    command = f'BITMAP 0,0,{width_bytes},{NATIVE_LABEL_HEIGHT_DOTS},0,'.encode('ascii')
    return command + bitmap_data + b'\r\n'
