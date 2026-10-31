import datetime
import os
import sys
from dataclasses import dataclass


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


def normalize_tspl_value(value, max_length, strict=False, field_name='标签字段'):
    """限制为安全 ASCII，避免字段内容破坏 TSPL 指令或超出标签范围。"""
    if strict:
        original_text = '' if value is None else str(value)
        if len(original_text) > 1000:
            raise ValueError(f'{field_name}内容超过1000字符，无法完整打印')
        if any(ord(character) < 32 or ord(character) > 126 or character == '"' for character in original_text):
            raise ValueError(f'{field_name}含无法安全完整打印的字符')
        # Character counts belonged to the old truncating export path. A
        # reprint keeps every original character and measures actual geometry.
        return original_text or '-'
    text = ' '.join(str(value or '').replace('\r', ' ').replace('\n', ' ').split())
    text = ''.join(character for character in text if ord(character) >= 32)
    text = text.replace('"', "'")
    ascii_text = text.encode('ascii', 'replace').decode('ascii')
    return ascii_text[:max_length] or '-'


def get_native_qr_payload(default_payload, source_qr=None, max_bytes=None):
    """Keep the original reprint payload, including CR/LF encoded in its bitmap.

    Native unpack commands use default_payload with source_qr=None. Reprint
    payloads are matrix data; they are never inserted into TSPL command strings.
    """
    if source_qr is None:
        return default_payload
    if not isinstance(source_qr, str) or not source_qr:
        raise ValueError('标签补打缺少原始二维码')
    if any((ord(char) < 32 and char not in '\r\n') or ord(char) > 126 or char == '"' for char in source_qr):
        raise ValueError('原始二维码含无法安全打印的字符，请核对解析规则')
    if max_bytes is not None and len(source_qr) > max_bytes:
        raise ValueError(
            f'原始二维码内容过长：当前{len(source_qr)}个字符，'
            f'本模板最多支持{max_bytes}个字符，无法完整打印'
        )
    return source_qr


@dataclass(frozen=True)
class ReprintQrImage:
    image: object
    x: int
    y: int
    symbol_x: int
    symbol_y: int
    modules: int
    cell_dots: int
    symbol_size: int
    quiet_right: int
    quiet_bottom: int
    version: int


def build_reprint_qr_image(
    payload,
    target_symbol_dots,
    bounds,
    preferred_x,
    preferred_y,
    center_x=None,
    error_correction='L',
    keep_symbol_position=False,
):
    """Draw one exact QR matrix in memory, using whole dots and a four-module border.

    Preferred coordinates refer to the black symbol. Returned x/y include its
    blank border; bounds and quiet_right/bottom use exclusive right/bottom edges.
    The legacy native QRCODE paths never call this helper.
    """
    payload = get_native_qr_payload('', payload)
    try:
        import qrcode
        from qrcode.constants import ERROR_CORRECT_H, ERROR_CORRECT_L
        from qrcode.exceptions import DataOverflowError
    except ImportError as error:
        raise RuntimeError(
            '缺少 qrcode，无法生成补打二维码，请重新安装或重新打包同步助手'
        ) from error
    try:
        from PIL import Image, ImageDraw
    except ImportError as error:
        raise RuntimeError('缺少 Pillow，无法生成补打二维码') from error

    left, top, right, bottom = bounds
    if (
        target_symbol_dots <= 0 or left < 0 or top < 0
        or right > NATIVE_LABEL_WIDTH_DOTS or bottom > NATIVE_LABEL_HEIGHT_DOTS
        or right <= left or bottom <= top
    ):
        raise ValueError('原始二维码内容过长，无法完整放入当前标签模板')

    correction_levels = {'L': ERROR_CORRECT_L, 'H': ERROR_CORRECT_H}
    if error_correction not in correction_levels:
        raise ValueError('二维码纠错等级无效')
    qr = qrcode.QRCode(error_correction=correction_levels[error_correction], mask_pattern=7, border=4)
    qr.add_data(payload.encode('ascii'))
    try:
        qr.make(fit=True)
    except DataOverflowError as error:
        raise ValueError('原始二维码内容过长，无法完整放入当前标签模板') from error
    matrix = qr.get_matrix()
    modules = qr.modules_count
    candidates = []
    for cell_dots in range(3, 11):
        symbol_size = modules * cell_dots
        image_size = (modules + 8) * cell_dots
        if image_size > right - left or image_size > bottom - top:
            continue
        if center_x is None:
            image_x = round(preferred_x) - 4 * cell_dots
            if keep_symbol_position:
                if image_x < left or image_x + image_size > right:
                    continue
            else:
                image_x = min(max(image_x, left), right - image_size)
        else:
            image_x = round(center_x - symbol_size / 2) - 4 * cell_dots
            if image_x < left or image_x + image_size > right:
                continue
        image_y = round(preferred_y) - 4 * cell_dots
        if keep_symbol_position:
            if image_y < top or image_y + image_size > bottom:
                continue
        else:
            image_y = min(max(image_y, top), bottom - image_size)
        candidates.append((abs(symbol_size - target_symbol_dots), -cell_dots, image_x, image_y))
    if not candidates:
        if keep_symbol_position:
            return build_reprint_qr_image(
                payload, target_symbol_dots, bounds, preferred_x, preferred_y,
                center_x=center_x, error_correction=error_correction,
            )
        raise ValueError('原始二维码内容过长，无法完整放入当前标签模板')

    _distance, negative_cell, image_x, image_y = min(candidates)
    cell_dots = -negative_cell
    symbol_size = modules * cell_dots
    image_size = len(matrix) * cell_dots
    image = Image.new('1', (image_size, image_size), 0)
    draw = ImageDraw.Draw(image)
    for row_index, row in enumerate(matrix):
        for column_index, dark in enumerate(row):
            if dark:
                x = column_index * cell_dots
                y = row_index * cell_dots
                draw.rectangle((x, y, x + cell_dots - 1, y + cell_dots - 1), fill=1)
    return ReprintQrImage(
        image=image,
        x=image_x,
        y=image_y,
        symbol_x=image_x + 4 * cell_dots,
        symbol_y=image_y + 4 * cell_dots,
        modules=modules,
        cell_dots=cell_dots,
        symbol_size=symbol_size,
        quiet_right=image_x + image_size,
        quiet_bottom=image_y + image_size,
        version=qr.version,
    )


def assert_native_text_width(text, available_width, size_pixels=NATIVE_LABEL_FONT_SIZE_PIXELS, field_name='标签文字'):
    font = get_native_arial_font(size_pixels=size_pixels)
    # Pillow's one-bit ink metrics can be wider than its advance metrics.
    # Measure the same mask mode used by the printer bitmap, including overhang.
    ink_bounds = font.getmask(text, mode='1').getbbox()
    actual_width = max(font.getlength(text), ink_bounds[2] if ink_bounds else 0)
    if actual_width > available_width:
        actual_mm = actual_width * 25.4 / NATIVE_LABEL_DPI
        available_mm = available_width * 25.4 / NATIVE_LABEL_DPI
        raise ValueError(
            f'{field_name}文字超出模板宽度：需要{actual_mm:.1f}毫米，'
            f'可用{available_mm:.1f}毫米；请核对该字段内容和解析规则'
        )


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
