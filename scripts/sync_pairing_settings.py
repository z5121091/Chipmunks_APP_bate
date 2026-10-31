"""Local pairing configuration and its desktop settings window.

Only the GUI thread touches Tk objects. Opening or cancelling never writes a
configuration file; saving replaces the complete file atomically.
"""

import gc
import json
import os
import sys
import tempfile
import threading
from dataclasses import dataclass, field


PAIRING_ENV = 'PALM_WAREHOUSE_SYNC_PAIRING_KEY'


@dataclass(frozen=True)
class PairingSettings:
    key: str = field(repr=False)
    managed_by_environment: bool = False


def validate_pairing_key(value, *, required=False):
    if not isinstance(value, str):
        raise ValueError('配对密钥格式不正确，请重新输入。')
    key = value.strip()
    if required and not key:
        raise ValueError('开启配对保护后，请先输入密钥。')
    if len(key) > 128 or any(not 33 <= ord(character) <= 126 for character in key):
        raise ValueError('密钥须为 1～128 个英文字母、数字或英文符号，不含空格和中文。')
    return key


def load_pairing_config(path):
    try:
        with open(path, 'r', encoding='utf-8-sig') as source:
            config = json.load(source)
        if not isinstance(config, dict) or not isinstance(config.get('pairingKey', ''), str):
            raise ValueError('invalid pairing configuration')
        return config
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as error:
        raise ValueError('无法读取配对配置，请检查同步目录权限或配置文件；原设置未更改。') from error


def read_pairing_settings(path):
    if PAIRING_ENV in os.environ:
        return PairingSettings(validate_pairing_key(os.environ[PAIRING_ENV]), True)
    return PairingSettings(validate_pairing_key(load_pairing_config(path).get('pairingKey', '')))


def hide_pairing_config(path):
    """Hide an existing Windows config without changing its contents or protection.

    This is only a display preference. Missing files, unsupported platforms or
    attribute permission failures must never prevent pairing or create a file.
    """
    if os.name != 'nt':
        return False
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        get_attributes = kernel32.GetFileAttributesW
        get_attributes.argtypes = [wintypes.LPCWSTR]
        get_attributes.restype = wintypes.DWORD
        set_attributes = kernel32.SetFileAttributesW
        set_attributes.argtypes = [wintypes.LPCWSTR, wintypes.DWORD]
        set_attributes.restype = wintypes.BOOL

        filename = os.fspath(path)
        attributes = get_attributes(filename)
        if attributes == 0xFFFFFFFF or attributes & 0x10:  # Invalid or a directory.
            return False
        if attributes & 0x02:
            return True
        # NORMAL is valid only by itself; preserve all other existing attributes.
        return bool(set_attributes(filename, (attributes & ~0x80) | 0x02))
    except (OSError, ValueError):
        return False


def save_pairing_settings(path, enabled, key):
    """Persist only an explicit confirmation, retaining unrelated settings."""
    if PAIRING_ENV in os.environ:
        raise ValueError('当前配对由启动环境变量控制，请移除该变量并重启助手后再修改。')
    if not isinstance(enabled, bool):
        raise ValueError('配对开关状态不正确，请重新打开设置。')
    saved_key = validate_pairing_key(key, required=True) if enabled else ''
    config = load_pairing_config(path)
    config['pairingKey'] = saved_key
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode='w', encoding='utf-8', dir=directory,
            prefix='.sync-pairing-', suffix='.tmp', delete=False,
        ) as output:
            temporary_path = output.name
            json.dump(config, output, ensure_ascii=False, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, path)
        # Atomic replacement installs the temporary file's attributes, so apply
        # Hidden after every successful save, including changes and disabling.
        hide_pairing_config(path)
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.unlink(temporary_path)
    return saved_key


class PairingSettingsView:
    """One settings form; callbacks never receive the secret."""

    def __init__(self, root, config_path, on_saved):
        import tkinter as tk
        from tkinter import ttk

        self.root = root
        self.config_path = config_path
        self.on_saved = on_saved
        self.saved = False
        self.read_only = False
        initial_key = ''
        initial_error = ''
        try:
            settings = read_pairing_settings(config_path)
            self.read_only = settings.managed_by_environment
            initial_key = settings.key
        except ValueError as error:
            self.read_only = True
            initial_error = str(error)

        root.title('配对设置 · 掌上仓库同步助手')
        # The build already bundles icon.ico at the one-file extraction root.
        # Resolve from this module when running directly, never from the CWD.
        resource_root = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
        try:
            root.iconbitmap(default=os.path.join(resource_root, 'icon.ico'))
        except (OSError, tk.TclError):
            # A missing decorative asset must not prevent pairing management.
            pass
        root.configure(background='#f0f4f8')
        root.minsize(480, 370)
        root.resizable(True, True)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(0, weight=1)
        style = ttk.Style(root)
        style.configure('Pairing.TFrame', background='#f0f4f8')
        style.configure('Pairing.TLabel', background='#f0f4f8', foreground='#183b56', font=('Microsoft YaHei UI', 10))
        style.configure('PairingTitle.TLabel', background='#f0f4f8', foreground='#183b56', font=('Microsoft YaHei UI', 16, 'bold'))
        style.configure('Pairing.TCheckbutton', background='#f0f4f8', foreground='#183b56', font=('Microsoft YaHei UI', 11))
        style.configure('PairingError.TLabel', background='#f0f4f8', foreground='#c34242', font=('Microsoft YaHei UI', 10))
        style.configure('Pairing.TButton', font=('Microsoft YaHei UI', 10), padding=(16, 6))

        frame = ttk.Frame(root, style='Pairing.TFrame', padding=24)
        frame.grid(row=0, column=0, sticky='nsew')
        frame.columnconfigure(0, weight=1)
        ttk.Label(frame, text='配对设置', style='PairingTitle.TLabel').grid(row=0, column=0, sticky='w')
        ttk.Label(frame, text='控制哪些 APP 可以向这台电脑保存数据和打印标签。', style='Pairing.TLabel', wraplength=450).grid(row=1, column=0, sticky='w', pady=(6, 20))

        self.enabled = tk.BooleanVar(root, value=bool(initial_key))
        self.key = tk.StringVar(root, value=initial_key if not self.read_only else '')
        self.show_key = tk.BooleanVar(root, value=False)
        self.error = tk.StringVar(root, value=initial_error)
        self.toggle = ttk.Checkbutton(frame, text='启用配对保护', variable=self.enabled, command=self.update_enabled, style='Pairing.TCheckbutton')
        self.toggle.grid(row=2, column=0, sticky='w', pady=(0, 12))

        self.hint = ttk.Label(frame, style='Pairing.TLabel', wraplength=450)
        self.hint.grid(row=3, column=0, sticky='w', pady=(0, 16))
        ttk.Label(frame, text='配对密钥', style='Pairing.TLabel').grid(row=4, column=0, sticky='w', pady=(0, 6))
        self.entry = ttk.Entry(frame, textvariable=self.key, show='●', font=('Segoe UI', 11))
        self.entry.grid(row=5, column=0, sticky='ew', ipady=5)
        self.visibility = ttk.Checkbutton(frame, text='显示密钥', variable=self.show_key, command=self.update_visibility, style='Pairing.TCheckbutton')
        self.visibility.grid(row=6, column=0, sticky='w', pady=(8, 0))
        self.error_label = ttk.Label(frame, textvariable=self.error, style='PairingError.TLabel', wraplength=450)
        self.error_label.grid(row=7, column=0, sticky='ew', pady=(10, 4))
        frame.rowconfigure(8, weight=1)
        actions = ttk.Frame(frame, style='Pairing.TFrame')
        actions.grid(row=9, column=0, sticky='e', pady=(14, 0))
        self.cancel_button = ttk.Button(actions, text='取消', command=self.cancel, style='Pairing.TButton')
        self.cancel_button.grid(row=0, column=0, padx=(0, 10))
        self.confirm_button = ttk.Button(actions, text='确定', command=self.confirm, style='Pairing.TButton', default='active')
        self.confirm_button.grid(row=0, column=1)

        self.update_enabled(focus=False)
        root.protocol('WM_DELETE_WINDOW', self.cancel)
        root.bind('<Escape>', lambda _event: self.cancel())
        root.bind('<Return>', self.handle_return)
        width, height = self.fit_contents()
        root.geometry(f'{width}x{height}+{max(0, (root.winfo_screenwidth() - width) // 2)}+{max(0, (root.winfo_screenheight() - height) // 2)}')

    def fit_contents(self):
        self.root.update_idletasks()
        width = max(520, self.root.winfo_reqwidth())
        height = max(400, self.root.winfo_reqheight())
        self.root.minsize(width, height)
        return width, height

    def update_enabled(self, *, focus=True):
        if not self.read_only:
            self.error.set('')
        active = self.enabled.get() and not self.read_only
        self.entry.configure(state='normal' if active else 'disabled')
        self.visibility.configure(state='normal' if active else 'disabled')
        if not active:
            self.show_key.set(False)
        self.update_visibility()
        if self.read_only:
            self.toggle.configure(state='disabled')
            self.confirm_button.configure(state='disabled')
            self.hint.configure(text=(
                '当前设置由启动环境变量控制。请移除该变量并重启助手后，再使用此窗口修改。'
                if PAIRING_ENV in os.environ else '配置读取异常，暂不能保存。请先修复配置后重新打开。'
            ))
        elif active:
            self.hint.configure(text='请输入 1～128 个英文字母、数字或英文符号。APP 需要填写相同密钥才能连接。')
            if focus:
                self.entry.focus_set()
        else:
            self.hint.configure(text='关闭后无需密钥，APP 中的配对密钥可以留空。点击确定后生效。')
        self.fit_contents()

    def update_visibility(self):
        self.entry.configure(show='' if self.show_key.get() and self.enabled.get() else '●')

    def confirm(self):
        if self.read_only or self.saved:
            return
        try:
            save_pairing_settings(self.config_path, self.enabled.get(), self.key.get())
        except ValueError as error:
            self.error.set(str(error))
            self.fit_contents()
            if self.enabled.get():
                self.entry.focus_set()
            return
        except OSError:
            self.error.set('无法保存设置，请检查同步目录的写入权限；原设置未更改。')
            self.fit_contents()
            return
        self.saved = True
        enabled = self.enabled.get()
        self.root.destroy()
        self.on_saved(enabled)

    def cancel(self):
        self.root.destroy()

    def handle_return(self, _event):
        if self.root.focus_get() is self.cancel_button:
            self.cancel()
        else:
            self.confirm()
        return 'break'


class PairingSettingsWindow:
    """Singleton per tray: repeated menu clicks focus the same window."""

    def __init__(self, config_path, on_saved, on_error):
        self.config_path = config_path
        self.on_saved = on_saved
        self.on_error = on_error
        self._lock = threading.Lock()
        self._thread = None
        self._focus = threading.Event()
        self._stop = threading.Event()

    def show(self):
        with self._lock:
            if self._stop.is_set():
                return
            if self._thread and self._thread.is_alive():
                self._focus.set()
                return
            self._focus.clear()
            self._thread = threading.Thread(target=self._run, name='sync-pairing-ui', daemon=True)
            self._thread.start()

    def close(self):
        self._stop.set()

    def _run(self):
        root = view = None
        try:
            import tkinter as tk

            root = tk.Tk()
            root.withdraw()
            view = PairingSettingsView(root, self.config_path, self.on_saved)

            def poll():
                if self._stop.is_set():
                    root.destroy()
                    return
                if self._focus.is_set():
                    self._focus.clear()
                    root.deiconify()
                    root.lift()
                    root.focus_force()
                    if view.enabled.get() and not view.read_only:
                        view.entry.focus_set()
                root.after(100, poll)

            # Tk callbacks otherwise write tracebacks to a console that the EXE
            # does not have. Keep messages generic so no secret reaches logs.
            root.report_callback_exception = lambda *_args: self.on_error('设置窗口发生异常，请关闭后重试。')
            root.deiconify()
            self._focus.set()
            poll()
            root.mainloop()
        except Exception:
            self.on_error('无法打开配对设置窗口，请检查同步助手是否包含完整的 Tk 桌面组件。')
        finally:
            if root is not None:
                try:
                    root.destroy()
                except Exception:
                    pass
            # Release Tcl variables/interpreter in their owning GUI thread.
            view = root = None
            gc.collect()
            with self._lock:
                self._thread = None
