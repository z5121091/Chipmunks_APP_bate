#!/usr/bin/python
# -*- coding: utf-8 -*-

"""
掌上仓库 ERP版同步助手
功能：接收手机发送的数据，自动保存为Excel文件
支持：系统托盘、开机自启动、日志轮转
"""

import cherrypy
import json
import datetime
import os
import sys
import socket
import threading
import uuid
import logging
from logging.handlers import RotatingFileHandler
from openpyxl import Workbook, load_workbook
from openpyxl.utils import get_column_letter
from openpyxl.styles import Font, Alignment, Border, Side

# ==================== 配置 ====================
SYNC_SERVICE_ID = 'palm-warehouse-sync'
SYNC_API_VERSION = 2
SYNC_DISPLAY_NAME = '掌上仓库 ERP版同步助手'
SYNC_EDITION = 'ERP'
SYNC_VERSION = '3.4.0'
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_FILE_NAME_LENGTH = 120
DIRECT_PRINT_PRINTER_NAME = (
    os.environ.get('PALM_WAREHOUSE_PRINTER_NAME', '').strip()
    or 'TSC TTP-244 Pro'
)
NATIVE_LABEL_PRINT_MODE = 'native_tsc_supplier_v2'
LEGACY_NATIVE_LABEL_PRINT_MODE = 'native_tsc_v1'
SUPPORTED_NATIVE_LABEL_PRINT_MODES = {
    NATIVE_LABEL_PRINT_MODE,
    LEGACY_NATIVE_LABEL_PRINT_MODE,
}
NATIVE_LABEL_COPIES = 2
MAX_NATIVE_PRINT_HISTORY = 500
NATIVE_LABEL_FONT_SIZE_PT = 8
NATIVE_LABEL_DPI = 203
NATIVE_LABEL_WIDTH_DOTS = 800
NATIVE_LABEL_HEIGHT_DOTS = 400
NATIVE_LABEL_FONT_SIZE_PIXELS = round(NATIVE_LABEL_FONT_SIZE_PT * NATIVE_LABEL_DPI / 72)
NATIVE_LABEL_BARCODE_HEIGHT_DOTS = 32
NATIVE_LABEL_BARCODE_STRICT_WIDTH_DOTS = 1
NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS = 2
NATIVE_LABEL_QR_CELL_DOTS = 6
NATIVE_LABEL_QR_MODEL = 'M2'
NATIVE_LABEL_QR_MASK = 'S7'
NATIVE_LABEL_QR_X = 575
NATIVE_LABEL_QR_Y = 20
NATIVE_LABEL_QR_MODULE_COUNT = 33
NATIVE_LABEL_QR_SIZE_DOTS = NATIVE_LABEL_QR_MODULE_COUNT * NATIVE_LABEL_QR_CELL_DOTS
NATIVE_LABEL_RIGHT_EDGE_X = NATIVE_LABEL_QR_X + NATIVE_LABEL_QR_SIZE_DOTS
NATIVE_LABEL_COMPLIANCE_FIRST_Y = NATIVE_LABEL_QR_Y + NATIVE_LABEL_QR_SIZE_DOTS + 2
NATIVE_LABEL_COMPLIANCE_ROW_GAP_DOTS = 28
NATIVE_LABEL_FONT_CACHE = {}
NATIVE_LABEL_IMAGE_CACHE = {}
NATIVE_LABEL_LOGO_RELATIVE_PATH = os.path.join('assets', 'geehy-logo.png')
NATIVE_LABEL_LOGO_WIDTH_DOTS = 200
NATIVE_LABEL_LOGO_POSITION = (30, 5)
NATIVE_LABEL_PB_RELATIVE_PATH = os.path.join('assets', 'pb-logo.png')
NATIVE_LABEL_PB_SIZE_DOTS = 40
NATIVE_LABEL_PB_POSITION = (
    NATIVE_LABEL_RIGHT_EDGE_X - NATIVE_LABEL_PB_SIZE_DOTS,
    NATIVE_LABEL_COMPLIANCE_FIRST_Y + 86,
)
NATIVE_LABEL_LEFT_VALUE_X = 150
NATIVE_LABEL_RIGHT_VALUE_X = 455
RAW_PRINT_CHUNK_BYTES = 64 * 1024
NATIVE_LABEL_TEMPLATE_GEEHY = {
    'key': 'geehy',
    'name': '极海',
    'include_logo': True,
}
NATIVE_LABEL_TEMPLATE_LEADCORE = {
    'key': 'leadcore',
    'name': '珠海领芯',
    'include_logo': False,
}
NATIVE_LABEL_TEMPLATE_BY_SUPPLIER = {
    '珠海极海半导体有限公司': NATIVE_LABEL_TEMPLATE_GEEHY,
    '珠海领芯科技有限公司': NATIVE_LABEL_TEMPLATE_LEADCORE,
}


def get_default_data_root():
    """优先沿用 D 盘目录；没有 D 盘时使用当前用户文档目录。"""
    if os.path.isdir('D:/'):
        return 'D:/数据同步'
    return os.path.join(os.path.expanduser('~'), 'Documents', '掌上仓库同步')


def read_server_port():
    raw_port = os.environ.get('PALM_WAREHOUSE_SYNC_PORT', '8080').strip()
    try:
        port = int(raw_port)
    except ValueError:
        return 8080
    return port if 1 <= port <= 65535 else 8080


# 可通过环境变量迁移目录和端口，无需修改源码重新打包。
DATA_ROOT = os.path.abspath(
    os.environ.get('PALM_WAREHOUSE_SYNC_DIR', '').strip() or get_default_data_root()
)
NATIVE_PRINT_HISTORY_FILE = os.path.join(DATA_ROOT, 'native-label-print-history.json')
# 发货序列号文件路径
SCAN_FILE = f'{DATA_ROOT}/发货序列号.xlsx'
# 入库单文件路径
INBOUND_FILE = f'{DATA_ROOT}/入库单.xlsx'
# 出库单文件路径
OUTBOUND_FILE = f'{DATA_ROOT}/出库单.xlsx'
# 盘点单文件路径
INVENTORY_FILE = f'{DATA_ROOT}/盘点单.xlsx'
# 标签打印数据文件路径
LABELS_FILE = f'{DATA_ROOT}/标签打印.xlsx'
# 物料数据文件路径
MATERIALS_FILE = f'{DATA_ROOT}/物料数据.xlsx'
# 服务端口
SERVER_PORT = read_server_port()
# Excel 样式处理上限：历史数据很多时，避免同步助手二次处理 Excel 卡顿。
MAX_STYLE_DATA_ROWS = 1500
MAX_WIDTH_SAMPLE_ROWS = 120
EXCEL_HEADER_ROW_HEIGHT = 24
EXCEL_DATA_ROW_HEIGHT = 22
EXCEL_DEFAULT_COLUMN_WIDTH = 14
EXCEL_COLUMN_WIDTHS = {
    '入库单号': 18,
    '订单号': 20,
    '盘点单号': 18,
    '仓库名称': 14,
    '客户名称': 30,
    '供应商': 28,
    '标签类型': 12,
    '存货编码': 18,
    '型号': 24,
    '版本号': 17,
    '封装': 14,
    '批次': 16,
    '数量': 10,
    '实盘数量': 12,
    '合计数量': 12,
    '盘点数量': 12,
    '原数量': 12,
    '标签数量': 12,
    '盘点类型': 12,
    '生产日期': 14,
    '追溯码': 20,
    '箱号': 25,
    '扫描时间': 17,
    '拆包时间': 16,
    '创建时间': 18,
}
EXCEL_WRITE_LOCK = threading.Lock()
NATIVE_PRINT_LOCK = threading.Lock()
# ==================== 配置结束 ====================

# 获取程序所在目录
if getattr(sys, 'frozen', False):
    # 打包后的exe路径
    APP_DIR = os.path.dirname(sys.executable)
else:
    # 脚本路径
    APP_DIR = os.path.dirname(os.path.abspath(__file__))

# 日志文件配置
LOG_FILE = os.path.join(APP_DIR, '日志记录.log')
# 日志轮转配置：单个文件最大5MB，保留10个备份
MAX_LOG_SIZE = 5 * 1024 * 1024  # 5MB
BACKUP_COUNT = 10

# 初始化日志记录器
def init_logger():
    """初始化带轮转功能的日志记录器"""
    logger = logging.getLogger('SyncService')
    logger.setLevel(logging.INFO)
    
    # 避免重复添加handler
    if not logger.handlers:
        # 创建轮转文件处理器
        rotating_handler = RotatingFileHandler(
            LOG_FILE,
            maxBytes=MAX_LOG_SIZE,
            backupCount=BACKUP_COUNT,
            encoding='utf-8'
        )
        rotating_handler.setLevel(logging.INFO)
        
        # 设置日志格式
        formatter = logging.Formatter('[%(asctime)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
        rotating_handler.setFormatter(formatter)
        
        logger.addHandler(rotating_handler)
    
    return logger

# 初始化全局日志记录器
logger = init_logger()

def log(message):
    """写入日志（同时输出到控制台和文件）"""
    timestamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_line = f"[{timestamp}] {message}"
    # 写入轮转日志文件
    logger.info(message)
    # 同时输出到控制台
    print(log_line)

def get_ip():
    """获取本机IP地址"""
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(('8.8.8.8', 80))
            return probe.getsockname()[0]
        finally:
            probe.close()
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return '127.0.0.1'


def get_installed_printer_names():
    """读取当前 Windows 可用打印队列名称，供原生打印前做精确校验。"""
    try:
        import win32print
    except ImportError as error:
        raise RuntimeError('缺少 pywin32，请重新安装或重新打包同步助手') from error

    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    printers = win32print.EnumPrinters(flags, None, 2)
    return sorted(
        str(printer.get('pPrinterName', '')).strip()
        for printer in printers
        if printer.get('pPrinterName')
    )


def build_tspl_test_label():
    """生成一张 100x50mm 的英文测试标签，避免中文编码影响直连验证。"""
    return '\r\n'.join([
        'SIZE 100 mm,50 mm',
        'GAP 3 mm,0 mm',
        'DIRECTION 1',
        'CLS',
        'TEXT 30,30,"3",0,1,1,"PALM WAREHOUSE"',
        'TEXT 30,70,"3",0,1,1,"TSPL DIRECT PRINT TEST"',
        'BARCODE 30,120,"128",80,1,0,2,2,"APM-TEST-001"',
        'TEXT 30,220,"2",0,1,1,"NO BARTENDER REQUIRED"',
        'QRCODE 580,30,L,5,A,0,M2,S7,"APM-TEST-001"',
        'PRINT 1,1',
        '',
    ])


def send_raw_tspl_to_printer(printer_name, commands, job_name):
    """通过 Windows RAW 打印队列把 TSPL 指令发送到指定的 TSC 打印机。"""
    try:
        import win32print
    except ImportError as error:
        raise RuntimeError('缺少 pywin32，请重新安装或重新打包同步助手') from error

    normalized_printer_name = str(printer_name or '').strip()
    if not normalized_printer_name:
        raise ValueError('未配置打印机名称')

    printer_names = get_installed_printer_names()
    if normalized_printer_name not in printer_names:
        available_names = '、'.join(printer_names) or '未发现任何 Windows 打印机'
        raise ValueError(
            f'未找到打印机“{normalized_printer_name}”。当前可用：{available_names}'
        )

    handle = None
    job_started = False
    page_started = False
    try:
        handle = win32print.OpenPrinter(normalized_printer_name)
        job_id = win32print.StartDocPrinter(handle, 1, (job_name, None, 'RAW'))
        job_started = True
        win32print.StartPagePrinter(handle)
        page_started = True
        payload = commands if isinstance(commands, bytes) else commands.encode('ascii')
        offset = 0
        while offset < len(payload):
            chunk = payload[offset:offset + RAW_PRINT_CHUNK_BYTES]
            written = win32print.WritePrinter(handle, chunk)
            written_count = len(chunk) if written is None else int(written)
            if written_count <= 0 or written_count > len(chunk):
                raise RuntimeError('Windows 打印队列未完整接收标签数据')
            offset += written_count
        win32print.EndPagePrinter(handle)
        page_started = False
        win32print.EndDocPrinter(handle)
        job_started = False
        return job_id
    finally:
        if handle is not None:
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


def print_native_test_label():
    """提交原生 TSPL 测试标签；不读取、不修改任何 PDA 或 Excel 数据。"""
    job_id = send_raw_tspl_to_printer(
        DIRECT_PRINT_PRINTER_NAME,
        build_tspl_test_label(),
        'Palm Warehouse TSPL Test',
    )
    log(f'原生 TSPL 测试标签已提交: {DIRECT_PRINT_PRINTER_NAME}，任务号 {job_id}')
    return job_id


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
    """从拆包标签 Excel 提取原生 TSC 标签需要的数据。"""
    sheet = workbook.active
    header_values = next(sheet.iter_rows(min_row=1, max_row=1, values_only=True), None)
    if not header_values:
        raise ValueError('标签 Excel 缺少表头')

    header_indexes = {
        get_excel_cell_text(header).replace(' ', ''): index
        for index, header in enumerate(header_values)
        if get_excel_cell_text(header)
    }
    required_headers = ('型号', '标签数量', '追溯码')
    missing_headers = [header for header in required_headers if header not in header_indexes]
    if missing_headers:
        missing_header_text = '、'.join(missing_headers)
        raise ValueError(f'标签 Excel 缺少字段：{missing_header_text}')

    def get_value(row, header):
        index = header_indexes.get(header)
        return get_excel_cell_text(row[index]) if index is not None and index < len(row) else ''

    records = []
    for row_number, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
        if not any(value is not None and get_excel_cell_text(value) for value in row):
            continue

        record = {
            'model': get_value(row, '型号'),
            'quantity': get_value(row, '标签数量'),
            'batch': get_value(row, '批次'),
            'production_date': get_value(row, '生产日期'),
            'package': get_value(row, '封装'),
            'trace_no': get_value(row, '追溯码'),
            'inventory_code': get_value(row, '存货编码'),
            'source_no': get_value(row, '箱号'),
            'version': get_value(row, '版本号'),
            'label_type': get_value(row, '标签类型'),
            'supplier': get_value(row, '供应商'),
        }
        missing_values = [
            label
            for label, key in (('型号', 'model'), ('标签数量', 'quantity'), ('追溯码', 'trace_no'))
            if not record[key]
        ]
        if missing_values:
            missing_value_text = '、'.join(missing_values)
            raise ValueError(f'标签 Excel 第 {row_number} 行缺少：{missing_value_text}')
        records.append(record)

    if not records:
        raise ValueError('标签 Excel 没有可打印的数据')
    return records


def normalize_tspl_value(value, max_length):
    """限制为安全 ASCII，避免字段内容破坏 TSPL 指令或超出标签可读范围。"""
    text = ' '.join(str(value or '').replace('\r', ' ').replace('\n', ' ').split())
    text = ''.join(character for character in text if ord(character) >= 32)
    text = text.replace('"', "'")
    ascii_text = text.encode('ascii', 'replace').decode('ascii')
    return (ascii_text[:max_length] or '-')


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
    """按 PDA 现有二维码规则的固定顺序重建拆包后可继续扫描的内容。"""
    fields = [
        model,
        batch,
        package,
        version,
        quantity,
        production_date,
        trace_no,
        source_no,
    ]
    return '/'.join(field.replace('/', '-') for field in fields)


def get_native_arial_font(bold=False):
    """读取电脑端 Arial；字体只用于生成标签位图，不会下载到打印机。"""
    cache_key = 'bold' if bold else 'regular'
    cached_font = NATIVE_LABEL_FONT_CACHE.get(cache_key)
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

    font = ImageFont.truetype(font_path, NATIVE_LABEL_FONT_SIZE_PIXELS)
    NATIVE_LABEL_FONT_CACHE[cache_key] = font
    return font


def get_native_right_aligned_text_x(text, bold=False):
    """计算文字左坐标，使文字右边缘与标签指定位置对齐。"""
    text_width = get_native_arial_font(bold=bold).getlength(text)
    return max(0, NATIVE_LABEL_RIGHT_EDGE_X - int(text_width + 0.999))


def get_native_image_mask(cache_key, relative_path, target_width, target_height=None):
    """读取图片资源并转换为适合热转印标签的单色蒙版。"""
    cached_image = NATIVE_LABEL_IMAGE_CACHE.get(cache_key)
    if cached_image is not None:
        return cached_image

    try:
        from PIL import Image
    except ImportError as error:
        raise RuntimeError('缺少 Pillow，无法生成标签图片') from error

    image_path = resource_path(relative_path)
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
    NATIVE_LABEL_IMAGE_CACHE[cache_key] = image_mask
    return image_mask


def get_native_logo_mask():
    """读取 Geehy 原始 Logo。"""
    return get_native_image_mask(
        'geehy-logo',
        NATIVE_LABEL_LOGO_RELATIVE_PATH,
        NATIVE_LABEL_LOGO_WIDTH_DOTS,
    )


def get_native_pb_mask():
    """读取 Pb 合规图标，并固定为 5 x 5 毫米。"""
    return get_native_image_mask(
        'pb-logo',
        NATIVE_LABEL_PB_RELATIVE_PATH,
        NATIVE_LABEL_PB_SIZE_DOTS,
        NATIVE_LABEL_PB_SIZE_DOTS,
    )


def build_native_text_bitmap(text_items, include_logo=True):
    """把 Arial 文字栅格化为 TSPL BITMAP，避免打印机下载字体后进入错误状态。"""
    try:
        from PIL import Image, ImageDraw
    except ImportError as error:
        raise RuntimeError('缺少 Pillow，无法生成 Arial 标签文字') from error

    image = Image.new(
        '1',
        (NATIVE_LABEL_WIDTH_DOTS, NATIVE_LABEL_HEIGHT_DOTS),
        0,
    )
    draw = ImageDraw.Draw(image)
    if include_logo:
        image.paste(get_native_logo_mask(), NATIVE_LABEL_LOGO_POSITION)
    image.paste(get_native_pb_mask(), NATIVE_LABEL_PB_POSITION)
    for x, y, text, bold in text_items:
        draw.text(
            (x, y),
            text,
            font=get_native_arial_font(bold=bold),
            fill=1,
            anchor='lt',
        )

    width_bytes = (NATIVE_LABEL_WIDTH_DOTS + 7) // 8
    # TTP-244 Pro 的 BITMAP 位值是 0 打印、1 留白，与 Pillow 的蒙版相反。
    bitmap_data = bytes(value ^ 0xFF for value in image.tobytes())
    expected_size = width_bytes * NATIVE_LABEL_HEIGHT_DOTS
    if len(bitmap_data) != expected_size:
        raise RuntimeError('Arial 标签文字位图尺寸异常')

    command = (
        f'BITMAP 0,0,{width_bytes},{NATIVE_LABEL_HEIGHT_DOTS},0,'.encode('ascii')
    )
    return command + bitmap_data + b'\r\n'


def build_native_apm_label(record, template):
    """生成 100x50mm APM 拆包标签，每条记录由打印机直接输出两份。"""
    model = normalize_tspl_value(record.get('model'), 22)
    quantity = normalize_tspl_value(record.get('quantity'), 12)
    batch = normalize_tspl_value(record.get('batch'), 18)
    production_date = normalize_tspl_value(record.get('production_date'), 10)
    package = normalize_tspl_value(record.get('package'), 18)
    trace_no = normalize_tspl_value(record.get('trace_no'), 28)
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
        (NATIVE_LABEL_RIGHT_VALUE_X, 242, trace_no, False),
        (30, 320, 'P/N:', False),
        (NATIVE_LABEL_LEFT_VALUE_X, 320, part_number, False),
        (350, 320, 'BOX ID:', False),
        (NATIVE_LABEL_RIGHT_VALUE_X, 320, source_no, False),
        (
            get_native_right_aligned_text_x('COO:CN', True),
            NATIVE_LABEL_COMPLIANCE_FIRST_Y,
            'COO:CN',
            True,
        ),
        (
            get_native_right_aligned_text_x('RoHS', True),
            NATIVE_LABEL_COMPLIANCE_FIRST_Y + NATIVE_LABEL_COMPLIANCE_ROW_GAP_DOTS,
            'RoHS',
            True,
        ),
        (
            get_native_right_aligned_text_x('MSL3', True),
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
        f'BARCODE 350,268,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},"{trace_no}"',
        f'BARCODE 30,346,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},{NATIVE_LABEL_BARCODE_EXPANDED_WIDTH_DOTS},"{part_number}"',
        f'BARCODE 350,346,"128",{NATIVE_LABEL_BARCODE_HEIGHT_DOTS},0,0,{NATIVE_LABEL_BARCODE_STRICT_WIDTH_DOTS},{NATIVE_LABEL_BARCODE_STRICT_WIDTH_DOTS},"{source_no}"',
        f'QRCODE {NATIVE_LABEL_QR_X},{NATIVE_LABEL_QR_Y},L,{NATIVE_LABEL_QR_CELL_DOTS},A,0,{NATIVE_LABEL_QR_MODEL},{NATIVE_LABEL_QR_MASK},"{scan_payload}"',
        f'PRINT 1,{NATIVE_LABEL_COPIES}',
        '',
    ]).encode('ascii')
    return (
        setup_commands
        + build_native_text_bitmap(
            text_items,
            include_logo=bool(template.get('include_logo')),
        )
        + print_commands
    )


def load_native_print_history():
    """读取已提交任务，用于网络重试时避免重复出纸。"""
    if not os.path.exists(NATIVE_PRINT_HISTORY_FILE):
        return {}

    try:
        with open(NATIVE_PRINT_HISTORY_FILE, 'r', encoding='utf-8') as history_file:
            payload = json.load(history_file)
        jobs = payload.get('jobs') if isinstance(payload, dict) else None
        return jobs if isinstance(jobs, dict) else {}
    except Exception as error:
        log(f'读取原生标签打印历史失败，将重新建立：{error}')
        return {}


def save_native_print_history(jobs):
    """原子写入打印任务历史，避免同步助手中断时损坏去重信息。"""
    os.makedirs(DATA_ROOT, exist_ok=True)
    temp_path = f'{NATIVE_PRINT_HISTORY_FILE}.{uuid.uuid4().hex}.tmp'
    try:
        with open(temp_path, 'w', encoding='utf-8') as history_file:
            json.dump({'jobs': jobs}, history_file, ensure_ascii=False, indent=2)
        os.replace(temp_path, NATIVE_PRINT_HISTORY_FILE)
    finally:
        remove_file_silent(temp_path)


def normalize_native_print_job_id(value):
    job_id = str(value or '').strip()
    if not job_id:
        raise ValueError('原生打印缺少任务标识')
    if len(job_id) > 120 or any(ord(character) < 32 for character in job_id):
        raise ValueError('原生打印任务标识无效')
    return job_id


def get_native_label_template(record):
    supplier = get_excel_cell_text(record.get('supplier')).strip()
    return NATIVE_LABEL_TEMPLATE_BY_SUPPLIER.get(supplier)


def get_native_print_policy(records):
    printable_records = []
    skipped_suppliers = []

    for record in records:
        supplier = get_excel_cell_text(record.get('supplier')).strip()
        template = get_native_label_template(record)
        if template is None:
            skipped_suppliers.append(supplier or '未填写供应商')
            continue
        printable_records.append((record, template))

    return {
        'printable_records': printable_records,
        'skipped_suppliers': sorted(set(skipped_suppliers)),
        'template_names': sorted({
            template['name']
            for _record, template in printable_records
        }),
    }


def submit_native_unpack_labels(records, print_job_id):
    """提交一组拆包标签；相同任务标识只允许提交一次。"""
    normalized_job_id = normalize_native_print_job_id(print_job_id)
    with NATIVE_PRINT_LOCK:
        jobs = load_native_print_history()
        existing = jobs.get(normalized_job_id)
        if existing:
            log(f'原生标签打印任务已存在，跳过重复出纸：{normalized_job_id}')
            return {
                'job_id': normalized_job_id,
                'spool_job_id': existing.get('spoolJobId'),
                'duplicate': True,
                'printed_count': int(existing.get('labelCount') or 0),
                'skipped_count': int(existing.get('skippedCount') or 0),
                'skipped_suppliers': existing.get('skippedSuppliers') or [],
                'template_names': existing.get('templateNames') or [],
            }

        policy = get_native_print_policy(records)
        printable_records = policy['printable_records']
        skipped_suppliers = policy['skipped_suppliers']
        template_names = policy['template_names']
        skipped_count = len(records) - len(printable_records)

        if not printable_records:
            skipped_text = '、'.join(skipped_suppliers)
            log(
                f'拆包标签已保存但不自动打印：供应商 {skipped_text} '
                f'未配置自动打印模板，任务 {normalized_job_id}'
            )
            return {
                'job_id': normalized_job_id,
                'spool_job_id': None,
                'duplicate': False,
                'printed_count': 0,
                'skipped_count': skipped_count,
                'skipped_suppliers': skipped_suppliers,
                'template_names': [],
            }

        commands = b''.join(
            build_native_apm_label(record, template)
            for record, template in printable_records
        )
        spool_job_id = send_raw_tspl_to_printer(
            DIRECT_PRINT_PRINTER_NAME,
            commands,
            f'Palm Warehouse Unpack {normalized_job_id[:24]}',
        )
        jobs[normalized_job_id] = {
            'submittedAt': datetime.datetime.now().isoformat(timespec='seconds'),
            'spoolJobId': spool_job_id,
            'labelCount': len(printable_records),
            'skippedCount': skipped_count,
            'skippedSuppliers': skipped_suppliers,
            'templateNames': template_names,
            'copiesPerLabel': NATIVE_LABEL_COPIES,
        }
        if len(jobs) > MAX_NATIVE_PRINT_HISTORY:
            oldest_jobs = sorted(
                jobs.items(),
                key=lambda item: str(item[1].get('submittedAt', '')),
            )[:len(jobs) - MAX_NATIVE_PRINT_HISTORY]
            for old_job_id, _entry in oldest_jobs:
                jobs.pop(old_job_id, None)
        save_native_print_history(jobs)
        log(
            f'原生拆包标签已提交: {DIRECT_PRINT_PRINTER_NAME}，'
            f'任务 {normalized_job_id}，模板 {"、".join(template_names)}，'
            f'{len(printable_records)} 条，每条 {NATIVE_LABEL_COPIES} 份，'
            f'跳过 {skipped_count} 条，'
            f'打印队列任务号 {spool_job_id}'
        )
        return {
            'job_id': normalized_job_id,
            'spool_job_id': spool_job_id,
            'duplicate': False,
            'printed_count': len(printable_records),
            'skipped_count': skipped_count,
            'skipped_suppliers': skipped_suppliers,
            'template_names': template_names,
        }


def resource_path(relative_path):
    """获取资源文件路径，兼容 PyInstaller onefile 打包"""
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(APP_DIR, relative_path)


def sanitize_file_name(file_name):
    """清理文件名中的非法字符，避免写出同步目录"""
    cleaned = ''.join('_' if ch in '<>:"/\\|?*' or ord(ch) < 32 else ch for ch in str(file_name or '').strip())
    cleaned = cleaned.strip(' ._')
    return cleaned[:MAX_FILE_NAME_LENGTH]


def remove_file_silent(file_path):
    """删除临时文件，失败时只记录日志，不影响主流程错误返回。"""
    if not file_path:
        return

    try:
        if os.path.exists(file_path):
            os.remove(file_path)
    except Exception as cleanup_error:
        log(f"清理临时文件失败: {file_path} - {cleanup_error}")


def build_temp_excel_path(save_path):
    """每个请求使用独立临时文件，异常清理不会误删另一个请求的文件。"""
    base_name, _extension = os.path.splitext(save_path)
    return f'{base_name}_{uuid.uuid4().hex}.tmp.xlsx'


def save_workbook_atomically(workbook, save_path):
    """先完整写入同目录临时文件，再替换最终文件，避免留下半个 Excel。"""
    output_temp_path = build_temp_excel_path(save_path)
    try:
        workbook.save(output_temp_path)
        os.replace(output_temp_path, save_path)
    finally:
        remove_file_silent(output_temp_path)


def read_excel_request_body():
    """读取并快速校验 XLSX 请求体，避免无限制占用内存。"""
    raw_length = cherrypy.request.headers.get('Content-Length', '').strip()
    if raw_length:
        try:
            content_length = int(raw_length)
        except ValueError as error:
            raise ValueError('Content-Length 无效') from error
        if content_length < 0 or content_length > MAX_UPLOAD_BYTES:
            raise ValueError('Excel 文件超过 25MB 限制')
        file_content = cherrypy.request.body.read(content_length)
    else:
        file_content = cherrypy.request.body.read(MAX_UPLOAD_BYTES + 1)

    if not file_content:
        raise ValueError('未收到文件内容')
    if len(file_content) > MAX_UPLOAD_BYTES:
        raise ValueError('Excel 文件超过 25MB 限制')
    if not file_content.startswith(b'PK'):
        raise ValueError('文件内容不是有效的 XLSX 文件')
    return file_content


def apply_excel_styles(sheet):
    """为Excel表格添加样式"""
    thin = Side(border_style="thin", color="000000")
    
    max_row = sheet.max_row
    max_col = sheet.max_column
    styled_row_end = min(max_row, MAX_STYLE_DATA_ROWS + 1)
    width_row_end = min(max_row, MAX_WIDTH_SAMPLE_ROWS + 1)
    sheet.row_dimensions[1].height = EXCEL_HEADER_ROW_HEIGHT
    
    # 标题行样式
    for col in range(1, max_col + 1):
        cell = sheet.cell(row=1, column=col)
        cell.font = Font(name='微软雅黑', color="000000", bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)
    
    # 数据行样式
    for row in range(2, styled_row_end + 1):
        sheet.row_dimensions[row].height = EXCEL_DATA_ROW_HEIGHT
        for col in range(1, max_col + 1):
            cell = sheet.cell(row=row, column=col)
            cell.font = Font(name='微软雅黑', color="000000")
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)
    
    # 自动列宽
    for col in range(1, max_col + 1):
        header = str(sheet.cell(row=1, column=col).value or '')
        if header in EXCEL_COLUMN_WIDTHS:
            sheet.column_dimensions[get_column_letter(col)].width = EXCEL_COLUMN_WIDTHS[header]
            continue

        max_width = 10
        for row in range(1, width_row_end + 1):
            cell = sheet.cell(row=row, column=col)
            if cell.value:
                width = sum(2 if ord(c) > 127 else 1 for c in str(cell.value))
                max_width = max(max_width, width)
        sheet.column_dimensions[get_column_letter(col)].width = min(max(max_width + 2, EXCEL_DEFAULT_COLUMN_WIDTH), 30)


def parse_week_code(week_code):
    """解析芯片周次编码，支持 2601、2602S、202601、2026-W01 等常见写法"""
    raw_value = str(week_code or '').strip().upper()
    digits = ''.join(ch for ch in raw_value if ch.isdigit())

    if len(digits) >= 6 and digits[:2] in ('19', '20', '21'):
        year = int(digits[:4])
        week = int(digits[4:6])
        normalized = f'{year}{week:02d}'
    elif len(digits) >= 4:
        year = 2000 + int(digits[:2])
        week = int(digits[2:4])
        normalized = f'{str(year)[-2:]}{week:02d}'
    else:
        raise ValueError('请输入 4 位周次，例如 2601')

    if week < 1 or week > 53:
        raise ValueError('周次必须在 01 到 53 之间')

    try:
        monday = datetime.date.fromisocalendar(year, week, 1)
    except ValueError:
        raise ValueError(f'{year} 年没有第 {week:02d} 周')

    sunday = monday + datetime.timedelta(days=6)

    return {
        'normalized': normalized,
        'year': year,
        'week': week,
        'monday': monday,
        'sunday': sunday,
    }


# ==================== CORS跨域支持 ====================
def enable_cors():
    """启用CORS跨域支持"""
    cherrypy.response.headers['Access-Control-Allow-Origin'] = '*'
    cherrypy.response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    cherrypy.response.headers['Access-Control-Allow-Headers'] = (
        'Content-Type, X-Backend-Access-Key'
    )
    cherrypy.response.headers['Content-Type'] = 'application/json; charset=utf-8'


def json_response(payload):
    """兼容新版 CherryPy：页面处理函数必须返回 bytes。"""
    return json.dumps(payload, ensure_ascii=False).encode('utf-8')


cherrypy.tools.cors = cherrypy.Tool('before_handler', enable_cors)


# ==================== 健康检查接口 ====================
class Health:
    """健康检查端点，供APP检测服务是否运行"""
    exposed = True

    def GET(self):
        enable_cors()
        return json_response({
            'status': 'ok',
            'serviceId': SYNC_SERVICE_ID,
            'service': '掌上仓库同步服务',
            'displayName': SYNC_DISPLAY_NAME,
            'edition': SYNC_EDITION,
            'apiVersion': SYNC_API_VERSION,
            'version': SYNC_VERSION,
            'nativePrintModes': sorted(SUPPORTED_NATIVE_LABEL_PRINT_MODES),
            'maxUploadBytes': MAX_UPLOAD_BYTES,
        })


# ==================== 发货序列号接口 ====================
class Scans:
    exposed = True

    def OPTIONS(self):
        """处理预检请求"""
        enable_cors()
        return b''

    def POST(self, **kwargs):
        enable_cors()
        try:
            content = kwargs.get("content", "unknown content")
            if str(content).startswith(('=', '+', '-', '@')):
                content = f"'{content}"
            date = datetime.datetime.now().strftime('%Y-%m-%d')
            month = datetime.datetime.now().strftime('%Y-%m')

            with EXCEL_WRITE_LOCK:
                if not os.path.exists(SCAN_FILE):
                    workbook = Workbook()
                    sheet = workbook.active
                    sheet.title = month
                    sheet.append(["日期", "序列号"])
                    self.set_header_styles(sheet)
                else:
                    workbook = load_workbook(SCAN_FILE)
                    if month not in workbook.sheetnames:
                        sheet = workbook.create_sheet(title=month)
                        sheet.append(["日期", "序列号"])
                        self.set_header_styles(sheet)
                    else:
                        sheet = workbook[month]

                row_num = sheet.max_row + 1
                sheet.append([date, content])
                self.set_row_styles(sheet, row_num)
                sheet.column_dimensions[get_column_letter(1)].width = 15
                sheet.column_dimensions[get_column_letter(2)].width = 100
                save_workbook_atomically(workbook, SCAN_FILE)

            log(f"已保存序列号: {content}")
            return json_response({'success': True, 'message': '保存成功', 'date': date, 'content': content})
        except Exception as e:
            log(f"错误: {str(e)}")
            return json_response({'success': False, 'message': str(e)})

    def set_header_styles(self, sheet):
        thin = Side(border_style="thin", color="000000")
        for cell in sheet[1]:
            cell.font = Font(name='微软雅黑', color="000000", bold=True)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)

    def set_row_styles(self, sheet, row_num):
        thin = Side(border_style="thin", color="000000")
        for col in range(1, 3):
            cell = sheet.cell(row=row_num, column=col)
            cell.font = Font(name='微软雅黑', color="000000")
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)


# ==================== 入库单接口 ====================
class Inbound:
    exposed = True

    def OPTIONS(self):
        """处理预检请求"""
        enable_cors()
        return b''

    def POST(self, name_suffix='', file_name=''):
        enable_cors()
        temp_file = None
        try:
            log("收到入库单数据...")
            
            file_content = read_excel_request_body()
            
            # 生成文件名：手机端指定完整文件名时优先使用
            today = datetime.datetime.now().strftime('%Y-%m-%d')
            exact_file_name = sanitize_file_name(file_name)
            safe_name_suffix = sanitize_file_name(name_suffix)
            if exact_file_name:
                filename = f'{exact_file_name[:-5]}.xlsx' if exact_file_name.lower().endswith('.xlsx') else f'{exact_file_name}.xlsx'
            elif safe_name_suffix:
                filename = f'入库单_{safe_name_suffix}_{today}.xlsx'
            else:
                filename = f'入库单_{today}.xlsx'
            save_path = os.path.join(DATA_ROOT, filename)
            
            temp_file = build_temp_excel_path(save_path)
            with EXCEL_WRITE_LOCK:
                with open(temp_file, 'wb') as f:
                    f.write(file_content)

                # 加载多Sheet工作簿
                workbook = load_workbook(temp_file)

                # 为所有Sheet应用样式
                total_rows = 0
                for sheet_name in workbook.sheetnames:
                    sheet = workbook[sheet_name]
                    apply_excel_styles(sheet)
                    total_rows += sheet.max_row - 1  # 减去标题行

                save_workbook_atomically(workbook, save_path)
                remove_file_silent(temp_file)
            
            log(f"已保存入库单: {save_path} ({len(workbook.sheetnames)}个Sheet, 共{total_rows}条记录)")
            
            return json_response({'success': True, 'message': '保存成功', 'fileName': filename, 'path': save_path, 'count': total_rows})
        except Exception as e:
            remove_file_silent(temp_file)
            log(f"错误: {str(e)}")
            return json_response({'success': False, 'message': str(e)})
    
    def GET(self):
        enable_cors()
        return json_response({'success': True, 'message': '服务运行中', 'save_path': INBOUND_FILE})


# ==================== 出库单接口 ====================
class Outbound:
    exposed = True

    def OPTIONS(self):
        """处理预检请求"""
        enable_cors()
        return b''

    def POST(self, name_suffix='', file_name=''):
        enable_cors()
        temp_file = None
        try:
            log("收到出库单数据...")
            
            file_content = read_excel_request_body()
            
            # 生成文件名：手机端指定完整文件名时优先使用
            today = datetime.datetime.now().strftime('%Y-%m-%d')
            exact_file_name = sanitize_file_name(file_name)
            safe_name_suffix = sanitize_file_name(name_suffix)
            if exact_file_name:
                filename = f'{exact_file_name[:-5]}.xlsx' if exact_file_name.lower().endswith('.xlsx') else f'{exact_file_name}.xlsx'
            elif safe_name_suffix:
                filename = f'出库单_{safe_name_suffix}_{today}.xlsx'
            else:
                filename = f'出库单_{today}.xlsx'
            save_path = os.path.join(DATA_ROOT, filename)
            
            temp_file = build_temp_excel_path(save_path)
            with EXCEL_WRITE_LOCK:
                with open(temp_file, 'wb') as f:
                    f.write(file_content)

                workbook = load_workbook(temp_file)
                total_rows = 0
                for sheet_name in workbook.sheetnames:
                    sheet = workbook[sheet_name]
                    apply_excel_styles(sheet)
                    total_rows += sheet.max_row - 1
                save_workbook_atomically(workbook, save_path)
                remove_file_silent(temp_file)
            
            log(f"已保存出库单: {save_path} ({len(workbook.sheetnames)}个Sheet, 共{total_rows}条记录)")
            
            return json_response({'success': True, 'message': '保存成功', 'fileName': filename, 'path': save_path, 'count': total_rows})
        except Exception as e:
            remove_file_silent(temp_file)
            log(f"错误: {str(e)}")
            return json_response({'success': False, 'message': str(e)})
    
    def GET(self):
        enable_cors()
        return json_response({'success': True, 'message': '服务运行中', 'save_path': OUTBOUND_FILE})


# ==================== 盘点单接口 ====================
class Inventory:
    exposed = True

    def OPTIONS(self):
        """处理预检请求"""
        enable_cors()
        return b''

    def POST(self, name_suffix='', file_name=''):
        enable_cors()
        temp_file = None
        try:
            log("收到盘点单数据...")
            
            file_content = read_excel_request_body()
            
            # 生成文件名：手机端指定完整文件名时优先使用
            today = datetime.datetime.now().strftime('%Y-%m-%d')
            exact_file_name = sanitize_file_name(file_name)
            safe_name_suffix = sanitize_file_name(name_suffix)
            if exact_file_name:
                filename = f'{exact_file_name[:-5]}.xlsx' if exact_file_name.lower().endswith('.xlsx') else f'{exact_file_name}.xlsx'
            elif safe_name_suffix == '拆包标签':
                filename = '拆包标签.xlsx'
            elif safe_name_suffix:
                filename = f'盘点单_{safe_name_suffix}_{today}.xlsx'
            else:
                filename = f'盘点单_{today}.xlsx'
            save_path = os.path.join(DATA_ROOT, filename)
            
            temp_file = build_temp_excel_path(save_path)
            with EXCEL_WRITE_LOCK:
                with open(temp_file, 'wb') as f:
                    f.write(file_content)

                workbook = load_workbook(temp_file)
                if len(workbook.sheetnames) == 1:
                    workbook.active.title = '拆包标签' if safe_name_suffix == '拆包标签' else '盘点明细'

                for sheet in workbook.worksheets:
                    apply_excel_styles(sheet)

                save_workbook_atomically(workbook, save_path)
                remove_file_silent(temp_file)
            
            row_count = sum(max(sheet.max_row - 1, 0) for sheet in workbook.worksheets)
            log(f"已保存盘点单: {save_path} ({len(workbook.sheetnames)}个Sheet, 共{row_count}条记录)")
            
            return json_response({'success': True, 'message': '保存成功', 'fileName': filename, 'path': save_path, 'count': row_count})
        except Exception as e:
            remove_file_silent(temp_file)
            log(f"错误: {str(e)}")
            return json_response({'success': False, 'message': str(e)})
    
    def GET(self):
        enable_cors()
        return json_response({'success': True, 'message': '服务运行中', 'save_path': INVENTORY_FILE})


# ==================== 标签打印接口 ====================
class Labels:
    exposed = True

    def OPTIONS(self):
        """处理预检请求"""
        enable_cors()
        return b''

    def POST(self, name_suffix='', print_mode='', print_job_id='', **_ignored):
        enable_cors()
        temp_file = None
        try:
            log("收到标签数据...")
            
            file_content = read_excel_request_body()
            
            # 生成文件名
            filename = '标签打印.xlsx'
            save_path = os.path.join(DATA_ROOT, filename)
            native_label_records = None
            os.makedirs(DATA_ROOT, exist_ok=True)
            
            temp_file = build_temp_excel_path(save_path)
            with EXCEL_WRITE_LOCK:
                with open(temp_file, 'wb') as f:
                    f.write(file_content)

                workbook = load_workbook(temp_file)
                sheet = workbook.active
                sheet.title = '标签数据'
                apply_excel_styles(sheet)
                if print_mode:
                    if print_mode not in SUPPORTED_NATIVE_LABEL_PRINT_MODES:
                        raise ValueError('不支持的原生标签打印模式')
                    native_label_records = get_native_label_records(workbook)
                save_workbook_atomically(workbook, save_path)
                remove_file_silent(temp_file)
            
            row_count = sheet.max_row - 1
            log(f"已保存标签数据: {save_path} ({row_count}条记录)")
            response = {
                'success': True,
                'message': '保存成功',
                'fileName': filename,
                'path': save_path,
                'count': row_count,
            }
            if native_label_records is not None:
                print_result = submit_native_unpack_labels(native_label_records, print_job_id)
                printed_count = print_result['printed_count']
                skipped_count = print_result['skipped_count']
                skipped_suppliers = print_result['skipped_suppliers']
                template_names = print_result['template_names']
                skip_reason = (
                    f"供应商 {'、'.join(skipped_suppliers)} 未配置自动打印模板"
                    if skipped_suppliers
                    else ''
                )
                response.update({
                    'nativePrint': printed_count > 0,
                    'nativePrintSkipped': skipped_count > 0,
                    'nativePrintSkipReason': skip_reason,
                    'nativePrintSkippedSuppliers': skipped_suppliers,
                    'nativePrintTemplateNames': template_names,
                    'nativePrintJobId': print_result['job_id'],
                    'nativePrintDuplicate': print_result['duplicate'],
                    'nativePrintSpoolJobId': print_result['spool_job_id'],
                    'message': (
                        '标签已保存并按供应商模板提交原生打印'
                        if printed_count > 0
                        else '标签已保存；当前供应商不自动打印'
                    ),
                })

            return json_response(response)
        except Exception as e:
            remove_file_silent(temp_file)
            log(f"错误: {str(e)}")
            return json_response({'success': False, 'message': str(e)})
    
    def GET(self):
        enable_cors()
        return json_response({'success': True, 'message': '服务运行中', 'save_path': LABELS_FILE})


# ==================== 物料数据接口 ====================
class Materials:
    exposed = True

    def OPTIONS(self):
        """处理预检请求"""
        enable_cors()
        return b''

    def POST(self, name_suffix=''):
        enable_cors()
        temp_file = None
        try:
            log("收到物料数据...")
            
            file_content = read_excel_request_body()
            
            # 生成带日期的文件名
            today = datetime.datetime.now().strftime('%Y-%m-%d')
            safe_name_suffix = sanitize_file_name(name_suffix)
            if safe_name_suffix:
                filename = f'物料数据_{safe_name_suffix}_{today}.xlsx'
            else:
                filename = f'物料数据_{today}.xlsx'
            save_path = os.path.join(DATA_ROOT, filename)
            
            temp_file = build_temp_excel_path(save_path)
            with EXCEL_WRITE_LOCK:
                with open(temp_file, 'wb') as f:
                    f.write(file_content)

                workbook = load_workbook(temp_file)
                sheet = workbook.active
                sheet.title = '物料数据'
                apply_excel_styles(sheet)
                save_workbook_atomically(workbook, save_path)
                remove_file_silent(temp_file)
            
            row_count = sheet.max_row - 1
            log(f"已保存物料数据: {save_path} ({row_count}条记录)")
            
            return json_response({'success': True, 'message': '保存成功', 'fileName': filename, 'path': save_path, 'count': row_count})
        except Exception as e:
            remove_file_silent(temp_file)
            log(f"错误: {str(e)}")
            return json_response({'success': False, 'message': str(e)})
    
    def GET(self):
        enable_cors()
        return json_response({'success': True, 'message': '服务运行中', 'save_path': MATERIALS_FILE})


# ==================== 托盘图标 ====================
class TrayIcon:
    def __init__(self):
        self.icon = None
        self.running = True
        self.ip_address = get_ip()
        self.week_converter_running = False
        self.week_converter_lock = threading.Lock()
        
    def create_icon_image(self):
        """创建托盘图标"""
        try:
            from PIL import Image, ImageDraw, ImageFont
            
            # 创建一个32x32的图标
            size = 64
            img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            
            # 绘制圆形背景
            draw.ellipse([4, 4, size-4, size-4], fill=(79, 70, 229, 255))
            
            # 绘制同步符号（两个箭头）
            # 上箭头
            draw.polygon([(size//2, 12), (size//2-8, 24), (size//2+8, 24)], fill=(255, 255, 255, 255))
            # 下箭头
            draw.polygon([(size//2, size-12), (size//2-8, size-24), (size//2+8, size-24)], fill=(255, 255, 255, 255))
            
            return img
        except Exception as e:
            log(f"创建图标失败: {e}")
            # 返回一个简单的图标
            from PIL import Image
            return Image.new('RGBA', (64, 64), (79, 70, 229, 255))
    
    def open_folder(self, folder_path):
        """打开文件夹"""
        try:
            os.makedirs(folder_path, exist_ok=True)
            os.startfile(folder_path)
        except Exception as e:
            log(f"打开文件夹失败: {e}")
    
    def open_logs(self):
        """打开日志文件"""
        try:
            if os.path.exists(LOG_FILE):
                os.startfile(LOG_FILE)
            else:
                log("日志文件不存在")
        except Exception as e:
            log(f"打开日志失败: {e}")

    def notify(self, title, message):
        """尽量显示托盘通知；不支持通知时仍在日志中保留结果。"""
        log(f'{title}: {message}')
        if not self.icon:
            return

        try:
            self.icon.notify(message, title)
        except Exception as error:
            log(f'托盘通知失败: {error}')

    def print_native_test_label(self, _icon=None, _item=None):
        """从托盘菜单异步提交测试标签，避免阻塞菜单界面。"""
        thread = threading.Thread(target=self._print_native_test_label, daemon=True)
        thread.start()

    def _print_native_test_label(self):
        try:
            job_id = print_native_test_label()
            self.notify('原生标签已提交', f'已发送到 {DIRECT_PRINT_PRINTER_NAME}，任务号 {job_id}')
        except Exception as error:
            self.notify('原生标签打印失败', str(error))

    def open_week_converter(self):
        """打开周次转换工具窗口"""
        with self.week_converter_lock:
            if self.week_converter_running:
                log("周次转换工具已打开")
                return
            self.week_converter_running = True

        thread = threading.Thread(target=self.show_week_converter_window, daemon=True)
        thread.start()

    def show_week_converter_window(self):
        """显示周次转换工具，方便从托盘菜单直接使用"""
        try:
            import tkinter as tk
            from tkinter import ttk, messagebox

            window = tk.Tk()
            window.title("周次转换工具")
            window.resizable(False, False)
            window.configure(bg="#F3F6FA")
            icon_path = resource_path('icon.ico')
            if os.path.exists(icon_path):
                try:
                    window.iconbitmap(icon_path)
                except Exception as e:
                    log(f"设置周次工具窗口图标失败: {e}")

            width = 480
            height = 360
            screen_width = window.winfo_screenwidth()
            screen_height = window.winfo_screenheight()
            x = int((screen_width - width) / 2)
            y = int((screen_height - height) / 2)
            window.geometry(f"{width}x{height}+{x}+{y}")
            window.attributes("-topmost", True)
            window.after(600, lambda: window.attributes("-topmost", False))

            input_var = tk.StringVar()
            result_var = tk.StringVar(value="输入周次后点击转换，结果格式：2026-01-05")
            copy_value = {"text": ""}

            style = ttk.Style(window)
            style.theme_use("clam")
            style.configure("TFrame", background="#F3F6FA")
            style.configure("Card.TFrame", background="#FFFFFF", relief="flat")
            style.configure("Title.TLabel", background="#F3F6FA", foreground="#1F2937", font=("Microsoft YaHei UI", 15, "bold"))
            style.configure("Hint.TLabel", background="#F3F6FA", foreground="#6B7280", font=("Microsoft YaHei UI", 9))
            style.configure("Body.TLabel", background="#FFFFFF", foreground="#1F2937", font=("Microsoft YaHei UI", 11))
            style.configure("Result.TLabel", background="#FFFFFF", foreground="#0F766E", font=("Microsoft YaHei UI", 12, "bold"))
            style.configure("Primary.TButton", font=("Microsoft YaHei UI", 10, "bold"))
            style.configure("Secondary.TButton", font=("Microsoft YaHei UI", 10))

            root = ttk.Frame(window, padding=18)
            root.pack(fill="both", expand=True)

            ttk.Label(root, text="周次转换工具", style="Title.TLabel").pack(anchor="w")
            ttk.Label(
                root,
                text="按 ISO 周次计算，周一作为一周开始；结果按 2026-01-05 格式输出。\n公司：上海花栗鼠科技有限公司    作者：zx5121091",
                style="Hint.TLabel",
            ).pack(anchor="w", pady=(4, 12))

            card = ttk.Frame(root, style="Card.TFrame", padding=16)
            card.pack(fill="both", expand=True)

            ttk.Label(card, text="生产周次", style="Body.TLabel").pack(anchor="w")
            entry = ttk.Entry(card, textvariable=input_var, font=("Microsoft YaHei UI", 13))
            entry.pack(fill="x", pady=(6, 12), ipady=6)
            entry.focus_set()

            result_frame = tk.Frame(card, bg="#FFFFFF", height=58)
            result_frame.pack(fill="x", pady=(0, 12))
            result_frame.pack_propagate(False)

            result_label = ttk.Label(
                result_frame,
                textvariable=result_var,
                style="Result.TLabel",
                wraplength=360,
                justify="left",
            )
            result_label.pack(fill="both", expand=True)

            def convert():
                try:
                    parsed = parse_week_code(input_var.get())
                    monday = parsed["monday"].strftime("%Y-%m-%d")
                    sunday = parsed["sunday"].strftime("%Y-%m-%d")
                    result_text = (
                        f"{parsed['normalized']} → {monday}\n"
                        f"第 {parsed['week']:02d} 周：{monday} 至 {sunday}"
                    )
                    result_var.set(result_text)
                    copy_value["text"] = monday
                except Exception as error:
                    copy_value["text"] = ""
                    result_var.set(str(error))

            def copy_result():
                if not copy_value["text"]:
                    convert()

                if not copy_value["text"]:
                    messagebox.showwarning("无法复制", "请先输入有效周次")
                    return

                window.clipboard_clear()
                window.clipboard_append(copy_value["text"])
                window.update()
                result_var.set(f"已复制：{copy_value['text']}")
                input_var.set("")
                copy_value["text"] = ""
                entry.focus_set()

            def clear_input():
                input_var.set("")
                copy_value["text"] = ""
                result_var.set("输入周次后点击转换，结果格式：2026-01-05")
                entry.focus_set()

            button_row = tk.Frame(card, bg="#FFFFFF", height=72)
            button_row.pack(anchor="center", fill="x")
            button_row.pack_propagate(False)

            def create_button(parent, text, command, bg, fg, hover_bg, press_bg):
                label = tk.Label(
                    parent,
                    text=text,
                    width=11,
                    height=3,
                    font=("Microsoft YaHei UI", 11, "bold"),
                    bg=bg,
                    fg=fg,
                    relief="flat",
                    cursor="hand2",
                    padx=10,
                    pady=10,
                )

                label.bind("<Enter>", lambda _event: label.configure(bg=hover_bg))
                label.bind("<Leave>", lambda _event: label.configure(bg=bg))
                label.bind("<ButtonPress-1>", lambda _event: label.configure(bg=press_bg))
                label.bind(
                    "<ButtonRelease-1>",
                    lambda _event: (label.configure(bg=hover_bg), command()),
                )
                return label

            create_button(
                button_row,
                "转换",
                convert,
                "#2563EB",
                "#FFFFFF",
                "#1D4ED8",
                "#1E40AF",
            ).pack(side="left", expand=True, fill="both", padx=(0, 10), pady=4)
            create_button(
                button_row,
                "复制",
                copy_result,
                "#0F766E",
                "#FFFFFF",
                "#115E59",
                "#134E4A",
            ).pack(side="left", expand=True, fill="both", padx=(0, 10), pady=4)
            create_button(
                button_row,
                "清空",
                clear_input,
                "#E5E7EB",
                "#374151",
                "#D1D5DB",
                "#9CA3AF",
            ).pack(side="left", expand=True, fill="both", pady=4)

            entry.bind("<Return>", lambda _event: convert())

            def close_window():
                window.destroy()

            window.protocol("WM_DELETE_WINDOW", close_window)
            window.mainloop()
        except Exception as e:
            log(f"打开周次转换工具失败: {e}")
        finally:
            with self.week_converter_lock:
                self.week_converter_running = False
    
    def set_autostart(self, enable=True):
        """设置开机自启动"""
        try:
            import winreg
            
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
            app_name = "LabelSyncService"
            exe_path = sys.executable if getattr(sys, 'frozen', False) else __file__
            
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE)
            
            if enable:
                winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, f'"{exe_path}"')
                log("已启用开机自启动")
            else:
                try:
                    winreg.DeleteValue(key, app_name)
                    log("已禁用开机自启动")
                except:
                    pass
            
            winreg.CloseKey(key)
        except Exception as e:
            log(f"设置自启动失败: {e}")
    
    def check_autostart(self):
        """检查是否已设置开机自启动"""
        try:
            import winreg
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_READ)
            try:
                winreg.QueryValueEx(key, "LabelSyncService")
                winreg.CloseKey(key)
                return True
            except:
                winreg.CloseKey(key)
                return False
        except:
            return False
    
    def quit_app(self):
        """退出应用"""
        self.running = False
        if self.icon:
            self.icon.stop()
        cherrypy.engine.exit()
    
    def run(self):
        """运行托盘图标"""
        try:
            import pystray
            from PIL import Image
            
            # 创建图标
            icon_image = self.create_icon_image()
            
            # 创建菜单
            is_autostart = self.check_autostart()
            
            menu = pystray.Menu(
                pystray.MenuItem(
                    lambda text: f"✓ 开机自启动" if self.check_autostart() else "○ 开机自启动",
                    lambda: self.set_autostart(not self.check_autostart()),
                ),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem(f"服务地址: {self.ip_address}:{SERVER_PORT}", None, enabled=False),
                pystray.MenuItem(f"版本: {SYNC_EDITION} v{SYNC_VERSION}", None, enabled=False),
                pystray.MenuItem(f"同步目录: {DATA_ROOT}", None, enabled=False),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("生产周次转换", self.open_week_converter),
                pystray.MenuItem("打开同步文件夹", lambda: self.open_folder(DATA_ROOT)),
                pystray.MenuItem("打印原生 TSPL 测试标签", self.print_native_test_label),
                pystray.MenuItem("查看运行日志", self.open_logs),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("退出 ERP版同步助手", self.quit_app),
            )
            
            # 创建托盘图标
            self.icon = pystray.Icon("label_sync_erp", icon_image, SYNC_DISPLAY_NAME, menu)
            self.icon.run()
            
        except ImportError:
            log("缺少依赖: pip install pystray Pillow")
            # 无托盘模式运行
            while self.running:
                import time
                time.sleep(1)


# ==================== 启动服务 ====================
def start_server():
    """启动HTTP服务"""
    ip_address = get_ip()
    
    conf = {
        'global': {
            'server.socket_host': '0.0.0.0',
            'server.socket_port': SERVER_PORT,
            'server.thread_pool': 10,
            'engine.autoreload.on': False,
            'log.screen': False,
        }
    }
    
    # 挂载路由，启用CORS
    cherrypy.tree.mount(Health(), '/health', {
        '/': {
            'request.dispatch': cherrypy.dispatch.MethodDispatcher(),
            'tools.cors.on': True,
        }
    })
    cherrypy.tree.mount(Scans(), '/scans', {
        '/': {
            'request.dispatch': cherrypy.dispatch.MethodDispatcher(),
            'tools.cors.on': True,
        }
    })
    cherrypy.tree.mount(Inbound(), '/inbound', {
        '/': {
            'request.dispatch': cherrypy.dispatch.MethodDispatcher(),
            'tools.cors.on': True,
        }
    })
    cherrypy.tree.mount(Outbound(), '/outbound', {
        '/': {
            'request.dispatch': cherrypy.dispatch.MethodDispatcher(),
            'tools.cors.on': True,
        }
    })
    cherrypy.tree.mount(Inventory(), '/inventory', {
        '/': {
            'request.dispatch': cherrypy.dispatch.MethodDispatcher(),
            'tools.cors.on': True,
        }
    })
    cherrypy.tree.mount(Labels(), '/labels', {
        '/': {
            'request.dispatch': cherrypy.dispatch.MethodDispatcher(),
            'tools.cors.on': True,
        }
    })
    cherrypy.tree.mount(Materials(), '/materials', {
        '/': {
            'request.dispatch': cherrypy.dispatch.MethodDispatcher(),
            'tools.cors.on': True,
        }
    })
    cherrypy.config.update(conf)
    
    log("=" * 50)
    log(f"  {SYNC_DISPLAY_NAME} v{SYNC_VERSION}")
    log("=" * 50)
    log(f"  本机IP: {ip_address}")
    log(f"  服务端口: {SERVER_PORT}")
    log(f"  数据目录: {DATA_ROOT}")
    log("=" * 50)
    
    cherrypy.engine.start()


def main():
    """主函数"""
    # 确保数据目录存在
    os.makedirs(DATA_ROOT, exist_ok=True)
    
    # 启动HTTP服务（在后台线程）
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # 运行托盘图标（主线程）
    tray = TrayIcon()
    tray.run()


if __name__ == '__main__':
    main()
