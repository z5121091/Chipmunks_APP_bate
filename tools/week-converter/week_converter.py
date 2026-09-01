import ctypes
import datetime
import os
import shutil
import subprocess
import sys
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, ttk


APP_NAME = "生产周次转换工具"
APP_ID = "Chipmunks.ProductionWeekConverter"
INSTALL_DIRECTORY = Path("ShanghaiChipmunks") / "ProductionWeekConverter"
WINDOW_WIDTH = 500
WINDOW_HEIGHT = 370


def parse_week_code(week_code):
    """解析 2601、2602S、202601、2026-W01 等常见生产周次。"""
    raw_value = str(week_code or "").strip().upper()
    digits = "".join(char for char in raw_value if char.isdigit())

    if len(digits) >= 6 and digits[:2] in ("19", "20", "21"):
        year = int(digits[:4])
        week = int(digits[4:6])
        normalized = f"{year}{week:02d}"
    elif len(digits) >= 4:
        year = 2000 + int(digits[:2])
        week = int(digits[2:4])
        normalized = f"{str(year)[-2:]}{week:02d}"
    else:
        raise ValueError("请输入 4 位周次，例如 2601")

    if week < 1 or week > 53:
        raise ValueError("周次必须在 01 到 53 之间")

    try:
        monday = datetime.date.fromisocalendar(year, week, 1)
    except ValueError as error:
        raise ValueError(f"{year} 年没有第 {week:02d} 周") from error

    return {
        "normalized": normalized,
        "year": year,
        "week": week,
        "monday": monday,
        "sunday": monday + datetime.timedelta(days=6),
    }


def resource_path(filename):
    base_path = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base_path / filename


def configure_windows_identity():
    if sys.platform != "win32":
        return

    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except (AttributeError, OSError):
        pass


def create_desktop_shortcut(target_path):
    environment = os.environ.copy()
    environment.update(
        {
            "WEEK_CONVERTER_TARGET": str(target_path),
            "WEEK_CONVERTER_WORKING_DIR": str(target_path.parent),
            "WEEK_CONVERTER_SHORTCUT": f"{APP_NAME}.lnk",
        }
    )
    script = (
        "$desktop=[Environment]::GetFolderPath('Desktop');"
        "$shell=New-Object -ComObject WScript.Shell;"
        "$path=Join-Path $desktop $env:WEEK_CONVERTER_SHORTCUT;"
        "$shortcut=$shell.CreateShortcut($path);"
        "$shortcut.TargetPath=$env:WEEK_CONVERTER_TARGET;"
        "$shortcut.WorkingDirectory=$env:WEEK_CONVERTER_WORKING_DIR;"
        "$shortcut.IconLocation=($env:WEEK_CONVERTER_TARGET + ',0');"
        "$shortcut.Description='Convert a production week code to ISO calendar dates.';"
        "$shortcut.Save();"
    )
    subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
        check=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
        env=environment,
        timeout=15,
    )


def install_for_current_user():
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return

    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise RuntimeError("无法找到当前用户的本地应用目录")

    source_path = Path(sys.executable).resolve()
    install_path = (Path(local_app_data) / INSTALL_DIRECTORY / f"{APP_NAME}.exe").resolve()

    if source_path != install_path:
        install_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, install_path)
        create_desktop_shortcut(install_path)
    else:
        create_desktop_shortcut(install_path)


class WeekConverterApp:
    def __init__(self, window):
        self.window = window
        self.input_var = tk.StringVar()
        self.result_var = tk.StringVar(value="输入周次后点击转换，结果格式：2026-01-05")
        self.copy_value = ""

        self.configure_window()
        self.configure_styles()
        self.build_content()

    def configure_window(self):
        self.window.title(APP_NAME)
        self.window.resizable(False, False)
        self.window.configure(bg="#F3F6FA")
        self.window.protocol("WM_DELETE_WINDOW", self.window.destroy)
        self.window.bind("<Escape>", lambda _event: self.window.destroy())

        icon_path = resource_path("icon.ico")
        if icon_path.exists():
            try:
                self.window.iconbitmap(default=str(icon_path))
            except tk.TclError:
                pass

        screen_width = self.window.winfo_screenwidth()
        screen_height = self.window.winfo_screenheight()
        x = max(0, int((screen_width - WINDOW_WIDTH) / 2))
        y = max(0, int((screen_height - WINDOW_HEIGHT) / 2))
        self.window.geometry(f"{WINDOW_WIDTH}x{WINDOW_HEIGHT}+{x}+{y}")

    def configure_styles(self):
        style = ttk.Style(self.window)
        style.theme_use("clam")
        style.configure("TFrame", background="#F3F6FA")
        style.configure("Card.TFrame", background="#FFFFFF")
        style.configure(
            "Title.TLabel",
            background="#F3F6FA",
            foreground="#17324D",
            font=("Microsoft YaHei UI", 16, "bold"),
        )
        style.configure(
            "Hint.TLabel",
            background="#F3F6FA",
            foreground="#64748B",
            font=("Microsoft YaHei UI", 9),
        )
        style.configure(
            "Body.TLabel",
            background="#FFFFFF",
            foreground="#17324D",
            font=("Microsoft YaHei UI", 11),
        )
        style.configure(
            "Result.TLabel",
            background="#FFFFFF",
            foreground="#0F766E",
            font=("Microsoft YaHei UI", 12, "bold"),
        )
        style.configure(
            "Primary.TButton",
            background="#2563EB",
            foreground="#FFFFFF",
            font=("Microsoft YaHei UI", 10, "bold"),
            padding=(10, 10),
        )
        style.map("Primary.TButton", background=[("active", "#1D4ED8")])
        style.configure(
            "Copy.TButton",
            background="#0F766E",
            foreground="#FFFFFF",
            font=("Microsoft YaHei UI", 10, "bold"),
            padding=(10, 10),
        )
        style.map("Copy.TButton", background=[("active", "#115E59")])
        style.configure(
            "Secondary.TButton",
            background="#E2E8F0",
            foreground="#334155",
            font=("Microsoft YaHei UI", 10),
            padding=(10, 10),
        )
        style.map("Secondary.TButton", background=[("active", "#CBD5E1")])

    def build_content(self):
        root = ttk.Frame(self.window, padding=20)
        root.pack(fill="both", expand=True)

        ttk.Label(root, text=APP_NAME, style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            root,
            text=(
                "按 ISO 周次计算，周一作为一周开始；支持 2601、2602S、202601、2026-W01。\n"
                "上海花栗鼠科技有限公司"
            ),
            style="Hint.TLabel",
        ).pack(anchor="w", pady=(4, 14))

        card = ttk.Frame(root, style="Card.TFrame", padding=18)
        card.pack(fill="both", expand=True)

        ttk.Label(card, text="生产周次", style="Body.TLabel").pack(anchor="w")
        self.entry = ttk.Entry(card, textvariable=self.input_var, font=("Microsoft YaHei UI", 13))
        self.entry.pack(fill="x", pady=(6, 14), ipady=7)
        self.entry.bind("<Return>", lambda _event: self.convert())

        result_frame = tk.Frame(card, bg="#FFFFFF", height=62)
        result_frame.pack(fill="x", pady=(0, 14))
        result_frame.pack_propagate(False)
        ttk.Label(
            result_frame,
            textvariable=self.result_var,
            style="Result.TLabel",
            wraplength=410,
            justify="left",
        ).pack(fill="both", expand=True)

        button_row = ttk.Frame(card, style="Card.TFrame")
        button_row.pack(fill="x")
        for column in range(3):
            button_row.columnconfigure(column, weight=1)

        ttk.Button(button_row, text="转换", command=self.convert, style="Primary.TButton").grid(
            row=0, column=0, sticky="ew", padx=(0, 8)
        )
        ttk.Button(button_row, text="复制日期", command=self.copy_result, style="Copy.TButton").grid(
            row=0, column=1, sticky="ew", padx=4
        )
        ttk.Button(button_row, text="清空", command=self.clear, style="Secondary.TButton").grid(
            row=0, column=2, sticky="ew", padx=(8, 0)
        )

        self.entry.focus_set()

    def convert(self):
        try:
            parsed = parse_week_code(self.input_var.get())
            monday = parsed["monday"].strftime("%Y-%m-%d")
            sunday = parsed["sunday"].strftime("%Y-%m-%d")
            self.result_var.set(
                f"{parsed['normalized']} -> {monday}\n"
                f"第 {parsed['week']:02d} 周：{monday} 至 {sunday}"
            )
            self.copy_value = monday
        except ValueError as error:
            self.copy_value = ""
            self.result_var.set(str(error))

    def copy_result(self):
        if not self.copy_value:
            self.convert()
        if not self.copy_value:
            messagebox.showwarning("无法复制", "请先输入有效周次", parent=self.window)
            return

        self.window.clipboard_clear()
        self.window.clipboard_append(self.copy_value)
        self.window.update()
        copied = self.copy_value
        self.input_var.set("")
        self.copy_value = ""
        self.result_var.set(f"已复制：{copied}")
        self.entry.focus_set()

    def clear(self):
        self.input_var.set("")
        self.copy_value = ""
        self.result_var.set("输入周次后点击转换，结果格式：2026-01-05")
        self.entry.focus_set()


def self_check():
    assert parse_week_code("2601")["monday"] == datetime.date(2025, 12, 29)
    assert parse_week_code("2602S")["week"] == 2
    assert parse_week_code("2026-W01")["normalized"] == "202601"
    try:
        parse_week_code("2654")
    except ValueError:
        return
    raise AssertionError("无效周次没有被拒绝")


def main():
    configure_windows_identity()
    try:
        install_for_current_user()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        if sys.platform == "win32":
            ctypes.windll.user32.MessageBoxW(
                None,
                f"创建桌面快捷方式失败：\n{error}",
                APP_NAME,
                0x10,
            )

    window = tk.Tk()
    WeekConverterApp(window)
    window.mainloop()


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_check()
        print("week converter self-check passed")
    else:
        main()
