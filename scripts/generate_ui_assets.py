from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "client" / "assets" / "images" / "ui-redesign"
ICON_DIR = ASSET_DIR / "icons"
BG_DIR = ASSET_DIR / "backgrounds"

ICON_SIZE = 512
SCALE = 4
CANVAS = ICON_SIZE * SCALE

COLORS = {
    "primary": "#173A5E",
    "accent": "#2F6FDD",
    "success": "#168A67",
    "warning": "#C7862E",
    "error": "#D34B4B",
    "cyan": "#198CA8",
    "muted": "#5F7187",
    "bg_root": "#EEF3F8",
    "bg_card": "#FBFCFE",
    "bg_inset": "#F5F8FB",
    "dark_root": "#07111D",
    "dark_card": "#14283F",
    "dark_inset": "#17314C",
    "border": "#D7E0EA",
}


def hex_to_rgba(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    value = value.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), alpha


def scaled_box(box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    return tuple(v * SCALE for v in box)  # type: ignore[return-value]


def downsample(image: Image.Image) -> Image.Image:
    return image.resize((ICON_SIZE, ICON_SIZE), Image.Resampling.LANCZOS)


def icon_canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image)


def line(draw: ImageDraw.ImageDraw, points: list[tuple[int, int]], color: str, width: int = 24) -> None:
    draw.line([(x * SCALE, y * SCALE) for x, y in points], fill=hex_to_rgba(color), width=width * SCALE, joint="curve")


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], radius: int, outline: str, width: int = 22, fill: str | None = None) -> None:
    draw.rounded_rectangle(
        scaled_box(box),
        radius=radius * SCALE,
        fill=hex_to_rgba(fill, 24) if fill else None,
        outline=hex_to_rgba(outline),
        width=width * SCALE,
    )


def rect(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], color: str, width: int = 22, fill: str | None = None) -> None:
    draw.rectangle(
        scaled_box(box),
        outline=hex_to_rgba(color),
        width=width * SCALE,
        fill=hex_to_rgba(fill, 24) if fill else None,
    )


def ellipse(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], color: str, width: int = 22, fill: str | None = None, alpha: int = 255) -> None:
    draw.ellipse(
        scaled_box(box),
        outline=hex_to_rgba(color, alpha),
        width=width * SCALE,
        fill=hex_to_rgba(fill, 28) if fill else None,
    )


def draw_barcode(draw: ImageDraw.ImageDraw, x: int, y: int, h: int, color: str) -> None:
    widths = [8, 4, 12, 4, 6, 10, 4, 12, 6]
    cursor = x
    for index, w in enumerate(widths):
        if index % 2 == 0:
            draw.rounded_rectangle(
                (cursor * SCALE, y * SCALE, (cursor + w) * SCALE, (y + h) * SCALE),
                radius=2 * SCALE,
                fill=hex_to_rgba(color),
            )
        cursor += w + 6


def save_icon(name: str, color: str, drawer: Callable[[ImageDraw.ImageDraw, str], None]) -> dict[str, object]:
    image, draw = icon_canvas()
    drawer(draw, color)
    output = downsample(image)
    path = ICON_DIR / f"{name}.png"
    output.save(path)
    return {
        "name": name,
        "file": str(path.relative_to(ROOT)).replace("\\", "/"),
        "size": ICON_SIZE,
        "background": "transparent",
        "color": color,
    }


def inbound(draw: ImageDraw.ImageDraw, color: str) -> None:
    rounded(draw, (126, 96, 386, 416), 38, color, 24)
    line(draw, [(256, 154), (256, 312)], color, 28)
    line(draw, [(190, 246), (256, 312), (322, 246)], color, 28)
    draw_barcode(draw, 178, 354, 30, color)


def outbound(draw: ImageDraw.ImageDraw, color: str) -> None:
    rounded(draw, (90, 184, 330, 336), 26, color, 24)
    line(draw, [(330, 228), (394, 228), (432, 276), (432, 336), (330, 336)], color, 24)
    ellipse(draw, (142, 326, 200, 384), color, 20)
    ellipse(draw, (348, 326, 406, 384), color, 20)
    line(draw, [(160, 152), (244, 152), (214, 122)], color, 22)


def documents(draw: ImageDraw.ImageDraw, color: str) -> None:
    rounded(draw, (112, 104, 400, 408), 28, color, 24)
    line(draw, [(320, 104), (400, 184), (320, 184), (320, 104)], color, 22)
    line(draw, [(168, 236), (344, 236)], color, 22)
    line(draw, [(168, 286), (328, 286)], color, 22)
    line(draw, [(168, 336), (292, 336)], color, 22)


def inventory(draw: ImageDraw.ImageDraw, color: str) -> None:
    rounded(draw, (104, 94, 408, 418), 36, color, 24)
    line(draw, [(176, 250), (230, 304), (346, 184)], color, 30)
    line(draw, [(174, 356), (338, 356)], color, 22)
    line(draw, [(174, 128), (338, 128)], color, 20)


def material_binding(draw: ImageDraw.ImageDraw, color: str) -> None:
    rounded(draw, (84, 132, 222, 270), 24, color, 22)
    rounded(draw, (290, 242, 428, 380), 24, color, 22)
    line(draw, [(222, 202), (290, 202), (290, 292)], color, 24)
    line(draw, [(156, 270), (156, 324), (290, 324)], color, 24)
    line(draw, [(126, 194), (180, 194)], color, 18)
    line(draw, [(334, 304), (388, 304)], color, 18)


def settings(draw: ImageDraw.ImageDraw, color: str) -> None:
    ellipse(draw, (176, 176, 336, 336), color, 26)
    ellipse(draw, (222, 222, 290, 290), color, 22)
    for angle in range(0, 360, 45):
        rad = math.radians(angle)
        cx, cy = 256, 256
        x1 = cx + math.cos(rad) * 112
        y1 = cy + math.sin(rad) * 112
        x2 = cx + math.cos(rad) * 156
        y2 = cy + math.sin(rad) * 156
        line(draw, [(int(x1), int(y1)), (int(x2), int(y2))], color, 22)


def warehouse(draw: ImageDraw.ImageDraw, color: str) -> None:
    line(draw, [(86, 212), (256, 116), (426, 212)], color, 26)
    rounded(draw, (122, 212, 390, 408), 20, color, 24)
    rect(draw, (184, 282, 328, 408), color, 22)
    line(draw, [(184, 324), (328, 324)], color, 18)
    line(draw, [(184, 366), (328, 366)], color, 18)


def scan_frame(draw: ImageDraw.ImageDraw, color: str) -> None:
    corners = [
        [(104, 190), (104, 104), (190, 104)],
        [(322, 104), (408, 104), (408, 190)],
        [(408, 322), (408, 408), (322, 408)],
        [(190, 408), (104, 408), (104, 322)],
    ]
    for pts in corners:
        line(draw, pts, color, 28)
    draw_barcode(draw, 174, 226, 64, color)


def order(draw: ImageDraw.ImageDraw, color: str) -> None:
    rounded(draw, (114, 94, 398, 418), 28, color, 24)
    line(draw, [(176, 164), (336, 164)], color, 22)
    line(draw, [(176, 222), (336, 222)], color, 22)
    line(draw, [(176, 280), (284, 280)], color, 22)
    rounded(draw, (164, 332, 348, 378), 18, color, 18)


def backup_cloud(draw: ImageDraw.ImageDraw, color: str) -> None:
    ellipse(draw, (150, 172, 278, 300), color, 24)
    ellipse(draw, (234, 132, 372, 304), color, 24)
    line(draw, [(154, 300), (394, 300)], color, 26)
    line(draw, [(256, 354), (256, 236)], color, 26)
    line(draw, [(206, 300), (256, 236), (306, 300)], color, 26)


def sync_computer(draw: ImageDraw.ImageDraw, color: str) -> None:
    rounded(draw, (96, 116, 416, 330), 24, color, 24)
    line(draw, [(200, 390), (312, 390)], color, 24)
    line(draw, [(256, 330), (256, 390)], color, 24)
    line(draw, [(172, 214), (220, 166), (268, 214)], color, 22)
    line(draw, [(340, 232), (292, 280), (244, 232)], color, 22)


def database_safe(draw: ImageDraw.ImageDraw, color: str) -> None:
    ellipse(draw, (122, 96, 390, 190), color, 22)
    line(draw, [(122, 142), (122, 336)], color, 22)
    line(draw, [(390, 142), (390, 336)], color, 22)
    ellipse(draw, (122, 288, 390, 382), color, 22)
    line(draw, [(194, 252), (242, 300), (326, 214)], color, 26)


def success_state(draw: ImageDraw.ImageDraw, color: str) -> None:
    ellipse(draw, (96, 96, 416, 416), color, 24)
    line(draw, [(178, 262), (236, 320), (344, 206)], color, 32)


def warning_state(draw: ImageDraw.ImageDraw, color: str) -> None:
    line(draw, [(256, 92), (424, 392), (88, 392), (256, 92)], color, 28)
    line(draw, [(256, 194), (256, 292)], color, 28)
    ellipse(draw, (238, 326, 274, 362), color, 18, fill=color)


def error_state(draw: ImageDraw.ImageDraw, color: str) -> None:
    ellipse(draw, (96, 96, 416, 416), color, 24)
    line(draw, [(190, 190), (322, 322)], color, 30)
    line(draw, [(322, 190), (190, 322)], color, 30)


def search(draw: ImageDraw.ImageDraw, color: str) -> None:
    ellipse(draw, (112, 112, 316, 316), color, 26)
    line(draw, [(286, 286), (404, 404)], color, 30)


def template_export(draw: ImageDraw.ImageDraw, color: str) -> None:
    documents(draw, color)
    line(draw, [(256, 324), (256, 214)], color, 26)
    line(draw, [(206, 264), (256, 214), (306, 264)], color, 26)


def import_file(draw: ImageDraw.ImageDraw, color: str) -> None:
    documents(draw, color)
    line(draw, [(256, 206), (256, 326)], color, 26)
    line(draw, [(206, 276), (256, 326), (306, 276)], color, 26)


def export_file(draw: ImageDraw.ImageDraw, color: str) -> None:
    rounded(draw, (104, 112, 408, 400), 30, color, 24)
    line(draw, [(256, 318), (256, 188)], color, 28)
    line(draw, [(200, 244), (256, 188), (312, 244)], color, 28)
    line(draw, [(174, 342), (338, 342)], color, 24)


def package_split(draw: ImageDraw.ImageDraw, color: str) -> None:
    rounded(draw, (100, 148, 250, 318), 24, color, 22)
    rounded(draw, (286, 216, 432, 386), 24, color, 22)
    line(draw, [(250, 232), (286, 300)], color, 24)
    line(draw, [(176, 318), (176, 380), (286, 380)], color, 24)
    line(draw, [(150, 216), (200, 216)], color, 18)
    line(draw, [(326, 284), (382, 284)], color, 18)


def edit_quantity(draw: ImageDraw.ImageDraw, color: str) -> None:
    rounded(draw, (112, 108, 400, 404), 30, color, 24)
    line(draw, [(176, 200), (280, 200)], color, 22)
    line(draw, [(176, 260), (250, 260)], color, 22)
    line(draw, [(260, 334), (364, 230)], color, 28)
    line(draw, [(346, 212), (382, 248)], color, 24)


def create_background(name: str, size: tuple[int, int], dark: bool = False) -> dict[str, object]:
    width, height = size
    base = COLORS["dark_root"] if dark else COLORS["bg_root"]
    card = COLORS["dark_card"] if dark else COLORS["bg_card"]
    inset = COLORS["dark_inset"] if dark else COLORS["bg_inset"]
    line_color = "#28445F" if dark else "#D7E0EA"

    image = Image.new("RGBA", size, hex_to_rgba(base))
    draw = ImageDraw.Draw(image)

    for y in range(-80, height + 80, 96):
        draw.line([(0, y), (width, y + 160)], fill=hex_to_rgba(line_color, 42 if dark else 70), width=2)

    for x in range(-80, width + 80, 128):
        draw.line([(x, 0), (x + 180, height)], fill=hex_to_rgba(line_color, 28 if dark else 52), width=1)

    for i, (x, y, w, h) in enumerate([
        (72, 140, width - 144, 300),
        (96, 520, width - 192, 220),
        (72, height - 420, width - 144, 280),
    ]):
        overlay = Image.new("RGBA", size, (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        overlay_draw.rounded_rectangle(
            (x, y, x + w, y + h),
            radius=40,
            fill=hex_to_rgba(card if i != 1 else inset, 58 if dark else 118),
            outline=hex_to_rgba(line_color, 70 if dark else 120),
            width=2,
        )
        overlay = overlay.filter(ImageFilter.GaussianBlur(radius=0.2))
        image.alpha_composite(overlay)

    path = BG_DIR / f"{name}.png"
    image.convert("RGB").save(path)
    return {
        "name": name,
        "file": str(path.relative_to(ROOT)).replace("\\", "/"),
        "size": list(size),
        "background": "opaque",
        "mode": "dark" if dark else "light",
    }


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    BG_DIR.mkdir(parents=True, exist_ok=True)

    icons: list[dict[str, object]] = []
    icon_specs: list[tuple[str, str, Callable[[ImageDraw.ImageDraw, str], None], str]] = [
        ("icon_inbound_scan", COLORS["success"], inbound, "入库扫码"),
        ("icon_outbound_scan", COLORS["accent"], outbound, "出库扫码"),
        ("icon_document_management", COLORS["warning"], documents, "单据管理"),
        ("icon_inventory_count", "#C55B52", inventory, "盘点作业"),
        ("icon_material_binding", COLORS["cyan"], material_binding, "物料绑定"),
        ("icon_settings", COLORS["muted"], settings, "设置"),
        ("icon_warehouse", COLORS["primary"], warehouse, "仓库档案"),
        ("icon_scan_frame", COLORS["accent"], scan_frame, "扫码输入"),
        ("icon_order", COLORS["warning"], order, "订单"),
        ("icon_backup_cloud", COLORS["accent"], backup_cloud, "云端备份"),
        ("icon_sync_computer", COLORS["cyan"], sync_computer, "同步电脑"),
        ("icon_database_safe", COLORS["success"], database_safe, "数据库安全"),
        ("icon_success_state", COLORS["success"], success_state, "成功状态"),
        ("icon_warning_state", COLORS["warning"], warning_state, "警告状态"),
        ("icon_error_state", COLORS["error"], error_state, "错误状态"),
        ("icon_search", COLORS["primary"], search, "搜索"),
        ("icon_template_export", COLORS["muted"], template_export, "模板导出"),
        ("icon_import", COLORS["accent"], import_file, "导入"),
        ("icon_export", COLORS["muted"], export_file, "导出"),
        ("icon_package_split", COLORS["warning"], package_split, "拆包"),
        ("icon_edit_quantity", COLORS["primary"], edit_quantity, "编辑数量"),
    ]

    for name, color, drawer, description in icon_specs:
        item = save_icon(name, color, drawer)
        item["description"] = description
        icons.append(item)

    backgrounds = [
        create_background("bg_workbench_light", (1440, 2560), dark=False),
        create_background("bg_workbench_dark", (1440, 2560), dark=True),
        create_background("bg_scan_panel_light", (1080, 720), dark=False),
        create_background("bg_scan_panel_dark", (1080, 720), dark=True),
    ]

    manifest = {
        "assetSet": "ui-redesign",
        "generatedBy": "scripts/generate_ui_assets.py",
        "designLanguage": "reliable, clear, fast warehouse operations UI",
        "icons": icons,
        "backgrounds": backgrounds,
        "tokens": {
            "primary": COLORS["primary"],
            "accent": COLORS["accent"],
            "success": COLORS["success"],
            "warning": COLORS["warning"],
            "error": COLORS["error"],
            "cyan": COLORS["cyan"],
            "backgroundRoot": COLORS["bg_root"],
            "backgroundCard": COLORS["bg_card"],
        },
    }

    (ASSET_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Generated {len(icons)} icons and {len(backgrounds)} backgrounds in {ASSET_DIR}")


if __name__ == "__main__":
    main()
