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
import errno
import hashlib
import hmac
import ipaddress
import os
import re
import sys
import socket
import sqlite3
import subprocess
import threading
import uuid
import logging
from zipfile import BadZipFile
from decimal import Decimal, InvalidOperation
from logging.handlers import RotatingFileHandler
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from openpyxl.styles import Font, Alignment, Border, Side

try:
    from .sync_notifications import BusinessNotificationDispatcher
    from .sync_pairing_settings import PAIRING_ENV as SYNC_PAIRING_ENV, PairingSettingsWindow, hide_pairing_config, read_pairing_settings
    from .label_templates import (
        NATIVE_LABEL_COPIES,
        NATIVE_LABEL_TEMPLATE_BY_SUPPLIER,
        build_native_label,
        build_native_unpack_time_label,
        get_excel_cell_text,
        get_native_label_records,
        get_native_label_template,
    )
except ImportError:
    from sync_notifications import BusinessNotificationDispatcher
    from sync_pairing_settings import PAIRING_ENV as SYNC_PAIRING_ENV, PairingSettingsWindow, hide_pairing_config, read_pairing_settings
    from label_templates import (
        NATIVE_LABEL_COPIES,
        NATIVE_LABEL_TEMPLATE_BY_SUPPLIER,
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
SYNC_VERSION = 'V1.0'
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
SYNC_PAIRING_HEADER = 'X-Sync-Pairing-Key'
LABEL_REPRINT_API_VERSION = 1
LABEL_REPRINT_SESSION_ID = uuid.uuid4().hex
MAX_LABEL_REPRINT_BYTES = 32 * 1024
MAX_EPHEMERAL_REPRINT_JOBS = 5000
# Only hashes and short receipts live in this process. No label fields, QR,
# Excel, database, JSON history or application log is written by reprinting.
EPHEMERAL_REPRINT_JOBS = {}
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
SYNC_CONFIG_FILE = os.path.join(DATA_ROOT, 'sync-helper-config.json')
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
# Started only with the desktop tray; HTTP workers only enqueue small result summaries.
BUSINESS_NOTIFICATIONS = BusinessNotificationDispatcher()
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

def publish_business_notification(category, outcome, **details):
    """Notification delivery must never change a save/print HTTP result."""
    try:
        BUSINESS_NOTIFICATIONS.publish(category, outcome, **details)
    except Exception:
        # No label payload or exception text enters the notification path.
        pass


def publish_reprint_notification(receipt):
    """Only transient result summaries; never label fields, IDs or diagnostics."""
    if not isinstance(receipt, dict):
        return
    if receipt.get('success') is True:
        if (receipt.get('state') == 'submitted' and receipt.get('copies') == NATIVE_LABEL_COPIES
                and not receipt.get('duplicate')):
            publish_business_notification('reprint', 'submitted', label_count=NATIVE_LABEL_COPIES)
    elif receipt.get('resultUnknown') is True:
        publish_business_notification('reprint', 'unknown', reason='printer_error')
    else:
        code = receipt.get('code')
        reason = ('invalid_content' if code in (
            'INVALID_REQUEST', 'INVALID_LABEL_CONTENT', 'NO_TEMPLATE', 'JOB_CONFLICT',
        ) else 'printer_error' if code == 'PRINT_FAILED' else 'service_error')
        publish_business_notification('reprint', 'failure', reason=reason)


def get_notification_failure_reason(error, printing=False):
    """Use fixed descriptions instead of exposing exception paths or label data."""
    causes = []
    seen = set()
    # Print-ledger saves wrap disk/permission errors before anything is spooled.
    # Follow only explicit causes, with a bound for malformed or cyclic chains.
    while error is not None and id(error) not in seen and len(causes) < 8:
        seen.add(id(error))
        causes.append(error)
        error = getattr(error, '__cause__', None)
    if any(isinstance(cause, OSError) and getattr(cause, 'errno', None) == errno.ENOSPC for cause in causes):
        return 'disk_full'
    if any(isinstance(cause, PermissionError) or getattr(cause, 'winerror', None) in (5, 32, 33) for cause in causes):
        return 'file_access'
    if any(isinstance(cause, (ValueError, BadZipFile)) for cause in causes):
        return 'invalid_content'
    return 'printer_error' if printing else 'service_error'


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


def send_raw_tspl_to_printer(printer_name, commands, job_name, submission_callback=None):
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
        if submission_callback is not None:
            submission_callback()
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


def validate_native_print_history(jobs):
    if not isinstance(jobs, dict) or any(
        not isinstance(job_id, str) or not isinstance(entry, dict)
        or entry.get('state', 'submitted') not in ('submitted', 'submitting', 'unknown', 'failed')
        for job_id, entry in jobs.items()
    ):
        raise ValueError('打印任务历史格式无效')
    return jobs


def open_native_print_ledger():
    """索引账本长期保留任务回执；首次访问事务迁移旧 JSON，不删除旧文件。"""
    connection = None
    try:
        ledger_path = os.path.splitext(NATIVE_PRINT_HISTORY_FILE)[0] + '.sqlite3'
        os.makedirs(os.path.dirname(os.path.abspath(ledger_path)), exist_ok=True)
        connection = sqlite3.connect(ledger_path, timeout=10)
        connection.execute('PRAGMA synchronous = FULL')
        with connection:
            connection.execute('CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL)')
            connection.execute('CREATE TABLE IF NOT EXISTS print_jobs (job_id TEXT PRIMARY KEY, receipt TEXT NOT NULL)')
            migrated = connection.execute("SELECT value FROM metadata WHERE name = 'legacy_json_imported'").fetchone()
            if not migrated:
                jobs = {}
                if os.path.exists(NATIVE_PRINT_HISTORY_FILE):
                    with open(NATIVE_PRINT_HISTORY_FILE, 'r', encoding='utf-8-sig') as history_file:
                        payload = json.load(history_file)
                    jobs = validate_native_print_history(payload.get('jobs') if isinstance(payload, dict) else None)
                connection.executemany(
                    'INSERT OR IGNORE INTO print_jobs (job_id, receipt) VALUES (?, ?)',
                    ((job_id, json.dumps(entry, ensure_ascii=False, separators=(',', ':'))) for job_id, entry in jobs.items()),
                )
                connection.execute("INSERT INTO metadata (name, value) VALUES ('legacy_json_imported', '1')")
        return connection
    except Exception as error:
        if connection is not None:
            connection.close()
        # A broken ledger or legacy file must never silently erase print evidence.
        log(f'读取原生标签打印历史失败，已停止提交以保护去重记录：{type(error).__name__}')
        raise RuntimeError('拆包打印历史无法读取，不能确认之前是否出纸。请先检查同步助手数据目录及历史文件，再重试。') from error


def load_native_print_job(job_id):
    connection = open_native_print_ledger()
    try:
        row = connection.execute('SELECT receipt FROM print_jobs WHERE job_id = ?', (job_id,)).fetchone()
        return validate_native_print_history({job_id: json.loads(row[0])})[job_id] if row else None
    except Exception as error:
        raise RuntimeError('拆包打印历史无法读取，不能确认之前是否出纸。请先检查同步助手数据目录及历史文件，再重试。') from error
    finally:
        connection.close()


def load_native_print_history():
    """供诊断和兼容测试读取；日常打印仅按任务 ID 查询，不全量载入。"""
    connection = open_native_print_ledger()
    try:
        return validate_native_print_history({
            job_id: json.loads(receipt)
            for job_id, receipt in connection.execute('SELECT job_id, receipt FROM print_jobs')
        })
    finally:
        connection.close()


def save_native_print_history(jobs):
    """事务更新指定任务，永不裁剪已完成或结果未知的去重回执。"""
    validate_native_print_history(jobs)
    connection = open_native_print_ledger()
    try:
        with connection:
            connection.executemany(
                'INSERT INTO print_jobs (job_id, receipt) VALUES (?, ?) '
                'ON CONFLICT(job_id) DO UPDATE SET receipt = excluded.receipt',
                ((job_id, json.dumps(entry, ensure_ascii=False, separators=(',', ':'))) for job_id, entry in jobs.items()),
            )
    finally:
        connection.close()


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


class UnpackPrintOutcomeUnknownError(RuntimeError):
    """A durable task may already have reached the Windows print queue."""


def submit_native_unpack_labels(records, print_job_id, retry_confirmed=False):
    """提交一组拆包标签；相同任务标识只允许提交一次。"""
    normalized_job_id = normalize_native_print_job_id(print_job_id)
    fingerprint = hashlib.sha256(json.dumps(
        records, ensure_ascii=False, sort_keys=True, separators=(',', ':'), default=str,
    ).encode('utf-8')).hexdigest()
    with NATIVE_PRINT_LOCK:
        existing = load_native_print_job(normalized_job_id)
        existing_state = existing.get('state', 'submitted') if existing else None
        if existing and existing_state != 'failed':
            if existing.get('fingerprint') and existing['fingerprint'] != fingerprint:
                raise ValueError('原拆包打印任务的标签内容已变化，不能作为同一任务重试。请先核对拆包记录和供应商绑定。')
        if existing and existing_state in ('submitting', 'unknown') and retry_confirmed is not True:
            raise UnpackPrintOutcomeUnknownError(
                '上次拆包打印可能已提交或部分出纸，已阻止自动重复打印。请先核对标签，再使用“核对后重试”。'
            )
        if existing and existing_state == 'submitted':
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
        entry = {
            'state': 'submitting',
            'fingerprint': fingerprint,
            'submittedAt': datetime.datetime.now().isoformat(timespec='seconds'),
            'spoolJobId': None,
            'labelCount': len(printable_records),
            'timeLabelCount': 1,
            'physicalLabelCount': physical_label_count,
            'skippedCount': skipped_count,
            'skippedSuppliers': skipped_suppliers,
            'templateNames': template_names,
            'copiesPerLabel': NATIVE_LABEL_COPIES,
        }
        jobs = {normalized_job_id: entry}
        # Persist uncertainty BEFORE calling Windows. If this save fails, no
        # spool call is allowed; a crash later leaves a task requiring review.
        try:
            save_native_print_history(jobs)
        except Exception as error:
            raise RuntimeError('拆包打印任务状态无法保存，本次未提交打印。请检查同步助手数据目录权限和磁盘空间。') from error
        submission_started = False

        def mark_submission_started():
            nonlocal submission_started
            submission_started = True

        try:
            spool_job_id = send_raw_tspl_to_printer(
                DIRECT_PRINT_PRINTER_NAME,
                commands,
                f'Palm Warehouse Unpack {normalized_job_id[:24]}',
                submission_callback=mark_submission_started,
            )
        except Exception as error:
            # An explicit retry of an older unknown task remains unknown even
            # if this attempt fails before StartDoc: the earlier paper still
            # needs checking. Do not erase that evidence with a safe failure.
            result_unknown = submission_started or existing_state in ('submitting', 'unknown')
            entry['state'] = 'unknown' if result_unknown else 'failed'
            try:
                save_native_print_history(jobs)
            except Exception:
                # The previously saved 'submitting' marker remains durable.
                pass
            if result_unknown:
                raise UnpackPrintOutcomeUnknownError(
                    'Windows 打印队列提交过程中发生异常，拆包标签可能已出纸。请先核对，再使用“核对后重试”。'
                ) from error
            raise
        entry.update(state='submitted', spoolJobId=spool_job_id)
        try:
            save_native_print_history(jobs)
        except Exception as error:
            # The pre-spool 'submitting' record is still on disk, so normal
            # retries (including after helper restart) cannot print again.
            raise UnpackPrintOutcomeUnknownError(
                '标签已提交 Windows 打印队列，但提交结果无法保存。请先核对是否出纸，再使用“核对后重试”。'
            ) from error
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


def reprint_failure(code, message, retry_allowed=False, result_unknown=False):
    return {
        'success': False,
        'state': 'failed',
        'code': code,
        'message': message,
        'retryAllowed': retry_allowed,
        'resultUnknown': result_unknown,
    }


REPRINT_FIELD_NAMES = {
    'model': '型号', 'version': '版本号', 'batch': '批次', 'quantity': '数量',
    'production_date': '生产日期', 'trace_no': '追溯码', 'source_no': '箱号',
    'inventory_code': '存货编码', 'supplier': '供应商', 'origin': '产地',
    'code_no': 'Code NO', 'package': '封装',
}


def validate_reprint_characters(text, field_name, allow_non_ascii=False, allow_line_breaks=False):
    for index, character in enumerate(text, start=1):
        if allow_line_breaks and character in '\r\n':
            continue
        if character == '"':
            reason = '双引号'
        elif ord(character) < 32 or ord(character) == 127:
            description = {'\n': '换行', '\r': '回车', '\t': '制表', '\x00': '空字符'}.get(character)
            reason = f'控制字符（{description}）' if description else '控制字符'
        elif not allow_non_ascii and ord(character) > 126:
            reason = '当前模板不支持的中文、全角或特殊字符'
        else:
            continue
        raise ValueError(f'{field_name}第{index}个字符为{reason}，无法安全打印。请核对该字段内容和解析规则。')


def get_safe_reprint_template_error(error):
    """Return only recognized diagnostics; never echo arbitrary payload/errors."""
    message = str(error)
    fields = r'(?:型号|数量|批次|生产日期|封装|追溯码|箱号|版本号|P/N|标题|标签文字|标签字段)'
    if isinstance(error, ValueError):
        patterns = (
            fields + r'(?:文字|条码)宽度\d+点，模板可用\d+(?:\.\d+)?点，无法完整打印',
            fields + r'文字超出模板宽度：需要\d+(?:\.\d+)?毫米，可用\d+(?:\.\d+)?毫米；请核对该字段内容和解析规则',
            fields + r'内容超过1000字符，无法完整打印',
            fields + r'含无法安全完整打印的字符',
            r'(?:沁恒|盈力)标签字段 (?:model|version|code_no|package|batch|quantity|production_date|origin|trace_no|source_no|Part No:|item No:|Code NO:|Package:|LOT NO:|QTY:|DATE:|Origin:|追溯码|P/N:|TRACE NO\.:|DATE CODE:|MARK:) (?:含无法打印的字符|含二维码分隔符或打印指令引号|内容过长，无法完整打印)',
            r'沁恒标签缺少字段 (?:model|quantity|trace_no)',
            r'东微标签' + fields + r'含二维码分隔符分号，无法完整打印',
            r'东微原始二维码' + fields + r'与解析结果不一致，请核对该字段和解析规则',
            r'先积原始二维码' + fields + r'与解析结果不一致，请核对该字段和解析规则',
            r'先积原始二维码第[1-6]个字段应以(?:P/N:|PKG:|QTY:|D/C:|LOT:|DATE:)开头，请核对该字段和解析规则',
            r'荣湃标签(?:型号|数量|批次|生产日期|封装（原库位）|追溯码|箱号|版本号)(?:含二维码分隔符分号，无法完整打印|含无法安全完整打印的字符|文字超出模板宽度，请核对该字段内容和解析规则)',
            r'荣湃原始二维码(?:型号|数量|批次|生产日期|封装（原库位）|追溯码|箱号|版本号)与解析结果不一致，请核对该字段和解析规则',
        )
        if any(re.fullmatch(pattern, message) for pattern in patterns):
            return message
        known_messages = {
            '标签补打缺少原始二维码',
            '原始二维码含无法安全打印的字符，请核对解析规则',
            '原始二维码内容过长，无法完整放入当前标签模板',
            '沁恒原始二维码须包含完整的九个字段',
            '沁恒原始二维码型号与解析结果不一致',
            '沁恒原始二维码数量须为有效的正整数',
            '沁恒原始二维码数量与解析结果不一致或数量无效',
            '沁恒标签二维码内容过长，无法完整放入标签',
            '盈力标签二维码内容过长，无法放入右下角',
            '东微原始二维码须包含完整的七个字段',
            '东微标签数量须为有效的正整数',
            '东微标签缺少型号',
            '先积原始二维码须包含完整的六个字段（支持换行或逗号分隔）',
            '先积标签数量须为有效的正整数',
            '先积标签缺少型号',
            '荣湃原始二维码须包含完整的十个字段',
            '荣湃原始二维码第6段固定标识应为A',
            '荣湃原始二维码第9段固定标识应为1',
            '荣湃标签数量须为有效的正整数',
            '荣湃标签缺少型号',
            '荣湃标签缺少追溯码',
        }
        if message in known_messages or re.fullmatch(
            r'原始二维码内容过长：当前\d+个字符，本模板最多支持\d+个字符，无法完整打印', message,
        ):
            return message
        return '标签字段校验失败，请核对标签内容与解析规则。本次未打印。'
    if isinstance(error, RuntimeError):
        if message.startswith('缺少 Pillow，'):
            return '同步助手缺少标签图像组件（Pillow），请更新或重新安装同步助手后重试。'
        if message.startswith('缺少 qrcode，'):
            return '同步助手缺少二维码组件（qrcode），请更新或重新安装同步助手后重试。'
        if message.startswith('未找到 Windows 字体文件：'):
            return '同步助手未找到 Arial 字体，请检查并修复 Windows 的 Arial 字体后重试。'
        if message.startswith('未找到标签图片文件：'):
            filename = os.path.basename(message.split('：', 1)[1].replace('\\', '/'))
            image_names = {
                'geehy-logo.png': '极海Logo', 'boya-logo.png': '博雅Logo',
                'wch-logo.png': '沁恒Logo', 'union-logo.png': '盈力Logo',
                'dongwei-logo.png': '东微Logo',
                'rongpai-logo.png': '荣湃Logo',
                'linearin-logo.png': '先积Logo',
                'pb-logo.png': '环保标识', 'esd-warning.png': '静电警告标识',
                'keep-dry.png': '防潮标识',
            }
            image_name = image_names.get(filename, '模板图片')
            return f'同步助手缺少{image_name}资源，请更新或重新安装同步助手，确认模板资源完整后重试。'
        if message == 'Arial 标签文字位图尺寸异常':
            return '同步助手生成的标签图片尺寸异常，请更新或重新安装同步助手后重试。'
    return '标签模板生成失败，请检查同步助手的字体、图片及模板组件后重试。'


def get_safe_reprint_printer_error(error):
    message = str(error)
    if isinstance(error, ValueError):
        if message == '未配置打印机名称':
            return '同步助手未配置标签打印机名称，请先配置打印机后重试。'
        if message.startswith('未找到打印机“'):
            return 'Windows 未找到同步助手配置的标签打印机，请核对打印机名称是否与 Windows 中一致。'
    if isinstance(error, RuntimeError) and message.startswith('缺少 pywin32，'):
        return '同步助手缺少 Windows 打印组件（pywin32），请更新或重新安装同步助手后重试。'
    error_code = getattr(error, 'winerror', None)
    if error_code is None and error.args and isinstance(error.args[0], int):
        error_code = error.args[0]
    known_windows_errors = {
        5: 'Windows 拒绝访问标签打印机，请检查当前 Windows 账号的打印权限后重试。',
        1801: 'Windows 无法找到标签打印机，请检查打印机名称与驱动是否正确安装后重试。',
        1722: 'Windows 打印服务无法连接，请检查 Print Spooler 服务及打印机连接后重试。',
    }
    return known_windows_errors.get(error_code, '未能提交打印，请检查同步助手的打印机配置及连接后重试。')


def normalize_reprint_record(record):
    """Validate the JSON label without changing the original QR or its fields."""
    if not isinstance(record, dict):
        raise ValueError('未收到有效的标签数据，请重新扫码。')
    normalized = {}
    for key in (
        'model', 'version', 'batch', 'quantity', 'production_date', 'trace_no',
        'source_no', 'inventory_code', 'supplier', 'origin', 'code_no', 'package',
    ):
        value = record.get(key)
        if value is None:
            value = ''
        if isinstance(value, bool) or not isinstance(value, (str, int, float)):
            raise ValueError(f'{REPRINT_FIELD_NAMES[key]}类型无效，应为文本或数字，请核对解析规则。')
        text = str(value)
        if len(text) > 1000:
            raise ValueError(f'{REPRINT_FIELD_NAMES[key]}长度为{len(text)}字符，超过1000字符限制，无法完整打印。')
        validate_reprint_characters(text, REPRINT_FIELD_NAMES[key], allow_non_ascii=key == 'supplier')
        normalized[key] = text
    for key in ('model', 'quantity', 'supplier'):
        if not normalized[key].strip():
            raise ValueError(f'未读到{REPRINT_FIELD_NAMES[key]}，请核对标签内容和解析规则。')
    try:
        quantity = Decimal(normalized['quantity'])
    except InvalidOperation as error:
        raise ValueError('数量不是有效的正整数，请核对数量字段的内容和解析规则。') from error
    if (
        not quantity.is_finite() or quantity <= 0
        or quantity != quantity.to_integral_value() or quantity > 9007199254740991
    ):
        raise ValueError('数量须为有效的正整数，不能为零、负数、小数或超出安全整数范围。')
    source_qr = record.get('source_qr')
    if source_qr is None or source_qr == '':
        raise ValueError('缺少原始二维码，请重新扫码。本次未打印。')
    if not isinstance(source_qr, str):
        raise ValueError('原始二维码类型无效，应为文本，请重新扫码。')
    if not source_qr.strip():
        raise ValueError('原始二维码为空，请重新扫码。本次未打印。')
    if len(source_qr) > 4096:
        raise ValueError(f'原始二维码长度为{len(source_qr)}字符，超过4096字符限制，无法完整打印。')
    # Original QR is encoded into an in-memory bitmap, never interpolated into
    # TSPL commands. CR/LF are valid payload bytes, not instruction separators.
    validate_reprint_characters(source_qr, '原始二维码', allow_line_breaks=True)
    normalized['source_qr'] = source_qr
    return normalized


def submit_native_label_reprint(payload):
    """Print two original labels, with process-only retry deduplication."""
    if not isinstance(payload, dict):
        return reprint_failure('INVALID_REQUEST', '标签补打请求须为 JSON 对象')
    if payload.get('reprint_session_id') != LABEL_REPRINT_SESSION_ID:
        return reprint_failure(
            'SESSION_CHANGED',
            '同步助手已重启或更换，无法确认之前是否出纸。请先核对，再重试补打。',
            retry_allowed=True,
            result_unknown=True,
        )
    try:
        job_id = normalize_native_print_job_id(payload.get('print_job_id'))
        record = normalize_reprint_record(payload.get('record'))
    except ValueError as error:
        return reprint_failure('INVALID_LABEL_CONTENT', str(error))
    fingerprint = hashlib.sha256(json.dumps(
        record, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
    ).encode('utf-8')).hexdigest()
    retry_confirmed = payload.get('retry_confirmed') is True

    with NATIVE_PRINT_LOCK:
        existing = EPHEMERAL_REPRINT_JOBS.get(job_id)
        if existing:
            if existing['fingerprint'] != fingerprint:
                return reprint_failure('JOB_CONFLICT', '同一补打任务不能更改标签内容，请重新扫码')
            if existing['receipt'].get('success'):
                return dict(existing['receipt'], duplicate=True)
            if existing['receipt'].get('resultUnknown') and not retry_confirmed:
                return existing['receipt'].copy()
        elif len(EPHEMERAL_REPRINT_JOBS) >= MAX_EPHEMERAL_REPRINT_JOBS:
            return reprint_failure(
                'MEMORY_CAPACITY', '本次同步助手已处理较多补打任务，请先核对出纸后重启同步助手',
            )

        def remember(receipt):
            EPHEMERAL_REPRINT_JOBS[job_id] = {
                'fingerprint': fingerprint,
                'receipt': receipt.copy(),
            }
            return receipt

        template = get_native_label_template(record)
        if template is None:
            return remember(reprint_failure('NO_TEMPLATE', '供应商没有对应的标签模板，本次未打印。请检查物料绑定的供应商名称或同步助手模板配置。'))
        try:
            commands = build_native_label(record, template, source_qr=record['source_qr'])
        except ValueError as error:
            return remember(reprint_failure('INVALID_LABEL_CONTENT', get_safe_reprint_template_error(error)))
        except Exception as error:
            return remember(reprint_failure('TEMPLATE_FAILED', get_safe_reprint_template_error(error), True))

        submission_started = False

        def mark_submission_started():
            nonlocal submission_started
            submission_started = True

        try:
            spool_job_id = send_raw_tspl_to_printer(
                DIRECT_PRINT_PRINTER_NAME,
                commands,
                'Palm Warehouse Label Reprint',
                submission_callback=mark_submission_started,
            )
            receipt = {
                'success': True,
                'state': 'submitted',
                'jobId': job_id,
                'spoolJobId': spool_job_id,
                'duplicate': False,
                'copies': NATIVE_LABEL_COPIES,
                'message': '已提交同步助手，请核对标签是否实际出纸',
            }
        except Exception as error:
            # Even a failed StartDoc / EndDoc call can leave an accepted or
            # partial spool job. A retry then requires the operator to check.
            result_unknown = submission_started or bool(
                existing and existing['receipt'].get('resultUnknown')
            )
            receipt = reprint_failure(
                'PRINT_RESULT_UNKNOWN' if result_unknown else 'PRINT_FAILED',
                'Windows 打印队列提交过程中发生异常，出纸结果无法确认。请先核对标签是否已经出纸，再重试。' if result_unknown
                else get_safe_reprint_printer_error(error),
                retry_allowed=True,
                result_unknown=result_unknown,
            )
            receipt['jobId'] = job_id
        return remember(receipt)


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
def read_sync_pairing_key():
    """仅读取本地配置；缺失配置保持兼容，配置损坏时禁止写入和打印。"""
    return read_pairing_settings(SYNC_CONFIG_FILE).key


def pairing_config_failure():
    cherrypy.response.status = 503
    return json_response({
        'success': False, 'code': 'SYNC_PAIRING_CONFIG_ERROR',
        'resultUnknown': False, 'retryAllowed': True,
        'message': '同步助手配对配置无法读取，请在电脑上检查“配对设置”。本次未保存或打印。',
    })


def sync_pairing_matches(expected):
    candidate = str(cherrypy.request.headers.get(SYNC_PAIRING_HEADER, '')).strip()
    return len(candidate) <= 128 and hmac.compare_digest(expected.encode('utf-8'), candidate.encode('utf-8'))


def require_sync_pairing():
    """返回拒绝响应或 None；必须在读取、写入业务数据和打印之前调用。"""
    try:
        expected = read_sync_pairing_key()
    except ValueError:
        return pairing_config_failure()
    if not expected:
        return None
    if sync_pairing_matches(expected):
        return None
    cherrypy.response.status = 401
    return json_response({
        'success': False, 'code': 'SYNC_PAIRING_REQUIRED',
        'resultUnknown': False, 'retryAllowed': True,
        'message': '同步助手已启用配对，请在 APP 的同步助手设置中填写相同的配对密钥。本次未保存或打印。',
    })


def enable_cors():
    """启用CORS跨域支持"""
    cherrypy.response.headers['Access-Control-Allow-Origin'] = '*'
    cherrypy.response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    cherrypy.response.headers['Access-Control-Allow-Headers'] = (
        f'Content-Type, X-Backend-Access-Key, {SYNC_PAIRING_HEADER}'
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
        try:
            pairing_key = read_sync_pairing_key()
            pairing_required = bool(pairing_key)
        except ValueError:
            return pairing_config_failure()
        lan_addresses = get_lan_ipv4_addresses()
        return json_response({
            'status': 'ok',
            'serviceId': SYNC_SERVICE_ID,
            'service': '掌上仓库同步服务',
            'displayName': SYNC_DISPLAY_NAME,
            'edition': SYNC_EDITION,
            'apiVersion': SYNC_API_VERSION,
            'version': SYNC_VERSION,
            'pairingRequired': pairing_required,
            'pairingAuthenticated': not pairing_required or sync_pairing_matches(pairing_key),
            'pairingHeader': SYNC_PAIRING_HEADER,
            'nativePrintModes': sorted(SUPPORTED_NATIVE_LABEL_PRINT_MODES),
            'labelReprintApiVersion': LABEL_REPRINT_API_VERSION,
            'labelReprintSessionId': LABEL_REPRINT_SESSION_ID,
            'labelReprintSuppliers': sorted(NATIVE_LABEL_TEMPLATE_BY_SUPPLIER),
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
        denial = require_sync_pairing()
        if denial is not None:
            return denial
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
            publish_business_notification('inbound', 'success', count=total_rows, file_name=filename)
            
            return json_response({'success': True, 'message': '保存成功', 'fileName': filename, 'path': save_path, 'count': total_rows})
        except Exception as e:
            remove_file_silent(temp_file)
            log(f"错误: {str(e)}")
            publish_business_notification('inbound', 'failure', reason=get_notification_failure_reason(e))
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
        denial = require_sync_pairing()
        if denial is not None:
            return denial
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
            publish_business_notification('outbound', 'success', count=total_rows, file_name=filename)
            
            return json_response({'success': True, 'message': '保存成功', 'fileName': filename, 'path': save_path, 'count': total_rows})
        except Exception as e:
            remove_file_silent(temp_file)
            log(f"错误: {str(e)}")
            publish_business_notification('outbound', 'failure', reason=get_notification_failure_reason(e))
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
        denial = require_sync_pairing()
        if denial is not None:
            return denial
        temp_file = None
        notification_category = 'order_labels' if sanitize_file_name(name_suffix) == '拆包标签' else 'inventory'
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
            publish_business_notification(notification_category, 'success', count=row_count, file_name=filename)
            
            return json_response({'success': True, 'message': '保存成功', 'fileName': filename, 'path': save_path, 'count': row_count})
        except Exception as e:
            remove_file_silent(temp_file)
            log(f"错误: {str(e)}")
            publish_business_notification(notification_category, 'failure', reason=get_notification_failure_reason(e))
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

    def POST(self, name_suffix='', print_mode='', print_job_id='', retry_confirmed='', **_ignored):
        enable_cors()
        denial = require_sync_pairing()
        if denial is not None:
            return denial
        temp_file = None
        submitting_print = False
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
                submitting_print = True
                print_result = submit_native_unpack_labels(
                    native_label_records, print_job_id,
                    retry_confirmed=str(retry_confirmed).lower() == 'true',
                )
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
                if not print_result['duplicate']:
                    if printed_count > 0:
                        publish_business_notification(
                            'unpack', 'submitted', label_count=print_result['physical_label_count'],
                            count=skipped_count,
                        )
                    elif skipped_count > 0:
                        publish_business_notification('unpack', 'skipped', count=skipped_count)
            else:
                publish_business_notification('order_labels', 'success', count=row_count, file_name=filename)

            return json_response(response)
        except Exception as e:
            remove_file_silent(temp_file)
            log(f"错误: {str(e)}")
            response = {'success': False, 'message': str(e)}
            if isinstance(e, UnpackPrintOutcomeUnknownError):
                response.update(code='PRINT_RESULT_UNKNOWN', resultUnknown=True, retryAllowed=True)
            if print_mode:
                publish_business_notification(
                    'unpack', 'unknown' if isinstance(e, UnpackPrintOutcomeUnknownError) else 'failure',
                    reason=get_notification_failure_reason(e, printing=submitting_print),
                )
            else:
                publish_business_notification('order_labels', 'failure', reason=get_notification_failure_reason(e))
            return json_response(response)
    
    def GET(self):
        enable_cors()
        return json_response({'success': True, 'message': '服务运行中', 'save_path': LABELS_FILE})


class LabelReprint:
    """Independent JSON printing endpoint: no business/export/history writes."""
    exposed = True

    def OPTIONS(self):
        enable_cors()
        return b''

    def POST(self, **_ignored):
        enable_cors()
        denial = require_sync_pairing()
        if denial is not None:
            return denial
        def respond(receipt):
            publish_reprint_notification(receipt)
            return json_response(receipt)

        try:
            content_type = cherrypy.request.headers.get('Content-Type', '').split(';')[0].strip().lower()
            if content_type != 'application/json':
                return respond(reprint_failure('INVALID_REQUEST', '标签补打仅接受 JSON 数据'))
            raw_length = cherrypy.request.headers.get('Content-Length', '')
            content_length = int(raw_length) if raw_length else None
            if content_length is not None and not 0 < content_length <= MAX_LABEL_REPRINT_BYTES:
                return respond(reprint_failure('INVALID_REQUEST', '标签补打请求为空或超过大小限制'))
            # process_request_body=False keeps JSON out of form/multipart
            # processors and their temporary files. Read the raw stream: the
            # unprocessed RequestBody.read expects an internal SizedReader.
            request_stream = getattr(cherrypy.request, 'rfile', None) or cherrypy.request.body
            body = request_stream.read(content_length or MAX_LABEL_REPRINT_BYTES + 1)
            if not body or len(body) > MAX_LABEL_REPRINT_BYTES:
                return respond(reprint_failure('INVALID_REQUEST', '标签补打请求为空或超过大小限制'))
            if content_length is not None and len(body) != content_length:
                return respond(reprint_failure('INVALID_REQUEST', '标签补打请求未完整接收'))
            payload = json.loads(body.decode('utf-8'))
        except (ValueError, UnicodeError):
            return respond(reprint_failure('INVALID_REQUEST', '标签补打 JSON 数据格式无效'))
        except Exception:
            return respond(reprint_failure('INVALID_REQUEST', '无法读取标签补打请求'))
        try:
            return respond(submit_native_label_reprint(payload))
        except Exception:
            # Never pass label payloads into persistent logs, even on failures.
            return respond(reprint_failure(
                'REPRINT_FAILED', '补打未能完成，请核对打印结果后重试', True, True,
            ))


# ==================== 物料数据接口 ====================
class Materials:
    exposed = True

    def OPTIONS(self):
        """处理预检请求"""
        enable_cors()
        return b''

    def POST(self, name_suffix=''):
        enable_cors()
        denial = require_sync_pairing()
        if denial is not None:
            return denial
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
        self.pairing_window = PairingSettingsWindow(
            SYNC_CONFIG_FILE, self.on_pairing_saved,
            lambda message: self.notify('配对设置', message),
        )
        
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

    def open_pairing_settings(self, *_args):
        """打开设置窗口；仅点击确定后保存，不启动配置文件编辑器。"""
        self.pairing_window.show()

    def on_pairing_saved(self, enabled):
        if self.icon:
            try:
                self.icon.update_menu()
            except Exception:
                log('配对设置已保存；托盘状态将在下次打开菜单时刷新。')
        self.notify('配对设置', (
            '已开启配对保护，请在 APP 填写相同密钥并测试连接。'
            if enabled else '已关闭配对保护，APP 无需填写密钥即可连接。'
        ))

    def get_pairing_status_text(self, _item=None):
        try:
            return '配对保护: 已启用' if read_sync_pairing_key() else '配对保护: 未启用（兼容模式）'
        except ValueError:
            return '配对保护: 配置异常，保存和打印已暂停'

    def notify(self, title, message):
        log(f'{title}: {message}')
        if not self.icon:
            return
        try:
            self.icon.notify(message, title)
        except Exception as error:
            log(f'托盘通知失败: {error}')

    def notify_ephemeral(self, title, message):
        """Reprint results share the tray UI without writing any result to logs."""
        if not self.icon:
            return
        try:
            self.icon.notify(message, title)
        except Exception:
            # Do not persist reprint information even when the OS rejects a notification.
            pass

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
        BUSINESS_NOTIFICATIONS.stop()
        self.address_monitor.stop()
        self.pairing_window.close()
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
                pystray.MenuItem(f"版本: {SYNC_EDITION} {SYNC_VERSION}", None, enabled=False),
                pystray.MenuItem(f"同步目录: {DATA_ROOT}", None, enabled=False),
                pystray.MenuItem(self.get_pairing_status_text, None, enabled=False),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("打开同步文件夹", lambda: self.open_folder(DATA_ROOT)),
                pystray.MenuItem("查看运行日志", self.open_logs),
                pystray.MenuItem("配对设置…", self.open_pairing_settings),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("退出 ERP版同步助手", self.quit_app),
            )
            
            # 创建托盘图标
            self.icon = pystray.Icon("label_sync_erp", icon_image, SYNC_DISPLAY_NAME, menu)
            BUSINESS_NOTIFICATIONS.start(self.notify, ephemeral_sender=self.notify_ephemeral)
            try:
                self.address_monitor.start(self.refresh_network_address)
                self.icon.run()
            finally:
                BUSINESS_NOTIFICATIONS.stop()
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
    cherrypy.tree.mount(LabelReprint(), '/label-reprint', {
        '/': {
            'request.dispatch': cherrypy.dispatch.MethodDispatcher(),
            'request.process_request_body': False,
            'log.access_file': '',
            'log.error_file': '',
            'log.screen': False,
            'tools.log_headers.on': False,
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
    log(f"  {SYNC_DISPLAY_NAME} {SYNC_VERSION}")
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
    # Upgrade existing configs as well; hiding must not create or rewrite one.
    hide_pairing_config(SYNC_CONFIG_FILE)
    
    # 启动HTTP服务（在后台线程）
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # 运行托盘图标（主线程）
    tray = TrayIcon()
    tray.run()


if __name__ == '__main__':
    main()
