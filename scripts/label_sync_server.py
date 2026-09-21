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
import ipaddress
import os
import re
import sys
import socket
import subprocess
import threading
import uuid
import logging
from logging.handlers import RotatingFileHandler
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from openpyxl.styles import Font, Alignment, Border, Side

try:
    from .label_templates import (
        NATIVE_LABEL_COPIES,
        build_native_label,
        build_native_unpack_time_label,
        get_excel_cell_text,
        get_native_label_records,
        get_native_label_template,
    )
except ImportError:
    from label_templates import (
        NATIVE_LABEL_COPIES,
        build_native_label,
        build_native_unpack_time_label,
        get_excel_cell_text,
        get_native_label_records,
        get_native_label_template,
    )

# ==================== 配置 ====================
SYNC_SERVICE_ID = 'palm-warehouse-sync'
SYNC_API_VERSION = 2
SYNC_DISPLAY_NAME = '掌上仓库 ERP版同步助手'
SYNC_EDITION = 'ERP'
SYNC_VERSION = '3.6.3'
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
MAX_NATIVE_PRINT_HISTORY = 500
RAW_PRINT_CHUNK_BYTES = 64 * 1024
NETWORK_ADDRESS_REFRESH_SECONDS = 15

# 代理 / VPN 通常会新增虚拟网卡。同步助手只需要把同一局域网内 PDA 可访问的
# 物理网卡地址展示出来，不应跟随默认路由把 VPN 或代理地址当成服务地址。
VIRTUAL_ADAPTER_KEYWORDS = (
    'vpn', 'proxy', 'tun', 'tap', 'wintun', 'wireguard', 'tailscale',
    'zerotier', 'virtual', 'vmware', 'hyper-v', 'docker', 'vethernet',
    'loopback', 'bluetooth', 'meta', 'clash', 'mihomo', 'sing-box',
    'v2ray', 'xray', 'hysteria',
)
PREFERRED_ADAPTER_KEYWORDS = (
    'wi-fi', 'wifi', 'wlan', 'wireless', 'ethernet', '以太网', '无线',
)
IPV4_PATTERN = re.compile(
    r'(?<![\d.])((?:25[0-5]|2[0-4]\d|1?\d?\d)'
    r'(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})(?![\d.])'
)
RFC1918_NETWORKS = (
    ipaddress.IPv4Network('10.0.0.0/8'),
    ipaddress.IPv4Network('172.16.0.0/12'),
    ipaddress.IPv4Network('192.168.0.0/16'),
)


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

def is_usable_lan_ipv4(value):
    """判断地址是否适合作为 PDA 访问同步助手的局域网 IPv4 地址。"""
    try:
        address = ipaddress.IPv4Address(str(value).strip())
    except ipaddress.AddressValueError:
        return False

    return any(address in network for network in RFC1918_NETWORKS)


def parse_windows_ipconfig(output):
    """从 Windows ipconfig 输出读取网卡、IPv4 和默认网关信息。"""
    adapters = []
    current = None

    for raw_line in str(output or '').splitlines():
        line = raw_line.strip()
        lowered = line.lower()
        is_adapter_header = line.endswith(':') and (
            'adapter' in lowered or '适配器' in line
        )
        if is_adapter_header:
            current = {
                'name': line[:-1].strip(),
                'addresses': [],
                'has_default_gateway': False,
            }
            adapters.append(current)
            continue

        if current is None:
            continue

        address_match = IPV4_PATTERN.search(line)
        if not address_match:
            continue

        address = address_match.group(1)
        if 'default gateway' in lowered or '默认网关' in line:
            current['has_default_gateway'] = True
        elif 'ipv4' in lowered or 'ip address' in lowered or 'ip 地址' in lowered:
            current['addresses'].append(address)

    return adapters


def read_windows_ipconfig():
    """读取 ipconfig，兼容中文 Windows 常见的 GBK 输出。"""
    try:
        # 打包后的同步助手是无控制台窗口程序。ipconfig 是控制台程序，若不显式
        # 隐藏子进程窗口，会在首次读取或定时刷新局域网 IP 时短暂闪出黑色 CMD。
        creation_flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        result = subprocess.run(
            ['ipconfig'],
            capture_output=True,
            check=False,
            timeout=5,
            creationflags=creation_flags,
        )
    except (OSError, subprocess.SubprocessError):
        return []

    output = result.stdout or b''
    for encoding in ('utf-8', 'gbk', 'mbcs'):
        try:
            return parse_windows_ipconfig(output.decode(encoding))
        except (LookupError, UnicodeDecodeError):
            continue
    return parse_windows_ipconfig(output.decode('utf-8', errors='ignore'))


def get_socket_ipv4_addresses():
    """ipconfig 不可用时的保守回退，仅保留私有 IPv4 地址。"""
    addresses = set()
    try:
        results = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
    except OSError:
        return []

    for _family, _sock_type, _protocol, _canonical_name, sockaddr in results:
        address = sockaddr[0]
        if is_usable_lan_ipv4(address):
            addresses.add(address)
    return sorted(addresses)


def is_virtual_adapter(name):
    normalized_name = str(name or '').lower()
    return any(keyword in normalized_name for keyword in VIRTUAL_ADAPTER_KEYWORDS)


def get_lan_ipv4_addresses(adapters=None, fallback_addresses=None):
    """返回按可用性排序的物理局域网 IPv4 地址。"""
    explicit_address = os.environ.get('PALM_WAREHOUSE_SYNC_IP', '').strip()
    if explicit_address and is_usable_lan_ipv4(explicit_address):
        return [explicit_address]

    adapter_records = read_windows_ipconfig() if adapters is None else adapters
    ranked_addresses = []
    for adapter in adapter_records:
        name = str(adapter.get('name', ''))
        if is_virtual_adapter(name):
            continue

        score = 0
        normalized_name = name.lower()
        if adapter.get('has_default_gateway'):
            score += 100
        if any(keyword in normalized_name for keyword in PREFERRED_ADAPTER_KEYWORDS):
            score += 20

        for address in adapter.get('addresses', []):
            if is_usable_lan_ipv4(address):
                ranked_addresses.append((-score, str(address)))

    if ranked_addresses:
        ranked_addresses.sort()
        return list(dict.fromkeys(address for _score, address in ranked_addresses))

    addresses = get_socket_ipv4_addresses() if fallback_addresses is None else fallback_addresses
    return sorted({str(address) for address in addresses if is_usable_lan_ipv4(address)})


def get_lan_ip():
    """获取首选局域网 IPv4；没有可用地址时返回回环地址供本机诊断。"""
    addresses = get_lan_ipv4_addresses()
    return addresses[0] if addresses else '127.0.0.1'


class NetworkAddressMonitor:
    """定期检测局域网地址变化，供托盘菜单无重启刷新地址。"""

    def __init__(self, initial_address=None, interval=NETWORK_ADDRESS_REFRESH_SECONDS, resolver=get_lan_ip):
        self.address = initial_address or resolver()
        self.interval = interval
        self.resolver = resolver
        self._stop_event = threading.Event()
        self._thread = None

    def start(self, on_change):
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            args=(on_change,),
            daemon=True,
            name='sync-address-monitor',
        )
        self._thread.start()

    def _run(self, on_change):
        while not self._stop_event.wait(self.interval):
            new_address = self.resolver()
            if new_address == self.address:
                continue
            previous_address = self.address
            self.address = new_address
            on_change(previous_address, new_address)

    def stop(self):
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1)


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
                'time_label_count': int(existing.get('timeLabelCount') or 0),
                'physical_label_count': int(existing.get('physicalLabelCount') or (
                    int(existing.get('labelCount') or 0) * int(existing.get('copiesPerLabel') or NATIVE_LABEL_COPIES)
                )),
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
                'time_label_count': 0,
                'physical_label_count': 0,
                'skipped_count': skipped_count,
                'skipped_suppliers': skipped_suppliers,
                'template_names': [],
            }

        commands = b''.join(
            build_native_label(record, template)
            for record, template in printable_records
        )
        # A print_job_id represents one unpack pair; retries reuse the same five-label job.
        time_record = next(
            (record for record, _template in printable_records if record.get('label_type') == '剩余标签'),
            printable_records[0][0],
        )
        commands += build_native_unpack_time_label(time_record)
        physical_label_count = len(printable_records) * NATIVE_LABEL_COPIES + 1
        spool_job_id = send_raw_tspl_to_printer(
            DIRECT_PRINT_PRINTER_NAME,
            commands,
            f'Palm Warehouse Unpack {normalized_job_id[:24]}',
        )
        jobs[normalized_job_id] = {
            'submittedAt': datetime.datetime.now().isoformat(timespec='seconds'),
            'spoolJobId': spool_job_id,
            'labelCount': len(printable_records),
            'timeLabelCount': 1,
            'physicalLabelCount': physical_label_count,
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
            f'另加拆包时间标签 1 张，共 {physical_label_count} 张，'
            f'跳过 {skipped_count} 条，'
            f'打印队列任务号 {spool_job_id}'
        )
        return {
            'job_id': normalized_job_id,
            'spool_job_id': spool_job_id,
            'duplicate': False,
            'printed_count': len(printable_records),
            'time_label_count': 1,
            'physical_label_count': physical_label_count,
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
        lan_addresses = get_lan_ipv4_addresses()
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
            # PDA 可用的地址。服务监听 0.0.0.0，因此网卡 IP 变化后无需重启。
            'lanIp': lan_addresses[0] if lan_addresses else None,
            'lanIps': lan_addresses,
            'port': SERVER_PORT,
        })


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
                    'nativePrintTimeLabelCount': print_result['time_label_count'],
                    'nativePrintPhysicalLabelCount': print_result['physical_label_count'],
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
        self.ip_address = get_lan_ip()
        self.address_monitor = NetworkAddressMonitor(self.ip_address)
        
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
        log(f'{title}: {message}')
        if not self.icon:
            return
        try:
            self.icon.notify(message, title)
        except Exception as error:
            log(f'托盘通知失败: {error}')

    def get_service_address_text(self, _item=None):
        """让 pystray 每次展开菜单时读取最新的服务地址。"""
        return f"服务地址: {self.ip_address}:{SERVER_PORT}"

    def refresh_network_address(self, previous_address, new_address):
        """网络切换后刷新托盘内容；HTTP 服务无需重启。"""
        self.ip_address = new_address
        message = f'局域网地址已从 {previous_address} 更新为 {new_address}:{SERVER_PORT}'
        log(message)
        if self.icon:
            try:
                self.icon.update_menu()
            except Exception as error:
                log(f'刷新托盘菜单失败: {error}')
        self.notify('同步地址已更新', message)

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
        self.address_monitor.stop()
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
            menu = pystray.Menu(
                pystray.MenuItem(
                    lambda text: f"✓ 开机自启动" if self.check_autostart() else "○ 开机自启动",
                    lambda: self.set_autostart(not self.check_autostart()),
                ),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem(self.get_service_address_text, None, enabled=False),
                pystray.MenuItem(f"版本: {SYNC_EDITION} v{SYNC_VERSION}", None, enabled=False),
                pystray.MenuItem(f"同步目录: {DATA_ROOT}", None, enabled=False),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("打开同步文件夹", lambda: self.open_folder(DATA_ROOT)),
                pystray.MenuItem("查看运行日志", self.open_logs),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("退出 ERP版同步助手", self.quit_app),
            )
            
            # 创建托盘图标
            self.icon = pystray.Icon("label_sync_erp", icon_image, SYNC_DISPLAY_NAME, menu)
            self.address_monitor.start(self.refresh_network_address)
            try:
                self.icon.run()
            finally:
                self.address_monitor.stop()
            
        except ImportError:
            log("缺少依赖: pip install pystray Pillow")
            # 无托盘模式运行
            while self.running:
                import time
                time.sleep(1)


# ==================== 启动服务 ====================
def start_server():
    """启动HTTP服务"""
    ip_address = get_lan_ip()
    lan_addresses = get_lan_ipv4_addresses()
    
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
    log(f"  局域网IP: {ip_address}")
    if len(lan_addresses) > 1:
        log(f"  其他局域网IP: {', '.join(lan_addresses[1:])}")
    if ip_address == '127.0.0.1':
        log('  未发现可用局域网 IPv4；请检查 Wi-Fi/以太网连接')
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
