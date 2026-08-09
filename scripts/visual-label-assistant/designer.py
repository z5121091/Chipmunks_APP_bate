from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Any, Callable

from print_engine import (
    get_barcode_native_dimensions,
    get_code128_pattern,
    get_installed_printer_names,
    get_label_dimensions,
    get_qr_native_dimensions,
    print_template,
    render_preview,
)
from template_model import (
    BUILTIN_FIELDS,
    TemplateStore,
    build_qr_content,
    get_template_sample_record,
    make_element_id,
    make_template_id,
    normalize_text,
    resolve_content,
    validate_template,
)


def _qt():
    try:
        from PySide6 import QtCore, QtGui, QtWidgets
    except ImportError as error:
        raise RuntimeError('缺少 PySide6，请先运行：pip install PySide6') from error
    return QtCore, QtGui, QtWidgets


QtCore, QtGui, QtWidgets = _qt()


def awesome_icon(name: str, color: str = '#475467'):
    try:
        import qtawesome as qta

        return qta.icon(name, color=color)
    except Exception:
        return QtGui.QIcon()


def pil_to_pixmap(image):
    rgba = image.convert('RGBA')
    data = rgba.tobytes('raw', 'RGBA')
    qimage = QtGui.QImage(data, rgba.width, rgba.height, QtGui.QImage.Format_RGBA8888)
    return QtGui.QPixmap.fromImage(qimage.copy())


class ElementBox(QtWidgets.QGraphicsRectItem):
    HANDLE_PIXELS = 12.0
    MIN_SIZE = 8.0
    HANDLE_CURSORS = {
        'top_left': QtCore.Qt.SizeFDiagCursor,
        'top': QtCore.Qt.SizeVerCursor,
        'top_right': QtCore.Qt.SizeBDiagCursor,
        'right': QtCore.Qt.SizeHorCursor,
        'bottom_right': QtCore.Qt.SizeFDiagCursor,
        'bottom': QtCore.Qt.SizeVerCursor,
        'bottom_left': QtCore.Qt.SizeBDiagCursor,
        'left': QtCore.Qt.SizeHorCursor,
    }

    def __init__(self, element: dict[str, Any], changed: Callable[[], None]):
        super().__init__(0, 0, float(element['width']), float(element['height']))
        self.element = element
        self.changed = changed
        self.active_handle: str | None = None
        self.hovered = False
        self.resize_start_scene = QtCore.QPointF()
        self.resize_start_geometry = (0.0, 0.0, 0.0, 0.0)
        self.press_geometry = (0.0, 0.0, 0.0, 0.0)
        self.visual_item = QtWidgets.QGraphicsPixmapItem(self)
        self.visual_item.setAcceptedMouseButtons(QtCore.Qt.NoButton)
        self.visual_item.setZValue(-1)
        self.setPos(float(element['x']), float(element['y']))
        self.setFlags(
            QtWidgets.QGraphicsItem.ItemIsMovable
            | QtWidgets.QGraphicsItem.ItemIsSelectable
            | QtWidgets.QGraphicsItem.ItemSendsGeometryChanges
        )
        self.setAcceptHoverEvents(True)
        self.setZValue(20)

    def set_visual(self, pixmap) -> None:
        self.visual_item.setPixmap(pixmap)
        self._fit_visual_to_rect()

    def _fit_visual_to_rect(self) -> None:
        pixmap = self.visual_item.pixmap()
        if pixmap.isNull():
            return
        self.visual_item.setTransform(QtGui.QTransform())
        self.visual_item.setScale(1.0)
        transform = QtGui.QTransform()
        transform.scale(
            self.rect().width() / max(1, pixmap.width()),
            self.rect().height() / max(1, pixmap.height()),
        )
        self.visual_item.setTransform(transform)

    def boundingRect(self):
        margin = 30.0
        return self.rect().adjusted(-margin, -margin, margin, margin)

    def _handle_size(self) -> float:
        views = self.scene().views() if self.scene() else []
        scale = abs(views[0].transform().m11()) if views else 1.0
        return self.HANDLE_PIXELS / max(0.25, scale)

    def _handle_rects(self) -> dict[str, Any]:
        rect = self.rect()
        handle_size = self._handle_size()
        half = handle_size / 2
        points = {
            'top_left': rect.topLeft(),
            'top': QtCore.QPointF(rect.center().x(), rect.top()),
            'top_right': rect.topRight(),
            'right': QtCore.QPointF(rect.right(), rect.center().y()),
            'bottom_right': rect.bottomRight(),
            'bottom': QtCore.QPointF(rect.center().x(), rect.bottom()),
            'bottom_left': rect.bottomLeft(),
            'left': QtCore.QPointF(rect.left(), rect.center().y()),
        }
        return {
            name: QtCore.QRectF(point.x() - half, point.y() - half, handle_size, handle_size)
            for name, point in points.items()
        }

    def _handle_at(self, point) -> str | None:
        if not self.isSelected():
            return None
        for name, rect in self._handle_rects().items():
            if rect.contains(point):
                return name
        return None

    def paint(self, painter, option, widget=None):
        if self.isSelected():
            painter.setBrush(QtCore.Qt.NoBrush)
            outline_pen = QtGui.QPen(QtGui.QColor('#1677ff'), 1.5)
            outline_pen.setCosmetic(True)
            painter.setPen(outline_pen)
            painter.drawRect(self.rect())
            painter.setBrush(QtGui.QBrush(QtGui.QColor('#ffffff')))
            for handle_rect in self._handle_rects().values():
                painter.drawRect(handle_rect)
        elif self.hovered:
            painter.setBrush(QtCore.Qt.NoBrush)
            hover_pen = QtGui.QPen(QtGui.QColor('#98a2b3'), 1, QtCore.Qt.DotLine)
            hover_pen.setCosmetic(True)
            painter.setPen(hover_pen)
            painter.drawRect(self.rect())

    def hoverEnterEvent(self, event):
        self.hovered = True
        self.update()
        super().hoverEnterEvent(event)

    def hoverMoveEvent(self, event):
        handle = self._handle_at(event.pos())
        self.setCursor(self.HANDLE_CURSORS.get(handle, QtCore.Qt.SizeAllCursor))
        super().hoverMoveEvent(event)

    def hoverLeaveEvent(self, event):
        self.hovered = False
        self.unsetCursor()
        self.update()
        super().hoverLeaveEvent(event)

    def mousePressEvent(self, event):
        self.press_geometry = (
            self.pos().x(), self.pos().y(), self.rect().width(), self.rect().height()
        )
        self.active_handle = self._handle_at(event.pos())
        if self.active_handle:
            self.resize_start_scene = event.scenePos()
            self.resize_start_geometry = (
                self.pos().x(), self.pos().y(), self.rect().width(), self.rect().height()
            )
            event.accept()
            return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self.active_handle:
            start_x, start_y, start_width, start_height = self.resize_start_geometry
            delta = event.scenePos() - self.resize_start_scene
            left, top = start_x, start_y
            right, bottom = start_x + start_width, start_y + start_height
            handle = self.active_handle
            if 'left' in handle:
                left = min(max(0.0, start_x + delta.x()), right - self.MIN_SIZE)
            if 'right' in handle:
                right = max(left + self.MIN_SIZE, start_x + start_width + delta.x())
            if handle == 'top' or 'top_' in handle:
                top = min(max(0.0, start_y + delta.y()), bottom - self.MIN_SIZE)
            if handle == 'bottom' or 'bottom_' in handle:
                bottom = max(top + self.MIN_SIZE, start_y + start_height + delta.y())
            if self.element.get('type') == 'qrcode':
                if handle in {'left', 'right'}:
                    side = right - left
                elif handle in {'top', 'bottom'}:
                    side = bottom - top
                else:
                    side = max(right - left, bottom - top)
                if 'left' in handle:
                    side = min(side, right)
                if handle == 'top' or 'top_' in handle:
                    side = min(side, bottom)
                if 'left' in handle:
                    left = right - side
                else:
                    right = left + side
                if handle == 'top' or 'top_' in handle:
                    top = bottom - side
                else:
                    bottom = top + side
            self.prepareGeometryChange()
            self.setPos(left, top)
            self.setRect(0, 0, right - left, bottom - top)
            self._fit_visual_to_rect()
            self.element.update(
                x=round(left), y=round(top), width=round(right - left), height=round(bottom - top)
            )
            event.accept()
            return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        if self.active_handle:
            self.active_handle = None
            geometry = (self.pos().x(), self.pos().y(), self.rect().width(), self.rect().height())
            if geometry != self.press_geometry:
                self.changed()
            event.accept()
            return
        super().mouseReleaseEvent(event)
        geometry = (self.pos().x(), self.pos().y(), self.rect().width(), self.rect().height())
        if geometry != self.press_geometry:
            self.changed()

    def itemChange(self, change, value):
        if change == QtWidgets.QGraphicsItem.ItemPositionChange:
            return QtCore.QPointF(max(0.0, value.x()), max(0.0, value.y()))
        if change == QtWidgets.QGraphicsItem.ItemPositionHasChanged:
            self.element['x'] = round(value.x())
            self.element['y'] = round(value.y())
        return super().itemChange(change, value)


class CanvasView(QtWidgets.QGraphicsView):
    def wheelEvent(self, event):
        factor = 1.12 if event.angleDelta().y() > 0 else 1 / 1.12
        self.scale(factor, factor)
        event.accept()


class DesignerWindow(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.store = TemplateStore()
        self.settings = QtCore.QSettings('PalmWarehouse', 'VisualLabelAssistant')
        self.template = self.store.load_active()
        self.dirty = False
        self.current_element: dict[str, Any] | None = None
        self.overlay_items: dict[str, ElementBox] = {}
        self.refresh_pending = False
        self.refresh_rebuild_required = False
        self.refresh_timer = QtCore.QTimer(self)
        self.refresh_timer.setSingleShot(True)
        self.refresh_timer.timeout.connect(self._do_refresh_preview)
        self.preview_fit_timer = QtCore.QTimer(self)
        self.preview_fit_timer.setSingleShot(True)
        self.preview_fit_timer.timeout.connect(self.fit_preview)
        self.loading_controls = False
        self.setWindowTitle('掌上仓库 - 可视化标签助手[*]')
        self.resize(1420, 860)
        self.setMinimumSize(1100, 700)
        self._apply_style()
        self._build_ui()
        self._install_shortcuts()
        self._load_template(self.template)
        geometry = self.settings.value('windowGeometry')
        if isinstance(geometry, QtCore.QByteArray):
            self.restoreGeometry(geometry)
        splitter_state = self.settings.value('splitterState')
        if isinstance(splitter_state, QtCore.QByteArray):
            self.main_splitter.restoreState(splitter_state)

    def _apply_style(self):
        self.setStyleSheet(
            """
            QMainWindow { background: #f3f5f8; }
            QWidget { color: #1d2939; font-family: "Microsoft YaHei UI"; font-size: 13px; }
            QFrame#commandBar { background: #ffffff; border: 1px solid #e4e7ec; border-radius: 8px; }
            QLabel#pageTitle { font-size: 20px; font-weight: 700; color: #101828; }
            QGroupBox {
                background: #ffffff; border: 1px solid #e4e7ec; border-radius: 8px;
                margin-top: 13px; padding: 12px 10px 10px 10px; font-weight: 600;
            }
            QGroupBox::title { subcontrol-origin: margin; left: 12px; padding: 0 5px; color: #344054; }
            QLineEdit, QComboBox, QSpinBox, QDoubleSpinBox, QFontComboBox, QPlainTextEdit {
                min-height: 32px; background: #ffffff; border: 1px solid #d0d5dd;
                border-radius: 6px; padding: 2px 9px; selection-background-color: #1570ef;
            }
            QLineEdit:focus, QComboBox:focus, QSpinBox:focus, QDoubleSpinBox:focus,
            QFontComboBox:focus, QPlainTextEdit:focus { border: 1px solid #1570ef; }
            QLineEdit:hover, QComboBox:hover, QSpinBox:hover, QDoubleSpinBox:hover,
            QFontComboBox:hover, QPlainTextEdit:hover { border-color: #98a2b3; }
            QLineEdit:disabled, QComboBox:disabled, QSpinBox:disabled, QDoubleSpinBox:disabled,
            QFontComboBox:disabled, QPlainTextEdit:disabled {
                background: #f2f4f7; border-color: #eaecf0; color: #98a2b3;
            }
            QComboBox { padding-right: 34px; }
            QComboBox::drop-down {
                subcontrol-origin: padding; subcontrol-position: top right; width: 30px;
                border: 0; border-left: 1px solid #eaecf0; background: #f9fafb;
                border-top-right-radius: 6px; border-bottom-right-radius: 6px;
            }
            QComboBox::drop-down:hover { background: #f2f4f7; }
            QComboBox QAbstractItemView {
                background: #ffffff; border: 1px solid #d0d5dd; border-radius: 6px;
                padding: 4px; outline: 0; selection-background-color: #eaf2ff;
                selection-color: #175cd3;
            }
            QSpinBox, QDoubleSpinBox { padding-right: 26px; }
            QSpinBox::up-button, QDoubleSpinBox::up-button {
                subcontrol-origin: border; subcontrol-position: top right; width: 24px;
                background: #f9fafb; border: 0; border-left: 1px solid #eaecf0;
                border-top-right-radius: 6px;
            }
            QSpinBox::down-button, QDoubleSpinBox::down-button {
                subcontrol-origin: border; subcontrol-position: bottom right; width: 24px;
                background: #f9fafb; border: 0; border-left: 1px solid #eaecf0;
                border-bottom-right-radius: 6px;
            }
            QSpinBox::up-button:hover, QSpinBox::down-button:hover,
            QDoubleSpinBox::up-button:hover, QDoubleSpinBox::down-button:hover { background: #eef2f6; }
            QPushButton, QToolButton {
                min-height: 32px; background: #ffffff; border: 1px solid #d0d5dd;
                border-radius: 6px; padding: 2px 11px; color: #344054; font-weight: 500;
            }
            QPushButton:hover, QToolButton:hover { background: #f2f4f7; border-color: #98a2b3; }
            QPushButton:pressed, QToolButton:pressed { background: #e4e7ec; }
            QPushButton[primary="true"] { background: #1570ef; border-color: #1570ef; color: #ffffff; font-weight: 600; }
            QPushButton[primary="true"]:hover { background: #175cd3; }
            QPushButton[danger="true"] { color: #b42318; }
            QPushButton[danger="true"]:hover { background: #fff1f0; border-color: #fda29b; }
            QPushButton[elementTool="true"] {
                background: #f9fafb; border-color: #e4e7ec; padding: 3px 10px;
            }
            QPushButton[elementTool="true"]:hover { background: #eef4ff; border-color: #84adff; color: #175cd3; }
            QListWidget {
                background: #ffffff; border: 1px solid #e4e7ec; border-radius: 6px;
                padding: 4px; outline: 0;
            }
            QListWidget::item { min-height: 32px; border-radius: 5px; padding: 3px 8px; }
            QListWidget::item:hover { background: #f2f4f7; }
            QListWidget::item:selected { background: #eaf2ff; color: #175cd3; }
            QScrollArea { background: transparent; border: 0; }
            QScrollBar:vertical { background: transparent; width: 9px; margin: 2px; }
            QScrollBar::handle:vertical { background: #c5ccd6; border-radius: 3px; min-height: 28px; }
            QScrollBar::handle:vertical:hover { background: #98a2b3; }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
            QScrollBar:horizontal { background: transparent; height: 9px; margin: 2px; }
            QScrollBar::handle:horizontal { background: #c5ccd6; border-radius: 3px; min-width: 28px; }
            QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal { width: 0; }
            QSplitter::handle { background: transparent; width: 8px; }
            QStatusBar { background: #ffffff; border-top: 1px solid #e4e7ec; color: #667085; }
            QCheckBox { spacing: 7px; }
            QToolTip { background: #101828; color: #ffffff; border: 0; padding: 5px 7px; }
            """
        )

    def _build_ui(self):
        central = QtWidgets.QWidget()
        central.setObjectName('central')
        root = QtWidgets.QVBoxLayout(central)
        root.setContentsMargins(18, 14, 18, 14)
        root.setSpacing(12)

        title = QtWidgets.QLabel('标签模板编辑器')
        title.setObjectName('pageTitle')
        root.addWidget(title)

        toolbar_frame = QtWidgets.QFrame()
        toolbar_frame.setObjectName('commandBar')
        toolbar = QtWidgets.QHBoxLayout(toolbar_frame)
        toolbar.setContentsMargins(12, 10, 12, 10)
        toolbar.setSpacing(8)
        self.printer_combo = QtWidgets.QComboBox()
        self.printer_combo.addItems(get_installed_printer_names())
        for index in range(self.printer_combo.count()):
            self.printer_combo.setItemIcon(index, awesome_icon('fa5s.print', '#667085'))
        self.printer_combo.setMinimumWidth(170)
        saved_printer = normalize_text(self.settings.value('printerName', ''))
        saved_index = self.printer_combo.findText(saved_printer)
        if saved_index >= 0:
            self.printer_combo.setCurrentIndex(saved_index)
        self.printer_combo.currentTextChanged.connect(
            lambda value: self.settings.setValue('printerName', value)
        )
        self.template_combo = QtWidgets.QComboBox()
        self.template_combo.setMinimumWidth(210)
        self.template_combo.currentIndexChanged.connect(self._template_selected)
        toolbar.addWidget(QtWidgets.QLabel('打印机'))
        toolbar.addWidget(self.printer_combo, 1)
        toolbar.addSpacing(16)
        toolbar.addWidget(QtWidgets.QLabel('标签模板'))
        toolbar.addWidget(self.template_combo, 1)
        toolbar.addSpacing(10)
        for text, callback, icon_name, role in (
            ('新建', self.new_blank_template, 'fa5s.file', 'normal'),
            ('保存', self.save_template, 'fa5s.save', 'primary'),
            ('另存为', self.save_as, 'fa5s.file-export', 'normal'),
            ('打印测试', self.test_print, 'fa5s.print', 'normal'),
        ):
            button = QtWidgets.QPushButton(text)
            button.clicked.connect(callback)
            button.setIcon(awesome_icon(icon_name, '#ffffff' if role == 'primary' else ('#b42318' if role == 'danger' else '#475467')))
            button.setIconSize(QtCore.QSize(15, 15))
            if role == 'primary':
                button.setProperty('primary', True)
            if role == 'danger':
                button.setProperty('danger', True)
            toolbar.addWidget(button)
        more_button = QtWidgets.QToolButton()
        more_button.setText('更多')
        more_button.setIcon(awesome_icon('fa5s.ellipsis-h', '#475467'))
        more_button.setToolButtonStyle(QtCore.Qt.ToolButtonTextBesideIcon)
        more_button.setPopupMode(QtWidgets.QToolButton.InstantPopup)
        more_menu = QtWidgets.QMenu(more_button)
        for text, callback, icon_name in (
            ('导入模板', self.import_template, 'fa5s.file-import'),
            ('导出模板', self.export_template, 'fa5s.file-export'),
            ('删除当前模板', self.delete_template, 'fa5s.trash-alt'),
            ('恢复内置模板', self.restore_default, 'fa5s.undo-alt'),
        ):
            action = more_menu.addAction(awesome_icon(icon_name, '#475467'), text)
            action.triggered.connect(callback)
        more_button.setMenu(more_menu)
        toolbar.addWidget(more_button)
        root.addWidget(toolbar_frame)

        splitter = QtWidgets.QSplitter(QtCore.Qt.Horizontal)
        self.main_splitter = splitter
        editor_panel = self._build_editor_panel()
        editor_panel.setMinimumWidth(430)
        editor_panel.setMaximumWidth(570)
        splitter.addWidget(editor_panel)
        splitter.addWidget(self._build_preview_panel())
        splitter.setSizes([510, 870])
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)
        splitter.splitterMoved.connect(lambda _position, _index: self._schedule_preview_fit())
        root.addWidget(splitter, 1)
        self.setCentralWidget(central)
        self.statusBar().showMessage('可拖动元素，拖动右下角蓝色控制点调整大小')

    def _install_shortcuts(self):
        self.shortcuts = []
        for sequence, callback in (
            (QtGui.QKeySequence.Save, self.save_template),
            (QtGui.QKeySequence.Delete, self.remove_element),
            (QtGui.QKeySequence('Ctrl+D'), self.duplicate_element),
            (QtGui.QKeySequence('Ctrl+0'), self.fit_preview),
        ):
            shortcut = QtGui.QShortcut(sequence, self)
            shortcut.activated.connect(callback)
            self.shortcuts.append(shortcut)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._schedule_preview_fit()

    def _schedule_preview_fit(self):
        if hasattr(self, 'preview') and hasattr(self, 'scene'):
            self.preview_fit_timer.start(80)

    def _build_editor_panel(self):
        panel = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(panel)
        layout.setSizeConstraint(QtWidgets.QLayout.SetMinimumSize)
        layout.setContentsMargins(0, 0, 10, 0)

        paper = QtWidgets.QGroupBox('模板与纸张')
        paper_form = QtWidgets.QFormLayout(paper)
        paper_form.setLabelAlignment(QtCore.Qt.AlignRight | QtCore.Qt.AlignVCenter)
        paper_form.setHorizontalSpacing(12)
        paper_form.setVerticalSpacing(9)
        paper_form.setFieldGrowthPolicy(QtWidgets.QFormLayout.AllNonFixedFieldsGrow)
        self.template_name = QtWidgets.QLineEdit()
        self.template_name.setClearButtonEnabled(True)
        self.template_name.editingFinished.connect(self._paper_changed)
        self.paper_width = self._spin(10, 300, 100, 1, self._paper_changed)
        self.paper_height = self._spin(10, 300, 50, 1, self._paper_changed)
        self.paper_width.setSuffix(' mm')
        self.paper_height.setSuffix(' mm')
        self.paper_dpi = QtWidgets.QComboBox()
        self.paper_dpi.addItems(['203', '300', '600'])
        self.paper_dpi.currentTextChanged.connect(self._paper_changed)
        self.paper_copies = self._spin(1, 100, 2, 0, self._paper_changed)
        self.paper_copies.setSuffix(' 份')
        paper_form.addRow('模板名称', self.template_name)
        size_row = QtWidgets.QHBoxLayout()
        size_row.addWidget(self.paper_width)
        size_row.addWidget(QtWidgets.QLabel('x'))
        size_row.addWidget(self.paper_height)
        paper_form.addRow('纸张尺寸', size_row)
        paper_form.addRow('DPI', self.paper_dpi)
        paper_form.addRow('每条记录份数', self.paper_copies)
        layout.addWidget(paper)

        element_group = QtWidgets.QGroupBox('标签元素')
        element_layout = QtWidgets.QVBoxLayout(element_group)
        buttons = QtWidgets.QHBoxLayout()
        for text, kind, icon_name in (
            ('文字', 'text', 'fa5s.font'),
            ('条码', 'barcode', 'fa5s.barcode'),
            ('二维码', 'qrcode', 'fa5s.qrcode'),
            ('图片', 'image', 'fa5s.image'),
        ):
            button = QtWidgets.QPushButton(f'+ {text}')
            button.setProperty('elementTool', True)
            button.setIcon(awesome_icon(icon_name, '#475467'))
            button.setIconSize(QtCore.QSize(15, 15))
            button.clicked.connect(lambda _checked=False, value=kind: self.add_element(value))
            buttons.addWidget(button)
        remove_button = QtWidgets.QPushButton('删除元素')
        remove_button.setProperty('danger', True)
        remove_button.setIcon(awesome_icon('fa5s.trash-alt', '#b42318'))
        remove_button.setIconSize(QtCore.QSize(14, 14))
        remove_button.setText('')
        remove_button.setToolTip('删除当前元素')
        remove_button.setFixedWidth(38)
        remove_button.clicked.connect(self.remove_element)
        duplicate_button = QtWidgets.QPushButton()
        duplicate_button.setIcon(awesome_icon('fa5s.copy', '#475467'))
        duplicate_button.setIconSize(QtCore.QSize(14, 14))
        duplicate_button.setToolTip('复制当前元素（Ctrl+D）')
        duplicate_button.setFixedWidth(38)
        duplicate_button.clicked.connect(self.duplicate_element)
        buttons.addWidget(duplicate_button)
        buttons.addWidget(remove_button)
        element_layout.addLayout(buttons)
        self.element_list = QtWidgets.QListWidget()
        self.element_list.setFixedHeight(150)
        self.element_list.setSizePolicy(
            QtWidgets.QSizePolicy.Expanding,
            QtWidgets.QSizePolicy.Preferred,
        )
        self.element_list.currentRowChanged.connect(self._element_selected)
        element_layout.addWidget(self.element_list)
        layout.addWidget(element_group)

        self.property_group = QtWidgets.QGroupBox('元素属性')
        self.property_form = QtWidgets.QFormLayout(self.property_group)
        self.property_form.setLabelAlignment(QtCore.Qt.AlignRight | QtCore.Qt.AlignVCenter)
        self.property_form.setHorizontalSpacing(12)
        self.property_form.setVerticalSpacing(8)
        self.property_form.setFieldGrowthPolicy(QtWidgets.QFormLayout.AllNonFixedFieldsGrow)
        self.pos_x = self._spin(0, 10000, 0, 0, self._property_changed)
        self.pos_y = self._spin(0, 10000, 0, 0, self._property_changed)
        self.size_w = self._spin(1, 10000, 100, 0, self._property_changed)
        self.size_h = self._spin(1, 10000, 30, 0, self._property_changed)
        self.pos_x.setPrefix('X  ')
        self.pos_y.setPrefix('Y  ')
        self.size_w.setPrefix('W  ')
        self.size_h.setPrefix('H  ')
        self.content_mode = QtWidgets.QComboBox()
        self.content_mode.addItem(awesome_icon('fa5s.thumbtack', '#667085'), '固定内容', 'fixed')
        self.content_mode.addItem(awesome_icon('fa5s.link', '#667085'), '关联字段', 'linked')
        self.content_mode.currentIndexChanged.connect(self._content_mode_changed)
        self.content_value = QtWidgets.QLineEdit()
        self.content_value.setClearButtonEnabled(True)
        self.content_value.textChanged.connect(self._property_changed)
        self.field_combo = QtWidgets.QComboBox()
        self.field_combo.setEditable(True)
        for key, name in BUILTIN_FIELDS:
            self.field_combo.addItem(f'{name} ({key})', key)
        self.field_combo.currentTextChanged.connect(self._field_changed)
        self.element_name = QtWidgets.QLineEdit()
        self.element_name.setClearButtonEnabled(True)
        self.element_name.setPlaceholderText('用于元素列表识别')
        self.element_name.textChanged.connect(self._property_changed)
        self.sample_value = QtWidgets.QLineEdit()
        self.sample_value.setClearButtonEnabled(True)
        self.sample_value.setPlaceholderText('只影响设计预览，不影响实际打印')
        self.sample_value.textChanged.connect(self._property_changed)
        self.font_family = QtWidgets.QFontComboBox()
        self.font_family.currentFontChanged.connect(self._property_changed)
        self.font_size = self._spin(4, 96, 8, 1, self._property_changed)
        self.font_size.setSuffix(' pt')
        self.bold = QtWidgets.QCheckBox('加粗')
        self.bold.toggled.connect(self._property_changed)
        self.alignment = QtWidgets.QComboBox()
        self.alignment.addItem(awesome_icon('fa5s.align-left', '#667085'), '左对齐', 'left')
        self.alignment.addItem(awesome_icon('fa5s.align-center', '#667085'), '居中', 'center')
        self.alignment.addItem(awesome_icon('fa5s.align-right', '#667085'), '右对齐', 'right')
        self.alignment.currentIndexChanged.connect(self._property_changed)
        self.bar_height = self._spin(4, 1000, 32, 0, self._property_changed)
        self.bar_narrow = self._spin(1, 10, 1, 0, self._property_changed)
        self.qr_cell = self._spin(1, 10, 6, 0, self._property_changed)
        self.bar_height.setSuffix(' 点')
        self.bar_narrow.setSuffix(' 级')
        self.qr_cell.setSuffix(' 点')
        self.qr_ecc = QtWidgets.QComboBox()
        self.qr_ecc.addItems(['L', 'M', 'Q', 'H'])
        self.qr_ecc.currentTextChanged.connect(self._property_changed)
        self.qr_mask = QtWidgets.QComboBox()
        self.qr_mask.addItems([f'S{index}' for index in range(9)])
        self.qr_mask.currentTextChanged.connect(self._property_changed)
        self.qr_delimiter = QtWidgets.QLineEdit('/')
        self.qr_delimiter.textChanged.connect(self._property_changed)
        self.qr_segments = QtWidgets.QPlainTextEdit()
        self.qr_segments.setPlaceholderText('每行一段：\n字段:model\n固定:APM\n字段:quantity')
        self.qr_segments.setMaximumHeight(90)
        self.qr_segments.textChanged.connect(self._property_changed)
        self.image_path = QtWidgets.QLineEdit()
        self.image_path.setClearButtonEnabled(True)
        self.image_path.textChanged.connect(self._property_changed)
        self.image_keep_aspect = QtWidgets.QCheckBox('保持原始宽高比')
        self.image_keep_aspect.toggled.connect(self._property_changed)
        browse = QtWidgets.QPushButton('选择图片')
        browse.setIcon(awesome_icon('fa5s.folder-open', '#475467'))
        browse.clicked.connect(self.browse_image)
        image_row = QtWidgets.QHBoxLayout()
        image_row.addWidget(self.image_path, 1)
        image_row.addWidget(browse)

        position_row = QtWidgets.QHBoxLayout()
        for widget in (self.pos_x, self.pos_y):
            position_row.addWidget(widget)
        size_row = QtWidgets.QHBoxLayout()
        for widget in (self.size_w, self.size_h):
            size_row.addWidget(widget)
        self.property_rows = {
            'element_name': ('元素名称', self.element_name),
            'position': ('X / Y', position_row),
            'size': ('W / H', size_row),
            'content_mode': ('内容来源', self.content_mode),
            'content_value': ('固定内容', self.content_value),
            'field': ('关联字段', self.field_combo),
            'sample_value': ('预览示例', self.sample_value),
            'font_family': ('字体', self.font_family),
            'font_size': ('字号', self.font_size),
            'bold': ('字形', self.bold),
            'alignment': ('对齐', self.alignment),
            'bar_height': ('条码高度(点)', self.bar_height),
            'bar_narrow': ('条码密度', self.bar_narrow),
            'qr_cell': ('二维码单元', self.qr_cell),
            'qr_ecc': ('容错级别', self.qr_ecc),
            'qr_mask': ('二维码掩码', self.qr_mask),
            'qr_delimiter': ('分隔符', self.qr_delimiter),
            'qr_segments': ('二维码内容段', self.qr_segments),
            'image_path': ('图片', image_row),
            'image_keep_aspect': ('图片缩放', self.image_keep_aspect),
        }
        for _key, (label, widget) in self.property_rows.items():
            self.property_form.addRow(label, widget)
        layout.addWidget(self.property_group)
        layout.addSpacing(220)
        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QtWidgets.QFrame.NoFrame)
        scroll.setHorizontalScrollBarPolicy(QtCore.Qt.ScrollBarAlwaysOff)
        scroll.setWidget(panel)
        self.editor_scroll = scroll
        return scroll

    def _build_preview_panel(self):
        group = QtWidgets.QGroupBox('预览编辑区')
        layout = QtWidgets.QVBoxLayout(group)
        preview_toolbar = QtWidgets.QHBoxLayout()
        preview_toolbar.addStretch(1)
        zoom_out = QtWidgets.QToolButton()
        zoom_out.setIcon(awesome_icon('fa5s.search-minus', '#475467'))
        zoom_out.setIconSize(QtCore.QSize(15, 15))
        zoom_out.setToolTip('缩小预览')
        zoom_out.clicked.connect(lambda: self.preview.scale(1 / 1.15, 1 / 1.15))
        fit_button = QtWidgets.QToolButton()
        fit_button.setIcon(awesome_icon('fa5s.expand-arrows-alt', '#475467'))
        fit_button.setText('适应')
        fit_button.setToolButtonStyle(QtCore.Qt.ToolButtonTextBesideIcon)
        fit_button.setToolTip('适应窗口')
        fit_button.clicked.connect(self.fit_preview)
        zoom_in = QtWidgets.QToolButton()
        zoom_in.setIcon(awesome_icon('fa5s.search-plus', '#475467'))
        zoom_in.setIconSize(QtCore.QSize(15, 15))
        zoom_in.setToolTip('放大预览')
        zoom_in.clicked.connect(lambda: self.preview.scale(1.15, 1.15))
        preview_toolbar.addWidget(zoom_out)
        preview_toolbar.addWidget(fit_button)
        preview_toolbar.addWidget(zoom_in)
        layout.addLayout(preview_toolbar)
        self.scene = QtWidgets.QGraphicsScene()
        self.scene.selectionChanged.connect(self._scene_selection_changed)
        self.preview = CanvasView(self.scene)
        self.preview.setRenderHint(QtGui.QPainter.Antialiasing, True)
        self.preview.setRenderHint(QtGui.QPainter.SmoothPixmapTransform, False)
        self.preview.setBackgroundBrush(QtGui.QColor('#e9edf2'))
        self.preview.setDragMode(QtWidgets.QGraphicsView.NoDrag)
        self.preview.setViewportUpdateMode(QtWidgets.QGraphicsView.BoundingRectViewportUpdate)
        self.preview.setOptimizationFlag(QtWidgets.QGraphicsView.DontSavePainterState, True)
        self.preview.setOptimizationFlag(QtWidgets.QGraphicsView.DontAdjustForAntialiasing, True)
        self.preview.setTransformationAnchor(QtWidgets.QGraphicsView.AnchorUnderMouse)
        self.preview.setResizeAnchor(QtWidgets.QGraphicsView.AnchorViewCenter)
        self.preview.setFrameShape(QtWidgets.QFrame.NoFrame)
        layout.addWidget(self.preview)
        sample_note = QtWidgets.QLabel('预览使用模板中的示例数据；打印时关联字段会自动替换为实际拆包数据。')
        sample_note.setStyleSheet('color:#667085;')
        layout.addWidget(sample_note)
        return group

    def fit_preview(self):
        if hasattr(self, 'scene') and not self.scene.sceneRect().isEmpty():
            self.preview.fitInView(self.scene.sceneRect(), QtCore.Qt.KeepAspectRatio)
            for item in self.overlay_items.values():
                item.update()

    def _spin(self, minimum, maximum, value, decimals, callback):
        if decimals:
            widget = QtWidgets.QDoubleSpinBox()
            widget.setDecimals(decimals)
            widget.setSingleStep(0.5)
        else:
            widget = QtWidgets.QSpinBox()
        widget.setButtonSymbols(QtWidgets.QAbstractSpinBox.PlusMinus)
        widget.setAlignment(QtCore.Qt.AlignLeft | QtCore.Qt.AlignVCenter)
        widget.setRange(minimum, maximum)
        widget.setValue(value)
        widget.valueChanged.connect(callback)
        return widget

    def _reload_template_combo(self, selected_id: str | None = None):
        self.template_combo.blockSignals(True)
        self.template_combo.clear()
        for template in self.store.list_templates():
            self.template_combo.addItem(
                awesome_icon('fa5s.tags', '#667085'), template['name'], template['id']
            )
        target = selected_id or self.template.get('id')
        index = self.template_combo.findData(target)
        self.template_combo.setCurrentIndex(max(0, index))
        self.template_combo.blockSignals(False)

    def _set_dirty(self, dirty: bool = True) -> None:
        self.dirty = dirty
        self.setWindowModified(dirty)

    def _confirm_unsaved_changes(self) -> bool:
        if not self.dirty:
            return True
        message = QtWidgets.QMessageBox(self)
        message.setIcon(QtWidgets.QMessageBox.Warning)
        message.setWindowTitle('尚未保存')
        message.setText('当前模板有未保存的修改。')
        message.setInformativeText('关闭或切换模板前，是否保存本次修改？')
        save_button = message.addButton('保存', QtWidgets.QMessageBox.AcceptRole)
        discard_button = message.addButton('不保存', QtWidgets.QMessageBox.DestructiveRole)
        message.addButton('取消', QtWidgets.QMessageBox.RejectRole)
        message.setDefaultButton(save_button)
        message.exec()
        if message.clickedButton() is save_button:
            return self.save_template()
        return message.clickedButton() is discard_button

    def _confirm_action(self, title: str, text: str, confirm_text: str) -> bool:
        message = QtWidgets.QMessageBox(self)
        message.setIcon(QtWidgets.QMessageBox.Question)
        message.setWindowTitle(title)
        message.setText(text)
        confirm_button = message.addButton(confirm_text, QtWidgets.QMessageBox.DestructiveRole)
        cancel_button = message.addButton('取消', QtWidgets.QMessageBox.RejectRole)
        message.setDefaultButton(cancel_button)
        message.exec()
        return message.clickedButton() is confirm_button

    def _load_template(self, template: dict[str, Any]):
        self.template = copy.deepcopy(template)
        self.loading_controls = True
        self.template_name.setText(str(self.template['name']))
        label = self.template['label']
        self.paper_width.setValue(float(label['widthMm']))
        self.paper_height.setValue(float(label['heightMm']))
        self.paper_dpi.setCurrentText(str(label.get('dpi', 203)))
        self.paper_copies.setValue(int(label.get('copies', 1)))
        self.loading_controls = False
        for element in self.template.get('elements', []):
            if element.get('type') == 'barcode':
                self._sync_barcode_geometry(element, use_requested_width=False)
            elif element.get('type') == 'qrcode':
                self._sync_qr_geometry(element, use_requested_size=False)
        self._reload_template_combo(self.template['id'])
        self._reload_element_list()
        self._refresh_preview(rebuild=True)
        self._set_dirty(False)

    def _template_selected(self):
        template_id = self.template_combo.currentData()
        if template_id and template_id != self.template.get('id'):
            if self._confirm_unsaved_changes():
                self._load_template(self.store.load(str(template_id)))
            else:
                self._reload_template_combo(str(self.template.get('id')))

    def _paper_changed(self):
        if self.loading_controls:
            return
        self.template['name'] = self.template_name.text().strip() or '未命名模板'
        label = self.template['label']
        label['widthMm'] = self.paper_width.value()
        label['heightMm'] = self.paper_height.value()
        label['dpi'] = int(self.paper_dpi.currentText())
        label['copies'] = int(self.paper_copies.value())
        label.pop('widthDots', None)
        label.pop('heightDots', None)
        self._set_dirty()
        self._refresh_preview(rebuild=True)

    def _element_name(self, element: dict[str, Any]) -> str:
        configured_name = normalize_text(element.get('name'))
        if configured_name:
            return configured_name
        labels = {'text': '文字', 'barcode': '条码', 'qrcode': '二维码', 'image': '图片'}
        content = element.get('content', {})
        if content.get('mode') == 'linked':
            field = normalize_text(content.get('field'))
            suffix = dict(BUILTIN_FIELDS).get(field, field)
        else:
            suffix = content.get('value')
        return f"{labels.get(element.get('type'), element.get('type'))}  {normalize_text(suffix)[:24]}"

    def _reload_element_list(self, selected_id: str | None = None):
        current_id = selected_id or (self.current_element or {}).get('id')
        self.element_list.blockSignals(True)
        self.element_list.clear()
        target_row = -1
        for index, element in enumerate(self.template.get('elements', [])):
            item = QtWidgets.QListWidgetItem(self._element_name(element))
            icon_name = {
                'text': 'fa5s.font',
                'barcode': 'fa5s.barcode',
                'qrcode': 'fa5s.qrcode',
                'image': 'fa5s.image',
            }.get(element.get('type'), 'fa5s.square')
            item.setIcon(awesome_icon(icon_name, '#667085'))
            item.setData(QtCore.Qt.UserRole, element['id'])
            self.element_list.addItem(item)
            if element['id'] == current_id:
                target_row = index
        self.element_list.blockSignals(False)
        self.element_list.setCurrentRow(target_row if target_row >= 0 else (0 if self.element_list.count() else -1))

    def _element_selected(self, row: int):
        if row < 0:
            self.current_element = None
            self.property_group.setEnabled(False)
            return
        element_id = self.element_list.item(row).data(QtCore.Qt.UserRole)
        self.current_element = next((item for item in self.template['elements'] if item['id'] == element_id), None)
        self.property_group.setEnabled(self.current_element is not None)
        if self.current_element:
            self._load_properties(self.current_element)
            box = self.overlay_items.get(self.current_element['id'])
            if box and not box.isSelected():
                self.scene.clearSelection()
                box.setSelected(True)
            if self.element_list.hasFocus():
                QtCore.QTimer.singleShot(0, self._scroll_to_properties)

    def _scroll_to_properties(self):
        if not hasattr(self, 'editor_scroll'):
            return
        scroll_bar = self.editor_scroll.verticalScrollBar()
        scroll_bar.setValue(max(0, self.property_group.y() - 10))

    def _load_properties(self, element: dict[str, Any]):
        self.loading_controls = True
        self.element_name.setText(str(element.get('name', '')))
        self.pos_x.setValue(int(element.get('x', 0)))
        self.pos_y.setValue(int(element.get('y', 0)))
        self.size_w.setValue(int(element.get('width', 40)))
        self.size_h.setValue(int(element.get('height', 30)))
        kind = element['type']
        content = element.get('content', {})
        mode_index = self.content_mode.findData(content.get('mode', 'fixed'))
        self.content_mode.setCurrentIndex(max(0, mode_index))
        self.content_value.setText(str(content.get('value', '')))
        field = str(content.get('field', ''))
        index = self.field_combo.findData(field)
        if index >= 0:
            self.field_combo.setCurrentIndex(index)
        else:
            self.field_combo.setEditText(field)
        self.sample_value.setText(str(self.template.get('sampleValues', {}).get(field, '')))
        self.font_family.setCurrentFont(QtGui.QFont(str(element.get('fontFamily', 'Arial'))))
        self.font_size.setValue(float(element.get('fontSizePt', 8)))
        self.bold.setChecked(bool(element.get('bold', False)))
        self.alignment.setCurrentIndex(max(0, self.alignment.findData(element.get('horizontalAlign', 'left'))))
        self.bar_height.setValue(int(element.get('heightDots', element.get('height', 32))))
        self.bar_narrow.setValue(int(element.get('narrowDots', 1)))
        self.qr_cell.setValue(int(element.get('cellDots', 6)))
        self.qr_ecc.setCurrentText(str(element.get('ecc', 'L')))
        self.qr_mask.setCurrentText(str(element.get('mask', 'S7')))
        self.qr_delimiter.setText(str(element.get('delimiter', '/')))
        lines = []
        for segment in element.get('segments', []):
            if segment.get('mode') == 'linked':
                lines.append(f"字段:{segment.get('field', '')}")
            else:
                lines.append(f"固定:{segment.get('value', '')}")
        self.qr_segments.setPlainText('\n'.join(lines))
        self.image_path.setText(str(element.get('path', '')))
        self.image_keep_aspect.setChecked(
            bool(element.get('keepAspectRatio', element.get('keepAspect', True)))
        )
        native_sized = kind in {'barcode', 'qrcode'}
        self.size_w.setEnabled(not native_sized)
        self.size_h.setEnabled(not native_sized)
        self.size_w.setToolTip(
            '' if not native_sized else '条码和二维码尺寸由打印机真实点阵决定，可拖动选择框调整。'
        )
        self.size_h.setToolTip(self.size_w.toolTip())
        visibility = {
            'element_name': True,
            'content_mode': kind in {'text', 'barcode'},
            'content_value': kind in {'text', 'barcode'},
            'field': kind in {'text', 'barcode'},
            'sample_value': kind in {'text', 'barcode'},
            'font_family': kind == 'text', 'font_size': kind == 'text', 'bold': kind == 'text',
            'alignment': kind == 'text', 'bar_height': kind == 'barcode', 'bar_narrow': kind == 'barcode',
            'qr_cell': kind == 'qrcode', 'qr_ecc': kind == 'qrcode', 'qr_delimiter': kind == 'qrcode',
            'qr_mask': kind == 'qrcode', 'qr_segments': kind == 'qrcode',
            'image_path': kind == 'image', 'image_keep_aspect': kind == 'image',
        }
        for key, visible in visibility.items():
            label = self.property_form.labelForField(self._field_widget(key))
            widget = self._field_widget(key)
            if label:
                label.setVisible(visible)
            if isinstance(widget, QtWidgets.QLayout):
                for index in range(widget.count()):
                    if widget.itemAt(index).widget():
                        widget.itemAt(index).widget().setVisible(visible)
            else:
                widget.setVisible(visible)
        self._content_mode_changed()
        self.loading_controls = False

    def _field_widget(self, key: str):
        return self.property_rows[key][1]

    def _content_mode_changed(self):
        if self.current_element and self.current_element['type'] in {'text', 'barcode'}:
            linked = self.content_mode.currentData() == 'linked'
            self.content_value.setEnabled(not linked)
            self.field_combo.setEnabled(linked)
            self.sample_value.setEnabled(linked)
        self._property_changed()

    def _selected_field_key(self) -> str:
        index = self.field_combo.currentIndex()
        if index >= 0 and self.field_combo.currentText() == self.field_combo.itemText(index):
            return normalize_text(self.field_combo.itemData(index))
        return normalize_text(self.field_combo.currentText())

    def _field_changed(self):
        if self.loading_controls:
            return
        field = self._selected_field_key()
        self.sample_value.blockSignals(True)
        self.sample_value.setText(str(self.template.get('sampleValues', {}).get(field, '')))
        self.sample_value.blockSignals(False)
        self._property_changed()

    def _property_changed(self):
        if self.loading_controls or not self.current_element:
            return
        element = self.current_element
        element['name'] = self.element_name.text().strip()
        element.update(x=self.pos_x.value(), y=self.pos_y.value(), width=self.size_w.value(), height=self.size_h.value())
        if element['type'] in {'text', 'barcode'}:
            mode = self.content_mode.currentData()
            field = self._selected_field_key()
            element['content'] = {'mode': mode, 'field': field} if mode == 'linked' else {'mode': 'fixed', 'value': self.content_value.text()}
            if mode == 'linked' and field:
                self.template.setdefault('sampleValues', {})[field] = self.sample_value.text()
        if element['type'] == 'text':
            element.update(
                fontFamily=self.font_family.currentFont().family(), fontSizePt=self.font_size.value(),
                bold=self.bold.isChecked(), horizontalAlign=self.alignment.currentData(), overflow='clip',
            )
        elif element['type'] == 'barcode':
            element.update(heightDots=self.bar_height.value(), narrowDots=self.bar_narrow.value(), wideDots=self.bar_narrow.value())
            self._sync_barcode_geometry(element, use_requested_width=False)
        elif element['type'] == 'qrcode':
            segments = []
            for line in self.qr_segments.toPlainText().splitlines():
                if not line.strip():
                    continue
                prefix, separator, value = line.partition(':')
                if separator and prefix.strip() in {'字段', 'field'}:
                    segments.append({'mode': 'linked', 'field': value.strip()})
                elif separator and prefix.strip() in {'固定', 'fixed'}:
                    segments.append({'mode': 'fixed', 'value': value})
                else:
                    segments.append({'mode': 'fixed', 'value': line})
            element.update(
                cellDots=self.qr_cell.value(),
                ecc=self.qr_ecc.currentText(),
                mask=self.qr_mask.currentText(),
                delimiter=self.qr_delimiter.text(),
                segments=segments or [{'mode': 'fixed', 'value': ''}],
            )
            self._sync_qr_geometry(element, use_requested_size=False)
        elif element['type'] == 'image':
            element['path'] = self.image_path.text().strip()
            element['keepAspectRatio'] = self.image_keep_aspect.isChecked()
        current_item = self.element_list.currentItem()
        if current_item and current_item.data(QtCore.Qt.UserRole) == element['id']:
            current_item.setText(self._element_name(element))
        self._set_dirty()
        self._refresh_preview(rebuild=False)

    def add_element(self, kind: str):
        type_names = {'text': '文字', 'barcode': '条码', 'qrcode': '二维码', 'image': '图片'}
        base: dict[str, Any] = {
            'id': make_element_id(kind),
            'type': kind,
            'name': f'新{type_names.get(kind, "元素")}',
            'x': 20,
            'y': 20,
            'width': 120,
            'height': 35,
        }
        if kind == 'text':
            base.update(content={'mode': 'fixed', 'value': '新文字'}, fontFamily='Microsoft YaHei UI', fontSizePt=8, horizontalAlign='left', verticalAlign='top')
        elif kind == 'barcode':
            base.update(content={'mode': 'linked', 'field': 'model'}, symbology='CODE128', heightDots=32, narrowDots=1, wideDots=1)
        elif kind == 'qrcode':
            base.update(width=120, height=120, segments=[{'mode': 'linked', 'field': 'model'}], delimiter='/', model='M2', mask='S7', ecc='L', cellDots=6, skipEmpty=True)
        else:
            base.update(path='assets/geehy-logo.png', keepAspectRatio=True)
        self.template['elements'].append(base)
        if kind == 'barcode':
            self._sync_barcode_geometry(base, use_requested_width=False)
        elif kind == 'qrcode':
            self._sync_qr_geometry(base, use_requested_size=False)
        self.current_element = base
        self._reload_element_list(base['id'])
        self._set_dirty()
        self._refresh_preview(rebuild=True)

    def duplicate_element(self):
        if not self.current_element:
            return
        duplicate = copy.deepcopy(self.current_element)
        duplicate['id'] = make_element_id(str(duplicate.get('type', 'element')))
        duplicate['name'] = f"{self._element_name(duplicate)} 副本"
        duplicate['x'] = max(0, int(duplicate.get('x', 0)) + 12)
        duplicate['y'] = max(0, int(duplicate.get('y', 0)) + 12)
        self.template['elements'].append(duplicate)
        self.current_element = duplicate
        self._reload_element_list(duplicate['id'])
        self._set_dirty()
        self._refresh_preview(rebuild=True)

    def remove_element(self):
        if not self.current_element:
            return
        self.template['elements'] = [item for item in self.template['elements'] if item['id'] != self.current_element['id']]
        self.current_element = None
        self._reload_element_list()
        self._set_dirty()
        self._refresh_preview(rebuild=True)

    def browse_image(self):
        path, _filter = QtWidgets.QFileDialog.getOpenFileName(self, '选择图片', '', 'Images (*.png *.jpg *.jpeg *.bmp)')
        if path:
            self.image_path.setText(path)

    def _scene_selection_changed(self):
        try:
            selected = [item for item in self.scene.selectedItems() if isinstance(item, ElementBox)]
        except RuntimeError:
            return
        if selected:
            element_id = selected[0].element['id']
            for row in range(self.element_list.count()):
                if self.element_list.item(row).data(QtCore.Qt.UserRole) == element_id:
                    self.element_list.setCurrentRow(row)
                    QtCore.QTimer.singleShot(0, self._scroll_to_properties)
                    break

    def _overlay_changed(self):
        if self.current_element and self.current_element.get('type') == 'barcode':
            self._sync_barcode_geometry(self.current_element, use_requested_width=True)
        elif self.current_element and self.current_element.get('type') == 'qrcode':
            self._sync_qr_geometry(self.current_element, use_requested_size=True)
        if self.current_element:
            self.loading_controls = True
            self.pos_x.setValue(int(self.current_element['x']))
            self.pos_y.setValue(int(self.current_element['y']))
            self.size_w.setValue(int(self.current_element['width']))
            self.size_h.setValue(int(self.current_element['height']))
            self.loading_controls = False
            self._set_dirty()
        self._refresh_preview(rebuild=False)

    def _sync_barcode_geometry(self, element: dict[str, Any], use_requested_width: bool) -> None:
        record = get_template_sample_record(self.template)
        value = resolve_content(element.get('content', {'mode': 'fixed', 'value': '-'}), record) or '-'
        pattern_modules = max(1, len(get_code128_pattern(value)))
        if use_requested_width:
            requested_width = max(1, int(element.get('width', pattern_modules)))
            narrow = max(1, min(10, round(requested_width / pattern_modules)))
            element['narrowDots'] = narrow
            element['wideDots'] = narrow
            element['heightDots'] = max(4, int(element.get('height', element.get('heightDots', 32))))
        width, height = get_barcode_native_dimensions(element, value)
        element['width'] = width
        element['height'] = height
        if self.current_element is element:
            self.loading_controls = True
            self.bar_narrow.setValue(int(element.get('narrowDots', 1)))
            self.bar_height.setValue(height)
            self.size_w.setValue(width)
            self.size_h.setValue(height)
            self.loading_controls = False
            self.statusBar().showMessage(
                f'条码已吸附到打印机真实点阵：{width} x {height} 点，密度 {element.get("narrowDots", 1)}'
            )

    def _sync_qr_geometry(self, element: dict[str, Any], use_requested_size: bool) -> None:
        value = build_qr_content(element, get_template_sample_record(self.template)) or '-'
        sizing_element = copy.deepcopy(element)
        sizing_element['cellDots'] = 1
        module_count, _height = get_qr_native_dimensions(sizing_element, value)
        if use_requested_size:
            requested_side = max(1, round(max(float(element.get('width', 1)), float(element.get('height', 1)))))
            element['cellDots'] = max(1, min(10, round(requested_side / max(1, module_count))))
        width, height = get_qr_native_dimensions(element, value)
        element['width'] = width
        element['height'] = height
        if self.current_element is element:
            self.loading_controls = True
            self.qr_cell.setValue(int(element.get('cellDots', 4)))
            self.size_w.setValue(width)
            self.size_h.setValue(height)
            self.loading_controls = False
            self.statusBar().showMessage(
                f'二维码已吸附到打印机真实点阵：{width} x {height} 点，单元 {element.get("cellDots", 4)} 点'
            )

    def _refresh_preview(self, rebuild: bool):
        self.refresh_pending = True
        self.refresh_rebuild_required = self.refresh_rebuild_required or rebuild
        self.refresh_timer.start(0 if rebuild else 55)

    def _render_element_pixmap(self, element: dict[str, Any]):
        from PIL import Image

        temporary = copy.deepcopy(self.template)
        temporary['elements'] = [copy.deepcopy(element)]
        rendered = render_preview(temporary, get_template_sample_record(self.template)).convert('L')
        x = round(float(element.get('x', 0)))
        y = round(float(element.get('y', 0)))
        width = max(1, round(float(element.get('width', 1))))
        height = max(1, round(float(element.get('height', 1))))
        local = Image.new('L', (width, height), 255)
        label_width, label_height = rendered.size
        source_left = max(0, x)
        source_top = max(0, y)
        source_right = min(label_width, x + width)
        source_bottom = min(label_height, y + height)
        if source_right > source_left and source_bottom > source_top:
            crop = rendered.crop((source_left, source_top, source_right, source_bottom))
            local.paste(crop, (source_left - x, source_top - y))
        rgba = Image.new('RGBA', local.size, (0, 0, 0, 0))
        rgba.putalpha(local.point(lambda value: 255 - value))
        return pil_to_pixmap(rgba)

    def _update_element_item(self, element: dict[str, Any]) -> None:
        box = self.overlay_items.get(str(element.get('id')))
        if not box:
            return
        box.prepareGeometryChange()
        box.setPos(float(element.get('x', 0)), float(element.get('y', 0)))
        box.setRect(0, 0, float(element.get('width', 1)), float(element.get('height', 1)))
        box.set_visual(self._render_element_pixmap(element))
        box.update()

    def _do_refresh_preview(self):
        rebuild = self.refresh_rebuild_required
        self.refresh_pending = False
        self.refresh_rebuild_required = False
        try:
            selected_id = (self.current_element or {}).get('id')
            if not rebuild and selected_id in self.overlay_items:
                self._update_element_item(self.current_element)
                return
            self.scene.clear()
            self.overlay_items.clear()
            width, height, _dpi = get_label_dimensions(self.template)
            shadow = self.scene.addRect(7, 8, width, height, QtCore.Qt.NoPen, QtGui.QColor('#c7cdd6'))
            shadow.setZValue(-3)
            paper = self.scene.addRect(0, 0, width, height, QtGui.QPen(QtGui.QColor('#d0d5dd')), QtGui.QColor('#ffffff'))
            paper.setZValue(-2)
            self.scene.setSceneRect(-32, -32, width + 72, height + 76)
            for element in self.template.get('elements', []):
                box = ElementBox(element, self._overlay_changed)
                box.set_visual(self._render_element_pixmap(element))
                self.scene.addItem(box)
                self.overlay_items[element['id']] = box
                if element['id'] == selected_id:
                    box.setSelected(True)
            self.preview.fitInView(self.scene.sceneRect(), QtCore.Qt.KeepAspectRatio)
        except Exception as error:
            self.statusBar().showMessage(f'预览失败：{error}')

    def save_template(self) -> bool:
        try:
            self.template = self.store.save(self.template, make_active=True)
            self._reload_template_combo(self.template['id'])
            self._set_dirty(False)
            self.statusBar().showMessage('模板已保存，同步服务下一个标签任务将自动使用它')
            return True
        except Exception as error:
            QtWidgets.QMessageBox.critical(self, '保存失败', str(error))
            return False

    def new_blank_template(self):
        if not self._confirm_unsaved_changes():
            return
        name, ok = QtWidgets.QInputDialog.getText(self, '新建空白模板', '模板名称：', text='新标签模板')
        if not ok or not name.strip():
            return
        template = {
            'schemaVersion': 1,
            'id': make_template_id(name.strip()),
            'name': name.strip(),
            'label': {
                'widthMm': float(self.paper_width.value()),
                'heightMm': float(self.paper_height.value()),
                'dpi': int(self.paper_dpi.currentText()),
                'direction': 1,
                'gapMm': 3,
                'copies': int(self.paper_copies.value()),
                'marginsMm': {'top': 0, 'right': 0, 'bottom': 0, 'left': 0},
            },
            'sampleValues': {},
            'elements': [],
        }
        try:
            self._load_template(self.store.save(template, make_active=True))
        except Exception as error:
            QtWidgets.QMessageBox.critical(self, '新建失败', str(error))

    def save_as(self):
        name, ok = QtWidgets.QInputDialog.getText(self, '模板另存为', '新模板名称：')
        if ok and name.strip():
            try:
                self.template = self.store.save_as(self.template, name.strip())
                self._load_template(self.template)
            except Exception as error:
                QtWidgets.QMessageBox.critical(self, '另存失败', str(error))

    def import_template(self):
        if not self._confirm_unsaved_changes():
            return
        path, _filter = QtWidgets.QFileDialog.getOpenFileName(self, '导入标签模板', '', '标签模板 (*.json)')
        if not path:
            return
        try:
            imported = json.loads(Path(path).read_text(encoding='utf-8'))
            validate_template(imported)
            imported['id'] = make_template_id(str(imported.get('name', '导入模板')))
            self._load_template(self.store.save(imported, make_active=True))
            self.statusBar().showMessage(f'模板已导入：{Path(path).name}')
        except Exception as error:
            QtWidgets.QMessageBox.critical(self, '导入失败', str(error))

    def export_template(self):
        try:
            validate_template(self.template)
        except Exception as error:
            QtWidgets.QMessageBox.critical(self, '模板无效', str(error))
            return
        suggested = f"{normalize_text(self.template.get('name')) or '标签模板'}.json"
        path, _filter = QtWidgets.QFileDialog.getSaveFileName(self, '导出标签模板', suggested, '标签模板 (*.json)')
        if not path:
            return
        target = Path(path)
        if target.suffix.lower() != '.json':
            target = target.with_suffix('.json')
        try:
            target.write_text(json.dumps(self.template, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            self.statusBar().showMessage(f'模板已导出：{target}')
        except Exception as error:
            QtWidgets.QMessageBox.critical(self, '导出失败', str(error))

    def delete_template(self):
        if not self._confirm_unsaved_changes():
            return
        if not self._confirm_action(
            '删除模板',
            f"确定删除“{normalize_text(self.template.get('name'))}”吗？",
            '删除',
        ):
            return
        try:
            self.store.delete(str(self.template['id']))
            self._load_template(self.store.load_active())
        except Exception as error:
            QtWidgets.QMessageBox.warning(self, '无法删除', str(error))

    def restore_default(self):
        if self._confirm_action('恢复默认', '确定要恢复内置 APM 模板吗？', '恢复'):
            self._load_template(self.store.restore_default())

    def closeEvent(self, event):
        if self._confirm_unsaved_changes():
            self.settings.setValue('windowGeometry', self.saveGeometry())
            self.settings.setValue('splitterState', self.main_splitter.saveState())
            event.accept()
        else:
            event.ignore()

    def test_print(self):
        printer = self.printer_combo.currentText().strip()
        if not printer:
            QtWidgets.QMessageBox.warning(self, '未选择打印机', '请先选择打印机。')
            return
        try:
            job_id = print_template(printer, self.template, get_template_sample_record(self.template), copies_override=1)
            self.statusBar().showMessage(f'测试标签已发送，打印任务 {job_id}')
        except Exception as error:
            QtWidgets.QMessageBox.critical(self, '打印失败', str(error))


def main() -> int:
    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication(sys.argv)
    app.setApplicationName('掌上仓库可视化标签助手')
    window = DesignerWindow()
    window.show()
    return app.exec()


if __name__ == '__main__':
    raise SystemExit(main())
