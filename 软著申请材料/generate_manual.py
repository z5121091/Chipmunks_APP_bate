#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成软件著作权用户手册（带实际截图）"""

from docx import Document
from docx.shared import Inches, Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import os

OUTPUT = r"D:\Chipmunks_APP\软著申请材料\用户手册.docx"
SCREENSHOT_DIR = r"C:\Users\zx512\Desktop\软件操作界面"
HOME_SCREENSHOT = 'Screenshot_2026-09-23-21-56-48-485_com.chipmunks.traceability.jpg'

def add_page_field(paragraph):
    """在段落末尾插入PAGE域（自动页码）"""
    run = paragraph.add_run()
    fld_char1 = OxmlElement('w:fldChar')
    fld_char1.set(qn('w:fldCharType'), 'begin')
    instr_text = OxmlElement('w:instrText')
    instr_text.set(qn('xml:space'), 'preserve')
    instr_text.text = 'PAGE'
    fld_char2 = OxmlElement('w:fldChar')
    fld_char2.set(qn('w:fldCharType'), 'end')
    run._r.append(fld_char1)
    run._r.append(instr_text)
    run._r.append(fld_char2)

def add_header_footer(doc):
    """页眉：软件名称+版本号（左）、页码（右上角）；页脚：著作权人全称（居中）"""
    for section in doc.sections:
        # 封面（第一页）不显示页眉页码，目录页从第1页开始
        section.different_first_page_header_footer = True
        sectPr = section._sectPr
        pg_num_type = sectPr.find(qn('w:pgNumType'))
        if pg_num_type is None:
            pg_num_type = OxmlElement('w:pgNumType')
            sectPr.append(pg_num_type)
        pg_num_type.set(qn('w:start'), '0')

        # 页眉：左软件名+版本号，右页码
        header = section.header
        hp = header.paragraphs[0]
        hp.text = ''
        tab_stops = hp.paragraph_format.tab_stops
        tab_stops.add_tab_stop(Cm(14.66), WD_TAB_ALIGNMENT.RIGHT)
        run = hp.add_run('掌上仓库 V1.0')
        run.font.size = Pt(10)
        run.font.name = '宋体'
        run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
        run.font.color.rgb = RGBColor(0, 0, 0)
        run.underline = False
        hp.add_run('\t')
        run = hp.add_run('第 ')
        run.font.size = Pt(10)
        run.font.name = '宋体'
        run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
        add_page_field(hp)
        run = hp.add_run(' 页')
        run.font.size = Pt(10)
        run.font.name = '宋体'
        run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

        # 页脚：著作权人全称居中
        footer = section.footer
        fp = footer.paragraphs[0]
        fp.text = ''
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = fp.add_run('上海花栗鼠科技有限公司')
        run.font.size = Pt(10)
        run.font.name = '宋体'
        run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

        # 封面页眉页脚留空
        first_header = section.first_page_header
        first_header.paragraphs[0].text = ''
        first_footer = section.first_page_footer
        first_footer.paragraphs[0].text = ''

def add_cover(doc):
    for _ in range(4):
        doc.add_paragraph()
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run('掌上仓库')
    run.font.size = Pt(28)
    run.font.bold = True
    run.font.name = '宋体'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle.add_run('用户手册')
    run.font.size = Pt(22)
    run.font.name = '宋体'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

    for _ in range(3):
        doc.add_paragraph()

    version = doc.add_paragraph()
    version.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = version.add_run('版本号：V1.0')
    run.font.size = Pt(16)
    run.font.name = '宋体'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

    for _ in range(4):
        doc.add_paragraph()

    company = doc.add_paragraph()
    company.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = company.add_run('上海花栗鼠科技有限公司')
    run.font.size = Pt(16)
    run.font.name = '宋体'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

    date_p = doc.add_paragraph()
    date_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = date_p.add_run('2026年')
    run.font.size = Pt(14)
    run.font.name = '宋体'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    doc.add_page_break()

def add_toc(doc):
    h = doc.add_paragraph()
    h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = h.add_run('目  录')
    run.font.size = Pt(18)
    run.font.bold = True
    run.font.name = '宋体'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    # 目录项文字
    toc_items = [
        '1  软件概述',
        '    1.1  软件简介',
        '    1.2  运行环境',
        '    1.3  主要功能',
        '2  安装与启动',
        '    2.1  安装应用',
        '    2.2  首次配置',
        '3  功能详细说明',
        '    3.1  首页工作台',
        '    3.2  采购入库',
        '    3.3  出库扫描',
        '    3.4  出库订单',
        '    3.5  库存盘点',
        '    3.6  库存查询',
        '    3.7  物料绑定',
        '    3.8  单据管理',
        '    3.9  解析规则',
        '    3.10  系统设置',
        '4  常见问题',
    ]

    for item in toc_items:
        p = doc.add_paragraph()
        run = p.add_run(item)
        run.font.size = Pt(11)
        run.font.name = '宋体'
        run.font.color.rgb = RGBColor(0, 0, 0)
        run.underline = False
        run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

        p.paragraph_format.line_spacing = 1.15
        p.paragraph_format.space_after = Pt(1)

    doc.add_page_break()

def add_h1(doc, text):
    h = doc.add_paragraph()
    run = h.add_run(text)
    run.font.size = Pt(16)
    run.font.bold = True
    run.font.name = '宋体'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    h.paragraph_format.space_before = Pt(12)
    h.paragraph_format.space_after = Pt(6)
    h.paragraph_format.keep_with_next = True

def add_h2(doc, text):
    h = doc.add_paragraph()
    run = h.add_run(text)
    run.font.size = Pt(14)
    run.font.bold = True
    run.font.name = '宋体'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    h.paragraph_format.space_before = Pt(8)
    h.paragraph_format.space_after = Pt(4)
    h.paragraph_format.keep_with_next = True

def add_body(doc, text):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(12)
    run.font.name = '宋体'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    p.paragraph_format.first_line_indent = Pt(24)
    p.paragraph_format.line_spacing = 1.5

def add_screenshot(doc, filename, caption):
    if os.path.isabs(filename):
        img_path = filename
    else:
        img_path = os.path.join(SCREENSHOT_DIR, filename)
    if os.path.exists(img_path):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run()
        run.add_picture(img_path, width=Cm(6.5))
        p.paragraph_format.keep_with_next = True
        cap = doc.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = cap.add_run(caption)
        run.font.size = Pt(10)
        run.font.name = '宋体'
        run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    else:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(f'【截图待补：{caption}】')
        run.font.size = Pt(11)
        run.font.color.rgb = RGBColor(128, 128, 128)
    doc.add_paragraph()

def main():
    doc = Document()
    style = doc.styles['Normal']
    font = style.font
    font.name = '宋体'
    font.size = Pt(12)
    style.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

    for section in doc.sections:
        section.top_margin = Cm(2.54)
        section.bottom_margin = Cm(2.54)
        section.left_margin = Cm(3.17)
        section.right_margin = Cm(3.17)

    add_header_footer(doc)
    add_cover(doc)
    add_toc(doc)

    add_h1(doc, '1  软件概述')
    add_h2(doc, '1.1  软件简介')
    add_body(doc, '掌上仓库装在安卓手持PDA上，用来扫码入库、出库、盘点和查询库存，主要处理芯片、电子元件等物料。需要核对采购或销售单据时，软件通过网络查询畅捷通ERP。作业记录保存在PDA本地；电脑同步助手连接正常时，可以把入库、出库和盘点文件传到电脑。')
    add_body(doc, 'PDA扫码头负责读取二维码，软件收到扫码内容后，再按设置好的规则提取型号、生产日期等信息。同型号物料可以汇总数量；扫到重复标签时，软件会给出提示。')

    add_h2(doc, '1.2  运行环境')
    add_body(doc, '硬件：内置扫码头的安卓手持PDA，扫码头是设备自带的，不用另接扫码枪。')
    add_body(doc, '系统：Android 11.0及以上。')
    add_body(doc, '网络：查询畅捷通ERP需要网络连接。使用电脑同步助手时，PDA和电脑要在可以互相访问的同一网络内。')
    add_body(doc, '存储：作业记录保存在PDA本地。使用前请确认设备有足够的可用空间，并定期备份数据库。')

    add_h2(doc, '1.3  主要功能')
    add_body(doc, '（1）采购入库：扫采购入库单号，从畅捷通ERP拉出待入库单据，扫码入库，同型号自动累加。')
    add_body(doc, '（2）出库扫描：先扫出库单号关联订单，再扫物料码出库，物料码和订单码都能自动识别。')
    add_body(doc, '（3）出库订单：查询出库单及物料明细，客户名称和应发数量以ERP数据为准。')
    add_body(doc, '（4）库存盘点：选仓库后扫码盘点，数量不对可以手动改，盘完保存导出。')
    add_body(doc, '（5）库存查询：扫物料码查当前库存数量。')
    add_body(doc, '（6）物料绑定：维护扫码型号、版本号和畅捷通ERP存货编码的对应关系，供应商可按需要填写。')
    add_body(doc, '（7）单据管理：出库订单、入库记录、盘点记录统一查看和导出。')
    add_body(doc, '（8）解析规则：配置不同供应商二维码字符串的拆分规则。')
    add_body(doc, '（9）系统设置：仓库、畅捷通ERP对接、同步助手、扫码规则、备份恢复等。')

    add_h1(doc, '2  安装与启动')
    add_h2(doc, '2.1  安装应用')
    add_body(doc, '把APK安装包拷到PDA，在文件管理器里点开安装。如果设备提示不允许安装该来源的应用，按系统提示允许本次安装，再返回安装界面继续。安装完成后，从桌面打开掌上仓库。')

    add_h2(doc, '2.2  首次配置')
    add_body(doc, '第一次打开时，软件会提示先建立仓库。点“去建仓库”可以自己填写仓库信息；点“跳过并继续”，软件会先建立一个默认仓库，之后还能在仓库档案里修改。')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-56-23-780_com.chipmunks.traceability.jpg', '图2-1  首次启动引导')
    add_body(doc, '在仓库档案页点“新增仓库”，填写仓库名称和说明。常用仓库可以设为默认仓库。开始扫码前，仍要看一眼当前选中的仓库是否正确。')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-56-34-725_com.chipmunks.traceability.jpg', '图2-2  仓库档案')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-56-28-492_com.chipmunks.traceability.jpg', '图2-3  添加仓库')
    add_body(doc, '如果要使用采购入库、出库单查询或库存查询，请先到“设置 > ERP对接”检查所用账套是否就绪。需要把文件传到电脑时，再到“设置 > 同步助手”填写电脑地址并做连接测试。连接不上时，已保存的本地记录仍可在对应记录页面查看，稍后再重新同步。')

    add_h1(doc, '3  功能详细说明')

    add_h2(doc, '3.1  首页工作台')
    add_body(doc, '首页是工作台，扫码出库、采购入库、库存盘点和库存查询都从这里进入。底部可以切换“工作台”“单据”“设置”。作业卡片会显示当前任务；有待处理的采购单时，采购入库卡片会显示数量。')
    add_body(doc, '下方可以查看最近的单据。要找更早的记录，可到“单据”页面查看。')
    add_screenshot(doc, HOME_SCREENSHOT, '图3-1  首页工作台')

    add_h2(doc, '3.2  采购入库')
    add_body(doc, '采购入库页拉的是畅捷通ERP里待入库的单子。顶部显示当前账套、待入库单据数和上次同步时间，公司有多套账的话可以直接切换。')
    add_body(doc, '单据列表显示入库单号、供应商、日期、仓库和审核状态，点单据展开看明细。也可以直接扫入库单号，或者手动把单号输进去，一下就定位到。')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-57-37-582_com.chipmunks.traceability.jpg', '图3-2  采购入库页面')

    add_h2(doc, '3.3  出库扫描')
    add_body(doc, '出库扫码页用来扫物料出库。顶部显示账套、出库单号和客户。先扫销售出库单号，系统自动带出订单和客户信息，再扫物料码出库。')
    add_body(doc, '下面显示这一单已经扫了哪些型号、每种多少件、加起来一共多少件。没扫出库单之前会显示“等待出库单”，扫了单号之后才开始计件。')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-57-35-309_com.chipmunks.traceability.jpg', '图3-3  出库扫描等待页面')

    add_h2(doc, '3.4  出库订单')
    add_body(doc, '出库订单页可以按仓库和时间筛选订单，点开订单查看客户、物料、应发数量和追溯记录。客户名称和应发数量由ERP提供，PDA端只做查询，不在这里修改。')
    add_body(doc, '需要拆包或打印标签时，按实际业务流程进入相应操作。是否能直接打印，还要看电脑同步助手、模板和打印机是否正常。')

    add_h2(doc, '3.5  库存盘点')
    add_body(doc, '盘点前先在顶部把仓库选好，页面上会显示已经扫了多少条、一共多少件，还带着对应的畅捷通ERP仓库名，扫之前先确认仓库没选错。')
    add_body(doc, '扫物料码之后同型号自动累加，数量不对也可以手动改成实际盘点数。扫完保存，盘点记录可以导出。')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-57-41-694_com.chipmunks.traceability.jpg', '图3-4  库存盘点')

    add_h2(doc, '3.6  库存查询')
    add_body(doc, '库存查询用来查看物料当前库存。先确认账套，再扫描物料码；手边没有标签时，也可以在输入框里填写型号或存货编码后查询。查询失败时先检查网络和ERP连接状态。')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-57-43-736_com.chipmunks.traceability.jpg', '图3-5  库存查询等待页面')

    add_h2(doc, '3.7  物料绑定')
    add_body(doc, '物料绑定维护的是扫码型号、版本号和畅捷通ERP存货编码之间的对应关系。配好之后，扫码结果可以直接匹配ERP存货编码。供应商不参与存货匹配，主要用于选择拆包标签模板。')
    add_body(doc, '可以按型号、编码或供应商搜索。点“新增”后填写扫码型号和畅捷通ERP存货编码，这两项必填；版本号、供应商和说明按实际情况填写。也支持用Excel批量导入导出。')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-56-41-028_com.chipmunks.traceability.jpg', '图3-6  添加物料绑定')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-56-44-934_com.chipmunks.traceability.jpg', '图3-7  物料绑定数据工具')

    add_h2(doc, '3.8  单据管理')
    add_body(doc, '单据管理有三个入口，查历史单据都从这进：')
    add_body(doc, '出库订单：查询ERP订单和物料明细，处理拆包并查看追溯记录。客户名称和应发数量由ERP提供，PDA端不修改。')
    add_body(doc, '入库记录：按仓库查入库单，可以查看明细和重新同步。')
    add_body(doc, '盘点记录：按仓库查盘点单，可以查看明细和重新同步。删除本地记录前，先确认相关文件是否已经发到电脑或用于后续作业。')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-56-52-708_com.chipmunks.traceability.jpg', '图3-8  单据管理')

    add_h2(doc, '3.9  解析规则')
    add_body(doc, '不同供应商的二维码格式不一样，解析规则就是告诉软件：这个码按什么符号拆开，拆出来的哪一段算型号。注意图像解码是扫码头硬件做的，软件只管拆解码出来的字符串。')
    add_body(doc, '列表里每条规则显示名称、分隔符、字段段数和顺序，开关可以启用或停用。新增规则的时候填名称，也可以直接粘贴一段扫码样本让它自动识别，高级设置里能配结束符、字段前缀和识别条件。')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-57-01-715_com.chipmunks.traceability.jpg', '图3-9  设置中的扫码规则入口')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-57-05-326_com.chipmunks.traceability.jpg', '图3-10  添加解析规则')
    add_body(doc, '需要去掉二维码里的固定文字时，可以在“字段前缀”中维护。进入字段前缀配置后，选择对应规则，再按实际二维码内容设置要去掉的前缀。')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-57-08-451_com.chipmunks.traceability.jpg', '图3-11  字段前缀配置')
    add_body(doc, '出库单号规则按仓库保存订单号样例。扫码命中样例结构后，软件会自动切换到绑定的仓库。第一次设置时，进入对应仓库并填写一个真实的出库单号样例。')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-57-10-724_com.chipmunks.traceability.jpg', '图3-12  出库单号规则')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-57-15-171_com.chipmunks.traceability.jpg', '图3-13  编辑出库单号样例')

    add_h2(doc, '3.10  系统设置')
    add_body(doc, '设置页主要有这些：')
    add_body(doc, '作业与物料：仓库管理、物料对应关系和操作提示音。提示音开关控制扫码、确认、取消、删除等操作反馈。')
    add_body(doc, '畅捷通ERP对接：配畅捷通ERP连接，显示已就绪的账套数。')
    add_body(doc, '同步助手：配局域网同步助手的地址，入库、出库、盘点数据通过它传到电脑。')
    add_body(doc, '扫码规则：条码规则、字段、前缀、出库单号规则。')
    add_body(doc, '自定义字段：按需要给物料和单据加字段。')
    add_body(doc, '备份与恢复：备份和还原本地数据库。')
    add_body(doc, '版本更新：在“关于掌上仓库”中查看当前版本并检查更新。')
    add_body(doc, '关于掌上仓库：查看软件名称、版本号、公司、作者、备案号、隐私政策、使用说明和更新日志。')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-52-04-087_com.chipmunks.traceability.jpg', '图3-14  系统设置')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-56-58-079_com.chipmunks.traceability.jpg', '图3-15  同步助手设置')
    add_screenshot(doc, 'Screenshot_2026-09-23-21-57-29-920_com.chipmunks.traceability.jpg', '图3-16  关于掌上仓库与版本信息')

    add_h1(doc, '4  常见问题')

    add_h2(doc, '4.1  扫出来的型号不对怎么办？')
    add_body(doc, '一般是这个供应商的码和解析规则没对上。去设置里找到对应规则，核对一下分隔符和字段顺序，跟实际码里的位置对不对，改完重扫就行。如果供应商换了码的格式，直接新加一条规则，别去改旧的，免得老库存的码也跟着解析乱。')

    add_h2(doc, '4.2  数据存在PDA里会不会丢？')
    add_body(doc, '数据保存在PDA本地，但设备损坏、误删或恢复出厂设置都可能造成丢失。换机或重置前，先在设置里做数据库备份，并确认备份文件已经保存好；在新设备上恢复后，再打开软件核对记录。电脑同步的Excel文件方便查单，但不能代替完整的数据库备份。')

    add_h2(doc, '4.3  怎么切换仓库？')
    add_body(doc, '入库、出库、盘点页面都有仓库选择，点当前仓库就能切换。默认仓库可以在仓库管理里设置。每次扫码前都看一眼页面上的仓库名称，免得把记录存到别的仓库。')

    add_h2(doc, '4.4  导出的Excel在哪？')
    add_body(doc, '入库、出库、盘点文件通过同步助手传到电脑后，以电脑端实际设置的保存目录为准；可以按文件名或时间查找。物料绑定的Excel导出走PDA的系统分享窗口，保存位置取决于你在分享窗口选择的应用或目录。')

    add_h2(doc, '4.5  同步助手连不上怎么办？')
    add_body(doc, '先看电脑同步助手有没有启动，再核对PDA里填写的电脑IP和端口。确认两台设备在可以互相访问的网络内，并检查电脑防火墙是否拦住了同步助手。连接恢复后，可在设置或对应单据里重新同步；如果还是失败，记下页面提示的信息再排查。')

    doc.save(OUTPUT)
    print(f"用户手册已生成: {OUTPUT}")

if __name__ == '__main__':
    main()

