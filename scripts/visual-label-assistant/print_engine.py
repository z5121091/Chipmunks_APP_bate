from __future__ import annotations

import io
import math
import os
import sys
from pathlib import Path
from typing import Any

from template_model import build_qr_content, normalize_record, normalize_text, resolve_content, resource_path, validate_template


RAW_PRINT_CHUNK_BYTES = 64 * 1024
FONT_PATH_CACHE: dict[tuple[str, bool, bool], str | None] = {}
FONT_OBJECT_CACHE: dict[tuple[str, int, bool, bool], Any] = {}
IMAGE_CACHE: dict[tuple[str, int, int, bool], Any] = {}

FONT_FAMILY_ALIASES = {
    '微软雅黑': 'Microsoft YaHei',
    '微软雅黑 ui': 'Microsoft YaHei UI',
    '宋体': 'SimSun',
    '新宋体': 'NSimSun',
    '黑体': 'SimHei',
    '楷体': 'KaiTi',
    '仿宋': 'FangSong',
    '等线': 'DengXian',
}
CJK_FONT_TOKENS = (
    'yahei', 'simsun', 'nsimsun', 'simhei', 'kaiti', 'fangsong',
    'dengxian', 'noto sans cjk', 'source han', 'pingfang',
)


def mm_to_dots(value_mm: float, dpi: int) -> int:
    return max(1, round(float(value_mm) * int(dpi) / 25.4))


def dots_to_mm(value_dots: float, dpi: int) -> float:
    return float(value_dots) * 25.4 / int(dpi)


def get_label_dimensions(template: dict[str, Any]) -> tuple[int, int, int]:
    label = template['label']
    dpi = int(label.get('dpi', 203))
    return (
        int(label.get('widthDots') or mm_to_dots(float(label['widthMm']), dpi)),
        int(label.get('heightDots') or mm_to_dots(float(label['heightMm']), dpi)),
        dpi,
    )


def _find_windows_font(family: str, bold: bool, italic: bool) -> str | None:
    if os.name != 'nt':
        return None
    try:
        import winreg
    except ImportError:
        return None

    requested = family.casefold().strip()
    style_tokens = []
    if bold:
        style_tokens.append('bold')
    if italic:
        style_tokens.extend(('italic', 'oblique'))

    candidates: list[tuple[int, str]] = []
    registry_paths = (
        r'SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts',
        r'SOFTWARE\WOW6432Node\Microsoft\Windows NT\CurrentVersion\Fonts',
    )
    for registry_path in registry_paths:
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, registry_path) as key:
                index = 0
                while True:
                    try:
                        value_name, file_name, _ = winreg.EnumValue(key, index)
                    except OSError:
                        break
                    index += 1
                    normalized_name = value_name.casefold()
                    if requested not in normalized_name:
                        continue
                    score = 100
                    has_bold = 'bold' in normalized_name
                    has_italic = 'italic' in normalized_name or 'oblique' in normalized_name
                    score -= 30 if has_bold == bold else 0
                    score -= 30 if has_italic == italic else 0
                    if style_tokens and any(token in normalized_name for token in style_tokens):
                        score -= 10
                    font_path = Path(str(file_name))
                    if not font_path.is_absolute():
                        font_path = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / font_path
                    if font_path.is_file():
                        candidates.append((score, str(font_path)))
        except OSError:
            continue
    return sorted(candidates, key=lambda item: item[0])[0][1] if candidates else None


def resolve_font_path(family: str, bold: bool = False, italic: bool = False) -> str | None:
    family = FONT_FAMILY_ALIASES.get((family or '').casefold().strip(), family or 'Arial')
    cache_key = (family.casefold().strip(), bold, italic)
    if cache_key in FONT_PATH_CACHE:
        return FONT_PATH_CACHE[cache_key]

    path = _find_windows_font(family or 'Arial', bold, italic)
    if path is None and (family or '').casefold() != 'arial':
        path = _find_windows_font('Arial', bold, italic)
    FONT_PATH_CACHE[cache_key] = path
    return path


def _contains_cjk(text: str) -> bool:
    return any(
        '\u3400' <= character <= '\u9fff'
        or '\uf900' <= character <= '\ufaff'
        for character in text
    )


def _font_family_for_text(family: str, text: str) -> str:
    requested = FONT_FAMILY_ALIASES.get((family or '').casefold().strip(), family or 'Arial')
    normalized = requested.casefold()
    if _contains_cjk(text) and not any(token in normalized for token in CJK_FONT_TOKENS):
        return 'Microsoft YaHei UI'
    return requested


def get_font(
    family: str,
    size_pt: float,
    dpi: int,
    bold: bool = False,
    italic: bool = False,
    text: str = '',
):
    try:
        from PIL import ImageFont
    except ImportError as error:
        raise RuntimeError('缺少 Pillow，无法渲染标签文字') from error

    render_family = _font_family_for_text(family, text)
    pixel_size = max(6, round(float(size_pt) * int(dpi) / 72))
    cache_key = (render_family.casefold().strip(), pixel_size, bold, italic)
    cached = FONT_OBJECT_CACHE.get(cache_key)
    if cached is not None:
        return cached

    font_path = resolve_font_path(render_family, bold, italic)
    font = ImageFont.truetype(font_path, pixel_size) if font_path else ImageFont.load_default()
    FONT_OBJECT_CACHE[cache_key] = font
    return font


def _text_size(draw, text: str, font) -> tuple[int, int]:
    if not text:
        return 0, 0
    box = draw.textbbox((0, 0), text, font=font)
    return max(0, box[2] - box[0]), max(0, box[3] - box[1])


def _fit_font(draw, text: str, element: dict[str, Any], dpi: int, max_width: int, max_height: int):
    size_pt = float(element.get('fontSizePt', 8))
    minimum_pt = float(element.get('minimumFontSizePt', 4))
    font = get_font(
        str(element.get('fontFamily', 'Arial')),
        size_pt,
        dpi,
        bool(element.get('bold')),
        bool(element.get('italic')),
        text,
    )
    if element.get('overflow', 'shrink') != 'shrink':
        return font

    while size_pt > minimum_pt:
        width, height = _text_size(draw, text, font)
        if width <= max_width and height <= max_height:
            break
        size_pt = max(minimum_pt, size_pt - 0.5)
        font = get_font(
            str(element.get('fontFamily', 'Arial')),
            size_pt,
            dpi,
            bool(element.get('bold')),
            bool(element.get('italic')),
            text,
        )
    return font


def _aligned_text_position(
    draw,
    text: str,
    font,
    x: int,
    y: int,
    width: int,
    height: int,
    horizontal: str,
    vertical: str,
) -> tuple[int, int]:
    text_width, text_height = _text_size(draw, text, font)
    if horizontal == 'right':
        draw_x = x + max(0, width - text_width)
    elif horizontal == 'center':
        draw_x = x + max(0, (width - text_width) // 2)
    else:
        draw_x = x
    if vertical == 'bottom':
        draw_y = y + max(0, height - text_height)
    elif vertical == 'middle':
        draw_y = y + max(0, (height - text_height) // 2)
    else:
        draw_y = y
    return draw_x, draw_y


def _resolve_image_path(path_value: str) -> Path:
    path = Path(path_value).expanduser()
    if path.is_absolute() and path.is_file():
        return path.resolve()
    packaged_path = resource_path(path_value)
    if packaged_path.is_file():
        return packaged_path
    raise FileNotFoundError(f'标签图片不存在：{path_value}')


def _load_monochrome_image(
    path_value: str,
    width: int,
    height: int,
    keep_aspect_ratio: bool = True,
):
    try:
        from PIL import Image, ImageOps
    except ImportError as error:
        raise RuntimeError('缺少 Pillow，无法渲染标签图片') from error

    image_path = _resolve_image_path(path_value)
    cache_key = (str(image_path), width, height, keep_aspect_ratio)
    cached = IMAGE_CACHE.get(cache_key)
    if cached is not None:
        return cached.copy()

    with Image.open(image_path) as source:
        rgba = source.convert('RGBA')
        background = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
        background.alpha_composite(rgba)
        grayscale = background.convert('L')
    target_size = (max(1, width), max(1, height))
    if keep_aspect_ratio:
        resized = ImageOps.contain(grayscale, target_size, Image.Resampling.LANCZOS)
        canvas = Image.new('L', target_size, 255)
        canvas.paste(
            resized,
            ((target_size[0] - resized.width) // 2, (target_size[1] - resized.height) // 2),
        )
        resized = canvas
    else:
        resized = grayscale.resize(target_size, Image.Resampling.LANCZOS)
    monochrome = resized.point(lambda value: 255 if value >= 180 else 0, mode='1')
    IMAGE_CACHE[cache_key] = monochrome
    return monochrome.copy()


def _draw_text_element(image, draw, element: dict[str, Any], record: dict[str, str], dpi: int) -> None:
    value = resolve_content(element['content'], record)
    if element.get('hideWhenEmpty') and not value:
        return
    title = normalize_text(element.get('title')) if element.get('showTitle', True) else ''
    x = round(float(element.get('x', 0)))
    y = round(float(element.get('y', 0)))
    width = max(1, round(float(element.get('width', 1))))
    height = max(1, round(float(element.get('height', 1))))
    value_offset = max(0, min(width, round(float(element.get('valueOffsetDots', 0))))) if title else 0

    base_font = get_font(
        str(element.get('fontFamily', 'Arial')),
        float(element.get('fontSizePt', 8)),
        dpi,
        bool(element.get('bold')),
        bool(element.get('italic')),
        title,
    )
    if title:
        draw.text((x, y), title, font=base_font, fill=0)

    content_x = x + value_offset
    content_width = max(1, width - value_offset)
    font = _fit_font(draw, value, element, dpi, content_width, height)
    draw_x, draw_y = _aligned_text_position(
        draw,
        value,
        font,
        content_x,
        y,
        content_width,
        height,
        str(element.get('horizontalAlign', 'left')),
        str(element.get('verticalAlign', 'top')),
    )
    draw.text((draw_x, draw_y), value, font=font, fill=0)


def render_static_layer(template: dict[str, Any], record: dict[str, Any]):
    try:
        from PIL import Image, ImageDraw
    except ImportError as error:
        raise RuntimeError('缺少 Pillow，无法生成标签位图') from error

    width, height, dpi = get_label_dimensions(template)
    normalized_record = normalize_record(record)
    image = Image.new('1', (width, height), 1)
    draw = ImageDraw.Draw(image)

    for element in template.get('elements', []):
        if not element.get('visible', True):
            continue
        element_type = element.get('type')
        if element_type == 'text':
            _draw_text_element(image, draw, element, normalized_record, dpi)
        elif element_type == 'image':
            x = round(float(element.get('x', 0)))
            y = round(float(element.get('y', 0)))
            element_image = _load_monochrome_image(
                str(element.get('path', '')),
                max(1, round(float(element.get('width', 1)))),
                max(1, round(float(element.get('height', 1)))),
                bool(element.get('keepAspectRatio', element.get('keepAspect', True))),
            )
            image.paste(element_image, (x, y))
    return image


def _sanitize_tspl_text(value: Any, max_length: int = 512) -> str:
    text = normalize_text(value).replace('"', "'")
    try:
        return text.encode('ascii').decode('ascii')[:max_length]
    except UnicodeEncodeError as error:
        raise ValueError('条码和二维码内容仅支持 ASCII 字符；中文请使用文字元素') from error


def _validate_element_bounds(
    element: dict[str, Any],
    element_width: int,
    element_height: int,
    label_width: int,
    label_height: int,
) -> None:
    x = round(float(element.get('x', 0)))
    y = round(float(element.get('y', 0)))
    if x + element_width > label_width or y + element_height > label_height:
        name = normalize_text(element.get('name')) or normalize_text(element.get('id')) or '未命名元素'
        raise ValueError(
            f'元素“{name}”超出标签范围：结束位置 {x + element_width} x {y + element_height}，'
            f'标签为 {label_width} x {label_height} 点'
        )


def build_label_tspl(
    template: dict[str, Any],
    record: dict[str, Any],
    copies_override: int | None = None,
) -> bytes:
    validate_template(template)
    normalized_record = normalize_record(record)
    width, height, _dpi = get_label_dimensions(template)
    label = template['label']

    setup_commands = '\r\n'.join(
        [
            f'SIZE {float(label["widthMm"]):g} mm,{float(label["heightMm"]):g} mm',
            f'GAP {float(label.get("gapMm", 0)):g} mm,0 mm',
            f'DIRECTION {int(label.get("direction", 1))}',
            'CLS',
            '',
        ]
    ).encode('ascii')

    for element in template.get('elements', []):
        if not element.get('visible', True):
            continue
        element_type = element.get('type')
        if element_type == 'barcode':
            value = _sanitize_tspl_text(resolve_content(element['content'], normalized_record), 160)
            if not value:
                continue
            element_width, element_height = get_barcode_native_dimensions(element, value)
        elif element_type == 'qrcode':
            value = _sanitize_tspl_text(build_qr_content(element, normalized_record), 1000)
            if not value:
                continue
            element_width, element_height = get_qr_native_dimensions(element, value)
        else:
            element_width = max(1, round(float(element.get('width', 1))))
            element_height = max(1, round(float(element.get('height', 1))))
        _validate_element_bounds(element, element_width, element_height, width, height)

    static_layer = render_static_layer(template, normalized_record)
    width_bytes = (width + 7) // 8
    if width % 8:
        from PIL import Image

        padded = Image.new('1', (width_bytes * 8, height), 1)
        padded.paste(static_layer, (0, 0))
    else:
        padded = static_layer
    # Pillow mode "1" already stores white as 1 and black as 0. TSC BITMAP
    # uses the same polarity, so inverting the bytes produces a black label.
    bitmap_data = padded.tobytes()
    bitmap_command = f'BITMAP 0,0,{width_bytes},{height},0,'.encode('ascii') + bitmap_data + b'\r\n'

    commands: list[str] = []
    for element in template.get('elements', []):
        if not element.get('visible', True):
            continue
        element_type = element.get('type')
        x = round(float(element.get('x', 0)))
        y = round(float(element.get('y', 0)))
        if element_type == 'barcode':
            value = _sanitize_tspl_text(resolve_content(element['content'], normalized_record), 160)
            if not value:
                continue
            height_dots = max(4, round(float(element.get('heightDots', element.get('height', 32)))))
            human_readable = 1 if element.get('humanReadable') else 0
            rotation = int(element.get('rotation', 0))
            narrow = max(1, min(10, int(element.get('narrowDots', 1))))
            wide = max(1, min(10, int(element.get('wideDots', narrow))))
            commands.append(
                f'BARCODE {x},{y},"128",{height_dots},{human_readable},{rotation},{narrow},{wide},"{value}"'
            )
        elif element_type == 'qrcode':
            value = _sanitize_tspl_text(build_qr_content(element, normalized_record), 1000)
            if not value:
                continue
            ecc = element.get('ecc', 'L')
            cell = max(1, min(10, int(element.get('cellDots', 4))))
            rotation = int(element.get('rotation', 0))
            model = element.get('model', 'M2')
            mask = element.get('mask', 'S7')
            commands.append(f'QRCODE {x},{y},{ecc},{cell},A,{rotation},{model},{mask},"{value}"')

    copies = max(1, int(copies_override or label.get('copies', 1)))
    commands.extend([f'PRINT 1,{copies}', ''])
    return setup_commands + bitmap_command + '\r\n'.join(commands).encode('ascii')


def get_code128_pattern(value: str) -> str:
    try:
        import barcode

        code = barcode.get('code128', value or '-')
        return code.build()[0]
    except ImportError as error:
        raise RuntimeError('缺少 python-barcode，无法生成 Code 128 条码') from error


def get_barcode_native_dimensions(element: dict[str, Any], value: str) -> tuple[int, int]:
    pattern = get_code128_pattern(value)
    narrow = max(1, min(10, int(element.get('narrowDots', 1))))
    height = max(4, round(float(element.get('heightDots', element.get('height', 32)))))
    return max(1, len(pattern) * narrow), height


def _render_barcode_preview(element: dict[str, Any], value: str):
    from PIL import Image, ImageDraw

    pattern = get_code128_pattern(value)
    narrow = max(1, min(10, int(element.get('narrowDots', 1))))
    width, height = get_barcode_native_dimensions(element, value)
    image = Image.new('1', (width, height), 1)
    draw = ImageDraw.Draw(image)
    for index, module in enumerate(pattern):
        if module == '1':
            x = index * narrow
            draw.rectangle((x, 0, x + narrow - 1, height - 1), fill=0)
    return image


def _make_qr_code(element: dict[str, Any], value: str):
    try:
        import qrcode
        from qrcode.constants import ERROR_CORRECT_H, ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q
    except ImportError as error:
        raise RuntimeError('缺少 qrcode，无法生成二维码') from error

    ecc_map = {
        'L': ERROR_CORRECT_L,
        'M': ERROR_CORRECT_M,
        'Q': ERROR_CORRECT_Q,
        'H': ERROR_CORRECT_H,
    }
    mask_value = str(element.get('mask', 'S7')).upper()
    mask_pattern = int(mask_value[1:]) if mask_value in {f'S{index}' for index in range(8)} else None
    qr = qrcode.QRCode(
        version=None,
        error_correction=ecc_map.get(str(element.get('ecc', 'L')), ERROR_CORRECT_L),
        box_size=max(1, min(10, int(element.get('cellDots', 4)))),
        border=0,
        mask_pattern=mask_pattern,
    )
    qr.add_data(value)
    qr.make(fit=True)
    return qr


def get_qr_native_dimensions(element: dict[str, Any], value: str) -> tuple[int, int]:
    qr = _make_qr_code(element, value)
    side = len(qr.get_matrix()) * max(1, min(10, int(element.get('cellDots', 4))))
    return side, side


def _render_qr_preview(element: dict[str, Any], value: str):
    qr = _make_qr_code(element, value)
    return qr.make_image(fill_color='black', back_color='white').convert('1')


def render_preview(template: dict[str, Any], record: dict[str, Any]):
    image = render_static_layer(template, record).convert('L')
    normalized_record = normalize_record(record)
    for element in template.get('elements', []):
        if not element.get('visible', True):
            continue
        element_type = element.get('type')
        if element_type == 'barcode':
            value = _sanitize_tspl_text(resolve_content(element['content'], normalized_record), 160)
            if not value:
                continue
            element_image = _render_barcode_preview(element, value).convert('L')
        elif element_type == 'qrcode':
            value = _sanitize_tspl_text(build_qr_content(element, normalized_record), 1000)
            if not value:
                continue
            element_image = _render_qr_preview(element, value).convert('L')
        else:
            continue
        image.paste(
            element_image,
            (round(float(element.get('x', 0))), round(float(element.get('y', 0)))),
        )
    return image


def get_installed_printer_names() -> list[str]:
    try:
        import win32print
    except ImportError as error:
        raise RuntimeError('缺少 pywin32，无法读取 Windows 打印机') from error
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    printers = win32print.EnumPrinters(flags, None, 2)
    return sorted(
        str(printer.get('pPrinterName', '')).strip()
        for printer in printers
        if printer.get('pPrinterName')
    )


def send_raw_tspl_to_printer(printer_name: str, commands: bytes, job_name: str) -> int:
    try:
        import win32print
    except ImportError as error:
        raise RuntimeError('缺少 pywin32，无法发送标签到打印机') from error

    normalized_name = normalize_text(printer_name)
    if not normalized_name:
        raise ValueError('请选择打印机')
    installed = get_installed_printer_names()
    if normalized_name not in installed:
        raise ValueError(f'未找到打印机“{normalized_name}”')

    handle = win32print.OpenPrinter(normalized_name)
    job_started = False
    page_started = False
    try:
        job_id = win32print.StartDocPrinter(handle, 1, (job_name, None, 'RAW'))
        job_started = True
        win32print.StartPagePrinter(handle)
        page_started = True
        offset = 0
        while offset < len(commands):
            chunk = commands[offset : offset + RAW_PRINT_CHUNK_BYTES]
            written = win32print.WritePrinter(handle, chunk)
            written_count = len(chunk) if written is None else int(written)
            if written_count <= 0:
                raise RuntimeError('Windows 打印队列未接收标签数据')
            offset += written_count
        win32print.EndPagePrinter(handle)
        page_started = False
        win32print.EndDocPrinter(handle)
        job_started = False
        return int(job_id)
    finally:
        if page_started:
            try:
                win32print.EndPagePrinter(handle)
            except Exception:
                pass
        if job_started:
            try:
                win32print.EndDocPrinter(handle)
            except Exception:
                pass
        win32print.ClosePrinter(handle)


def print_template(
    printer_name: str,
    template: dict[str, Any],
    record: dict[str, Any],
    copies_override: int | None = None,
) -> int:
    commands = build_label_tspl(template, record, copies_override)
    return send_raw_tspl_to_printer(
        printer_name,
        commands,
        f'Palm Warehouse - {normalize_text(template.get("name"))}',
    )
