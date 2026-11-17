"""Bounded runtime logs and the sync helper's built-in log viewer."""

from collections import deque
import gc
from itertools import islice
import threading

try:
    from .sync_window_icon import apply_sync_window_icon
except ImportError:
    from sync_window_icon import apply_sync_window_icon


class RuntimeLogBuffer:
    def __init__(self, max_entries=1000, max_message_length=2048):
        if max_entries < 1 or max_message_length < 1:
            raise ValueError('Log buffer limits must be positive')
        self.max_entries = max_entries
        self._max_message_length = max_message_length
        self._entries = deque(maxlen=max_entries)
        self._sequence = 0
        self._lock = threading.Lock()

    def append(self, message):
        # Tk uses LF to count the logical lines belonging to each log entry.
        message = str(message).replace('\r\n', '\n').replace('\r', '\n').replace('\x00', '\ufffd')
        if len(message) > self._max_message_length:
            message = message[:self._max_message_length - 1] + '…'
        with self._lock:
            self._entries.append(message)
            self._sequence += 1
        return message

    def read_after(self, cursor):
        """Read new entries and the retained sequence range in one snapshot."""
        with self._lock:
            first = self._sequence - len(self._entries) + 1
            if cursor >= self._sequence:
                return first, self._sequence, ()
            offset = max(0, cursor - first + 1)
            return first, self._sequence, tuple(islice(self._entries, offset, None))


class RuntimeLogView:
    def __init__(self, root, buffer):
        import tkinter as tk
        from tkinter import ttk

        self.root = root
        self.buffer = buffer
        self._cursor = 0
        self._line_counts = deque()

        root.title('运行日志 · 掌上仓库同步助手')
        root.geometry('780x470')
        root.minsize(460, 270)
        apply_sync_window_icon(root)

        content = ttk.Frame(root, padding=(14, 12))
        content.pack(fill='both', expand=True)
        ttk.Label(content, text=f'本次运行的最近 {buffer.max_entries} 条日志').pack(anchor='w', pady=(0, 8))

        log_panel = ttk.Frame(content)
        log_panel.pack(fill='both', expand=True)
        scrollbar = ttk.Scrollbar(log_panel, orient='vertical')
        scrollbar.pack(side='right', fill='y')
        self.text = tk.Text(log_panel, wrap='word', state='disabled', padx=8, pady=6,
                            yscrollcommand=scrollbar.set, exportselection=False)
        self.text.pack(side='left', fill='both', expand=True)
        scrollbar.configure(command=self.text.yview)

        footer = ttk.Frame(content)
        footer.pack(fill='x', pady=(8, 0))
        self.status = ttk.Label(footer, text='暂无日志')
        self.status.pack(side='left')
        ttk.Button(footer, text='关闭', command=root.destroy).pack(side='right')
        self.copy_button = ttk.Button(footer, text='复制日志', command=self.copy_logs, state='disabled')
        self.copy_button.pack(side='right', padx=(0, 8))

    def refresh(self):
        first, latest, entries = self.buffer.read_after(self._cursor)
        if not entries:
            return

        was_at_bottom = self.text.yview()[1] >= 0.999
        retained = max(0, self._cursor - first + 1)
        remove_lines = sum(self._line_counts.popleft() for _ in range(len(self._line_counts) - retained))
        self.text.configure(state='normal')
        try:
            if remove_lines:
                self.text.delete('1.0', f'{remove_lines + 1}.0')
            self.text.insert('end', '\n'.join(entries) + '\n')
        finally:
            self.text.configure(state='disabled')
        self._line_counts.extend(entry.count('\n') + 1 for entry in entries)
        self._cursor = latest
        if was_at_bottom:
            self.text.see('end')
        self.status.configure(text=f'{len(self._line_counts)} 条日志')
        self.copy_button.configure(state='normal')

    def copy_logs(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.text.get('1.0', 'end-1c').rstrip('\n'))
        self.status.configure(text=f'已复制 {len(self._line_counts)} 条日志')


class LogWindow:
    """One Tk window per tray, with Tk accessed only by its owning thread."""

    def __init__(self, buffer, on_error=None):
        self.buffer = buffer
        self.on_error = on_error or (lambda _message: None)
        self._lock = threading.Lock()
        self._thread = None
        self._focus = threading.Event()
        self._stop = threading.Event()

    def show(self):
        with self._lock:
            if self._stop.is_set():
                return
            self._focus.set()
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._run, name='sync-log-ui', daemon=True)
            self._thread.start()

    def close(self):
        with self._lock:
            self._stop.set()
            worker = self._thread
        if worker and worker is not threading.current_thread():
            worker.join(timeout=1)

    def _run(self):
        root = view = None
        try:
            import tkinter as tk

            root = tk.Tk()
            root.withdraw()
            view = RuntimeLogView(root, self.buffer)

            def poll():
                if self._stop.is_set():
                    root.destroy()
                    return
                if self._focus.is_set():
                    self._focus.clear()
                    root.deiconify()
                    root.lift()
                    root.focus_force()
                if root.state() != 'iconic':
                    view.refresh()
                root.after(500, poll)

            root.report_callback_exception = lambda *_args: self.on_error('运行日志窗口发生异常，请关闭后重试。')
            poll()
            root.mainloop()
        except Exception:
            self.on_error('无法打开运行日志，请检查同步助手桌面组件。')
        finally:
            if root is not None:
                try:
                    root.destroy()
                except tk.TclError:
                    pass
            # Release the Tcl interpreter in the thread that created it.
            view = root = None
            gc.collect()
            with self._lock:
                self._thread = None
