#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成软件著作权源程序鉴别材料（前后各连续30页，共60页）。"""

import os
import re
import argparse
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.units import mm

# 注册中文字体
FONT_PATHS = [
    r"C:\Windows\Fonts\simsun.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = str(Path(__file__).resolve().parent / "掌上仓库V1.0_源程序鉴别材料.pdf")
SOFTWARE_NAME = "掌上仓库 V1.0"
LINES_PER_PAGE = 50
TOTAL_PAGES = 60
EXCLUDED_PARTS = {
    "node_modules", "heroui", "android", "dist", "build", "scripts",
    "__tests__", "vendor", ".expo", "logs",
}
SECRET_PATTERNS = {
    "私钥块": re.compile(r"BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY"),
    "含账号密码的 URL": re.compile(r"https?://[^\s/]+:[^\s/@]+@", re.I),
    "疑似 JWT": re.compile(r"eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}"),
    "写在代码里的密钥或口令": re.compile(
        r"(?:app_?secret|client_?secret|api_?key|backend_?access_?key|open_?token|refresh_?token|private_?key|password)\s*[:=]\s*['\"][^'\"]{8,}['\"]",
        re.I,
    ),
}
THIRD_PARTY_NOTICE = re.compile(
    r"SPDX-License-Identifier|Copyright\s+\(c\)|Licensed\s+under\s+the|"
    r"GNU\s+(?:General|Lesser)\s+Public\s+License|Apache\s+License|MIT\s+License",
    re.I,
)

def register_font():
    for fp in FONT_PATHS:
        if os.path.exists(fp):
            try:
                pdfmetrics.registerFont(TTFont('SimSun', fp))
                return 'SimSun'
            except:
                continue
    return 'Courier'

def collect_source_files():
    """收集需要提交的源代码文件列表（按重要性排序）"""
    files = [
        # 入口与路由
        (r"client\app\_layout.tsx", "app/_layout.tsx"),
        (r"client\app\index.tsx", "app/index.tsx"),
        # 核心页面
        (r"client\screens\home\index.tsx", "screens/home/index.tsx"),
        (r"client\screens\inbound\index.tsx", "screens/inbound/index.tsx"),
        (r"client\screens\outbound\index.tsx", "screens/outbound/index.tsx"),
        (r"client\screens\orders\index.tsx", "screens/orders/index.tsx"),
        (r"client\screens\inventory\index.tsx", "screens/inventory/index.tsx"),
        (r"client\screens\settings\index.tsx", "screens/settings/index.tsx"),
        (r"client\screens\stock-query\index.tsx", "screens/stock-query/index.tsx"),
        (r"client\screens\document-management\index.tsx", "screens/document-management/index.tsx"),
        (r"client\screens\inbound-records\index.tsx", "screens/inbound-records/index.tsx"),
        (r"client\screens\inventory-records\index.tsx", "screens/inventory-records/index.tsx"),
        (r"client\screens\warehouse-management\index.tsx", "screens/warehouse-management/index.tsx"),
        (r"client\screens\rules\index.tsx", "screens/rules/index.tsx"),
        (r"client\screens\purchase-receive\index.tsx", "screens/purchase-receive/index.tsx"),
        # 核心工具
        (r"client\utils\database.ts", "utils/database.ts"),
        (r"client\utils\qrcodeParser.ts", "utils/qrcodeParser.ts"),
        (r"client\utils\scannerInput.ts", "utils/scannerInput.ts"),
        (r"client\utils\scanQueue.ts", "utils/scanQueue.ts"),
        (r"client\utils\inboundRecords.ts", "utils/inboundRecords.ts"),
        (r"client\utils\outboundOrderRule.ts", "utils/outboundOrderRule.ts"),
        (r"client\utils\inventoryReconciliation.ts", "utils/inventoryReconciliation.ts"),
        (r"client\utils\unpackWorkflow.ts", "utils/unpackWorkflow.ts"),
        (r"client\utils\unpackRecords.ts", "utils/unpackRecords.ts"),
        (r"client\utils\excel.ts", "utils/excel.ts"),
        (r"client\utils\inboundExport.ts", "utils/inboundExport.ts"),
        (r"client\utils\outboundExport.ts", "utils/outboundExport.ts"),
        (r"client\utils\inventoryExport.ts", "utils/inventoryExport.ts"),
        (r"client\utils\labelExport.ts", "utils/labelExport.ts"),
        (r"client\utils\feedback.ts", "utils/feedback.ts"),
        (r"client\utils\update.ts", "utils/update.ts"),
        (r"client\utils\nasBackup.ts", "utils/nasBackup.ts"),
        (r"client\utils\autoNasBackup.ts", "utils/autoNasBackup.ts"),
        (r"client\utils\backendApi.ts", "utils/backendApi.ts"),
        (r"client\utils\erpAccounts.ts", "utils/erpAccounts.ts"),
        (r"client\utils\erpCurrentStock.ts", "utils/erpCurrentStock.ts"),
        (r"client\utils\erpPurchaseReceive.ts", "utils/erpPurchaseReceive.ts"),
        (r"client\utils\erpSaleDispatch.ts", "utils/erpSaleDispatch.ts"),
        (r"client\utils\ruleConditions.ts", "utils/ruleConditions.ts"),
        (r"client\utils\ruleConflictDiagnosis.ts", "utils/ruleConflictDiagnosis.ts"),
        (r"client\utils\ruleTerminator.ts", "utils/ruleTerminator.ts"),
        (r"client\utils\legacyRuleFields.ts", "utils/legacyRuleFields.ts"),
        (r"client\utils\outboundProgress.ts", "utils/outboundProgress.ts"),
        (r"client\utils\quantity.ts", "utils/quantity.ts"),
        (r"client\utils\time.ts", "utils/time.ts"),
        (r"client\utils\logger.ts", "utils/logger.ts"),
        (r"client\utils\colors.ts", "utils/colors.ts"),
        # 组件
        (r"client\components\Screen.tsx", "components/Screen.tsx"),
        (r"client\components\WarehouseScanInput.tsx", "components/WarehouseScanInput.tsx"),
        (r"client\components\WarehouseGuide.tsx", "components/WarehouseGuide.tsx"),
        (r"client\components\AggregatedRecordItem.tsx", "components/AggregatedRecordItem.tsx"),
        (r"client\components\AnimatedCard.tsx", "components/AnimatedCard.tsx"),
        (r"client\components\AnimatedButton.tsx", "components/AnimatedButton.tsx"),
        (r"client\components\AppModalCard.tsx", "components/AppModalCard.tsx"),
        (r"client\components\AppPillToast.tsx", "components/AppPillToast.tsx"),
        (r"client\components\CustomAlert.tsx", "components/CustomAlert.tsx"),
        # Hooks
        (r"client\hooks\useColorScheme.tsx", "hooks/useColorScheme.tsx"),
        (r"client\hooks\useTheme.ts", "hooks/useTheme.ts"),
        (r"client\hooks\useSafeRouter.ts", "hooks/useSafeRouter.ts"),
        # 后端
        (r"server\src\index.ts", "server/index.ts"),
        (r"server\src\erp.ts", "server/erp.ts"),
        (r"server\src\erpProxy.ts", "server/erpProxy.ts"),
        (r"server\src\erpHttp.ts", "server/erpHttp.ts"),
        (r"server\src\erpAccounts.ts", "server/erpAccounts.ts"),
        (r"server\src\release.ts", "server/release.ts"),
    ]

    all_lines = []
    for rel_path, display_name in files:
        full = (PROJECT_ROOT / rel_path).resolve()
        relative = full.relative_to(PROJECT_ROOT)
        if not relative.parts or relative.parts[0] not in {"client", "server"}:
            raise ValueError(f"非应用源码路径: {relative}")
        if any(part.casefold() in EXCLUDED_PARTS for part in relative.parts):
            raise ValueError(f"第三方或生成目录不得纳入申报源码: {relative}")
        if full.suffix not in {".ts", ".tsx"}:
            raise ValueError(f"非 TypeScript 源文件: {relative}")
        if not full.is_file():
            raise FileNotFoundError(f"申报源码清单中的文件不存在: {relative}")
        all_lines.append(f"// ===== File: {display_name} =====")
        with full.open('r', encoding='utf-8') as f:
            for line_number, line in enumerate(f, 1):
                for kind, pattern in SECRET_PATTERNS.items():
                    if pattern.search(line):
                        raise ValueError(f"申报源码疑似含有{kind}：{relative}:{line_number}；请核实后再生成")
                if THIRD_PARTY_NOTICE.search(line):
                    raise ValueError(f"申报源码疑似含第三方许可声明：{relative}:{line_number}；不得纳入自有源码材料")
                # 旧版会把长行改写成省略号；保留原文，排版时再检查溢出。
                source_line = line.rstrip('\r\n')
                if source_line.strip():
                    all_lines.append(source_line)
    return all_lines

def wrap_source_line(line, font_name, font_size, max_width):
    """仅在 PDF 中折行，保留源码的全部原始字符。"""
    if not line:
        return [line]
    wrapped = []
    remaining = line
    while remaining:
        if pdfmetrics.stringWidth(remaining, font_name, font_size) <= max_width:
            wrapped.append(remaining)
            break
        low, high = 1, len(remaining)
        while low < high:
            middle = (low + high + 1) // 2
            if pdfmetrics.stringWidth(remaining[:middle], font_name, font_size) <= max_width:
                low = middle
            else:
                high = middle - 1
        wrapped.append(remaining[:low])
        remaining = remaining[low:]
    return wrapped

def generate_pdf(all_lines):
    font_name = register_font()
    width, height = A4

    left_margin = 20 * mm
    right_margin = 20 * mm
    top_margin = 25 * mm
    bottom_margin = 20 * mm

    content_width = width - left_margin - right_margin
    line_height = 9.2
    display_lines = []
    for line in all_lines:
        display_lines.extend(wrap_source_line(line, font_name, 8, content_width))

    total_needed = TOTAL_PAGES * LINES_PER_PAGE
    if len(display_lines) < total_needed:
        raise ValueError(f"展示行数只有 {len(display_lines)}，不足 60 页；不得补空白行凑页数")

    # 取前30页和后30页
    first_part = display_lines[:30 * LINES_PER_PAGE]
    last_part = display_lines[-30 * LINES_PER_PAGE:]

    selected_lines = first_part + last_part
    c = canvas.Canvas(OUTPUT, pagesize=A4)

    page_num = 0
    for i, line in enumerate(selected_lines):
        line_in_page = i % LINES_PER_PAGE
        page = i // LINES_PER_PAGE

        if line_in_page == 0:
            if i > 0:
                c.showPage()
            page_num += 1

            # 页眉：软件名称在左，连续页号在右。
            c.setFont(font_name, 9)
            c.drawString(left_margin, height - 15 * mm, SOFTWARE_NAME)
            c.drawRightString(width - right_margin, height - 15 * mm, f"第 {page_num} 页")
            # 页眉线
            c.line(left_margin, height - 17 * mm, width - right_margin, height - 17 * mm)

        # 代码行
        c.setFont(font_name, 8)
        y = height - top_margin - line_in_page * line_height
        c.drawString(left_margin, y, line)

    c.save()
    print(f"源代码PDF已生成: {OUTPUT}")
    print(f"源码行数: {len(all_lines)}, 排版行数: {len(display_lines)}, 选取行数: {len(selected_lines)}, 页数: {page_num}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='核对软著源码清单；定稿后才生成 PDF')
    parser.add_argument('--write-pdf', action='store_true', help='按当前源码生成提交前核对稿')
    args = parser.parse_args()
    lines = collect_source_files()
    if args.write_pdf:
        generate_pdf(lines)
    else:
        print(f'预检查通过：{len(lines)} 行源码。尚未生成 PDF；定稿后使用 --write-pdf。')
