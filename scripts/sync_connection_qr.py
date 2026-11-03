"""Connection QR window. Config is read-only and all Tk work stays in its UI thread."""
import gc
import ipaddress
import json
import os
import sys
import threading

from PIL import Image, ImageTk
import qrcode

try:
    from .sync_pairing_settings import read_pairing_settings
except ImportError:
    from sync_pairing_settings import read_pairing_settings

QR_IMAGE_SIZE = 300
QR_WINDOW_WIDTH = 360
QR_WINDOW_HEIGHT = 480


def build_connection_code(address, port, key=''):
    """Versioned wire format shared with client/utils/syncPairing.ts."""
    parsed = ipaddress.IPv4Address(address)
    if parsed.is_loopback or parsed.is_unspecified:
        raise ValueError('未找到可用的局域网地址，请连接网络后重试。')
    if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
        raise ValueError('同步服务端口无效。')
    if not isinstance(key, str) or len(key) > 128 or any(not 33 <= ord(c) <= 126 for c in key):
        raise ValueError('配对配置无效，请在配对设置中检查。')
    data = {'type': 'palm-warehouse-sync', 'v': 1, 'ip': str(parsed), 'port': port}
    if key:
        data['key'] = key
    return json.dumps(data, ensure_ascii=True, separators=(',', ':'))


def make_connection_image(code):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=4, border=4)
    qr.add_data(code)
    qr.make(fit=True)
    modules = qr.modules_count + 8
    qr.box_size = QR_IMAGE_SIZE // modules
    if qr.box_size < 3:
        raise ValueError('连接二维码内容过长，无法清晰显示。')
    image = qr.make_image(fill_color='black', back_color='white').convert('RGB')
    canvas = Image.new('RGB', (QR_IMAGE_SIZE, QR_IMAGE_SIZE), 'white')
    offset = (QR_IMAGE_SIZE - image.width) // 2
    canvas.paste(image, (offset, offset))
    return canvas


def popup_position(width, height, anchor, bounds):
    left, top, right, bottom = bounds
    x = max(left, min(anchor[0] - width - 12, right - width))
    y = max(top, min(anchor[1] - height - 12, bottom - height))
    return x, y


def desktop_anchor():
    """Use the monitor work area, including taskbar and secondary-screen bounds."""
    try:
        import ctypes
        from ctypes import wintypes
        class MonitorInfo(ctypes.Structure):
            _fields_ = [('size', wintypes.DWORD), ('monitor', wintypes.RECT), ('work', wintypes.RECT), ('flags', wintypes.DWORD)]
        user = ctypes.windll.user32
        point = wintypes.POINT()
        user.GetCursorPos(ctypes.byref(point))
        user.MonitorFromPoint.argtypes = [wintypes.POINT, wintypes.DWORD]
        user.MonitorFromPoint.restype = wintypes.HANDLE
        user.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MonitorInfo)]
        monitor = user.MonitorFromPoint(point, 2)
        info = MonitorInfo()
        info.size = ctypes.sizeof(info)
        if not user.GetMonitorInfoW(monitor, ctypes.byref(info)):
            return None
        area = info.work
        return (point.x, point.y), (area.left, area.top, area.right, area.bottom)
    except (AttributeError, OSError):
        return None


class ConnectionQrView:
    def __init__(self, root, config_path, address_reader, port):
        import tkinter as tk
        self.root, self.config_path = root, config_path
        self.address_reader, self.port = address_reader, port
        self._code = None
        self.photo = None
        root.title('扫码连接电脑 · 掌上仓库同步助手')
        root.configure(background='#f0f4f8')
        root.resizable(False, False)
        root.geometry(f'{QR_WINDOW_WIDTH}x{QR_WINDOW_HEIGHT}')
        root.minsize(QR_WINDOW_WIDTH, QR_WINDOW_HEIGHT)
        root.maxsize(QR_WINDOW_WIDTH, QR_WINDOW_HEIGHT)
        try:
            base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
            root.iconbitmap(default=os.path.join(base, 'icon.ico'))
        except (OSError, tk.TclError):
            pass
        frame = tk.Frame(root, background='#f0f4f8', padx=20, pady=8)
        frame.pack(fill='both', expand=True)
        def label(text='', **kwargs):
            widget = tk.Label(frame, text=text, background='#f0f4f8', foreground='#183b56', font=('Microsoft YaHei UI', 10), **kwargs)
            widget.pack(pady=4)
            return widget
        title = label('扫码连接电脑')
        title.configure(font=('Microsoft YaHei UI', 15, 'bold'))
        label('使用 PDA 扫描头或 APP 相机扫描')
        image_frame = tk.Frame(frame, width=QR_IMAGE_SIZE, height=QR_IMAGE_SIZE, background='white')
        image_frame.pack(pady=8)
        image_frame.pack_propagate(False)
        self.image = tk.Label(image_frame, background='white', foreground='#c34242', borderwidth=0, highlightthickness=0, wraplength=260, font=('Microsoft YaHei UI', 10))
        self.image.pack(fill='both', expand=True)
        self.address = label()
        self.status = label()
        root.bind('<Escape>', lambda _event: root.destroy())
        root.protocol('WM_DELETE_WINDOW', root.destroy)
        self.refresh()

    def refresh(self):
        try:
            address = self.address_reader()
            settings = read_pairing_settings(self.config_path)
            code = build_connection_code(address, self.port, settings.key)
        except (ValueError, OSError):
            self._code = None
            self.image.configure(image='', text='暂时无法生成连接二维码\n请检查网络及配对设置')
            self.photo = None
            self.address.configure(text='')
            self.status.configure(text='请检查网络及配对设置', foreground='#c34242')
            return False
        if code == self._code:
            return False
        self.photo = ImageTk.PhotoImage(make_connection_image(code), master=self.root)
        self.image.configure(image=self.photo, text='')
        self.address.configure(text=f'{address}:{self.port}')
        self.status.configure(text='配对保护：已开启' if settings.key else '配对保护：未开启', foreground='#183b56')
        self._code = code
        return True


class ConnectionQrWindow:
    def __init__(self, config_path, address_reader, port, on_error):
        self.config_path, self.address_reader, self.port, self.on_error = config_path, address_reader, port, on_error
        self._lock = threading.Lock()
        self._thread = None
        self._focus, self._stop = threading.Event(), threading.Event()

    def show(self):
        with self._lock:
            if self._stop.is_set():
                return
            if self._thread and self._thread.is_alive():
                self._focus.set()
                return
            anchor = desktop_anchor()
            self._thread = threading.Thread(target=self._run, args=(anchor,), name='sync-connection-qr-ui', daemon=True)
            self._thread.start()

    def close(self):
        self._stop.set()

    def _run(self, anchor):
        import tkinter as tk
        root = view = None
        try:
            root = tk.Tk()
            root.withdraw()
            view = ConnectionQrView(root, self.config_path, self.address_reader, self.port)
            root.update_idletasks()
            if anchor:
                x, y = popup_position(QR_WINDOW_WIDTH, QR_WINDOW_HEIGHT, *anchor)
                root.geometry(f'{x:+d}{y:+d}')
            def poll():
                if self._stop.is_set():
                    root.destroy()
                    return
                view.refresh()
                if self._focus.is_set():
                    self._focus.clear()
                    root.deiconify()
                    root.lift()
                    root.focus_force()
                root.after(500, poll)
            root.report_callback_exception = lambda *_args: self.on_error('连接二维码窗口发生异常，请关闭后重试。')
            root.deiconify()
            self._focus.set()
            poll()
            root.mainloop()
        except Exception:
            self.on_error('无法打开连接二维码，请检查同步助手桌面组件。')
        finally:
            if root is not None:
                try:
                    root.destroy()
                except tk.TclError:
                    pass
            view = root = None
            gc.collect()
            with self._lock:
                self._thread = None
