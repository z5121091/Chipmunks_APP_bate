"""Renmao split/reprint payload and final printer-raster checks; no printing."""

import copy
import re
import unittest
from unittest.mock import patch

from openpyxl import Workbook
from PIL import Image, ImageDraw

from scripts import label_templates
from scripts import label_sync_server as server
from scripts.label_templates import renmao
from scripts.label_templates.common import (
    NATIVE_LABEL_FONT_SIZE_PIXELS,
    build_reprint_qr_image,
    get_native_arial_font,
)
from scripts.label_templates.code128 import get_reprint_barcode_width
from scripts.test_label_code128 import decode_manual_content


SUPPLIER = '广东仁懋电子有限公司'
SAMPLE_QR = 'B 810411G01000101 MOT3114G PDFN5*6 ZYA.C 5000 20261022 0005'
QR_FIELDS = ('version', 'model', 'package', 'batch', 'quantity', 'production_date', 'source_no')
FIELD_NAMES = ('版本号', '型号', '封装', '批次', '数量', '生产日期', '箱号')
BARCODE_FIELDS = ('version', 'model', 'package', 'batch', 'quantity')


def make_record(**changes):
    record = dict(supplier=SUPPLIER, version='810411G01000101', model='MOT3114G',
                  package='PDFN5*6', batch='ZYA.C', quantity='5000',
                  production_date='20261022', source_no='0005', trace_no='')
    record.update(changes)
    return record


def capture_label(record, source_qr=None, real_raster=False):
    captured = {}

    def bitmap(text_items, image_items=(), **options):
        captured.update(text=list(text_items), images=list(image_items), options=options)
        if real_raster:
            return label_templates.build_native_text_bitmap(text_items, image_items, **options)
        return b'CAPTURE\r\n'

    def qr(payload, *args, **kwargs):
        captured['payload'] = payload
        captured['qr'] = build_reprint_qr_image(payload, *args, **kwargs)
        return captured['qr']

    with patch.object(renmao, 'build_native_text_bitmap', side_effect=bitmap), \
            patch.object(renmao, 'build_reprint_qr_image', side_effect=qr):
        commands = label_templates.build_native_label(
            record, label_templates.NATIVE_LABEL_TEMPLATE_RENMAO, source_qr=source_qr,
        )
    return commands, captured


def barcode_rows(commands):
    result = []
    for match in re.finditer(
        rb'BARCODE (\d+),(\d+),"128M",(\d+),0,0,(\d+),(\d+),"([^"]*)"', commands,
    ):
        x, y, height, narrow, wide = map(int, match.groups()[:5])
        value = decode_manual_content(match.group(6).decode('ascii'))[0]
        result.append((value, (x, y, x + get_reprint_barcode_width(value, narrow), y + height), narrow, wide))
    return result


def ink_bounds(item):
    x, y, text, bold = item[:4]
    size = item[4] if len(item) > 4 else NATIVE_LABEL_FONT_SIZE_PIXELS
    image = Image.new('1', (800, 400), 0)
    ImageDraw.Draw(image).text((x, y), text, anchor='lt', fill=1,
                              font=get_native_arial_font(bold=bold, size_pixels=size))
    return image.getbbox()


def intersects(first, second):
    return (first[0] < second[2] and first[2] > second[0]
            and first[1] < second[3] and first[3] > second[1])


class RenmaoLabelTest(unittest.TestCase):
    def test_only_exact_supplier_routes_to_the_new_template(self):
        template = label_templates.NATIVE_LABEL_TEMPLATE_RENMAO
        self.assertIs(template['builder'], renmao.build_native_renmao_label)
        for supplier in (SUPPLIER, '  ' + SUPPLIER + '  '):
            self.assertIs(label_templates.get_native_label_template(make_record(supplier=supplier)), template)
        for supplier in ('仁懋', 'MOT', SUPPLIER + '分公司', '广东仁懋电子有限责任公司', ''):
            with self.subTest(supplier=supplier):
                self.assertIsNone(label_templates.get_native_label_template(make_record(supplier=supplier)))

    def test_existing_excel_columns_keep_version_date_and_zero_padded_box(self):
        workbook = Workbook()
        workbook.active.append(['供应商', '版本号', '型号', '封装', '批次', '标签数量', '生产日期', '箱号', '追溯码'])
        workbook.active.append([SUPPLIER, '810411G01000101', 'MOT3114G', 'PDFN5*6', 'ZYA.C',
                                5000, '20261022', '0005', ''])
        [record] = label_templates.get_native_label_records(workbook)
        self.assertEqual(record['source_no'], '0005')
        self.assertEqual(record['version'], '810411G01000101')
        self.assertEqual(record['trace_no'], '')
        self.assertIs(label_templates.get_native_label_template(record), label_templates.NATIVE_LABEL_TEMPLATE_RENMAO)
        _commands, captured = capture_label(record)
        self.assertEqual(captured['payload'], SAMPLE_QR)

    def test_user_sample_has_fixed_b_and_all_seven_fields_in_the_given_order(self):
        record = make_record()
        before = copy.deepcopy(record)
        commands, captured = capture_label(record)
        self.assertEqual(captured['payload'], SAMPLE_QR)
        self.assertEqual(captured['payload'].split(' '), ['B'] + [record[field] for field in QR_FIELDS])
        self.assertEqual(record, before)
        self.assertTrue(commands.startswith(b'SIZE 100 mm,50 mm\r\n'))
        self.assertTrue(commands.endswith(b'PRINT 1,2\r\n'))
        self.assertNotIn(b'QRCODE ', commands)

    def test_split_quantities_change_only_the_quantity_segment_without_inventing_a_trace(self):
        original = SAMPLE_QR.split(' ')
        for quantity in ('200', '4800', '1'):
            with self.subTest(quantity=quantity):
                record = make_record(quantity=quantity)
                _commands, captured = capture_label(record)
                expected = original[:]
                expected[5] = quantity
                self.assertEqual(captured['payload'].split(' '), expected)
                self.assertEqual(captured['payload'].split(' ')[-1], '0005')
                self.assertEqual(record['trace_no'], '')

    def test_reprint_preserves_original_spaces_and_leading_zeroes_exactly(self):
        for source in (SAMPLE_QR, SAMPLE_QR.replace(' ', '  '),
                       SAMPLE_QR.replace(' 5000 ', ' 05000 ')):
            with self.subTest(source=source):
                _commands, captured = capture_label(make_record(quantity='5000.0'), source_qr=source)
                self.assertEqual(captured['payload'].encode('ascii'), source.encode('ascii'))
                self.assertTrue(captured['payload'].endswith('0005'))
        _commands, captured = capture_label(make_record(quantity='5000.0'))
        self.assertEqual(captured['payload'], SAMPLE_QR)

    def test_each_mapped_field_mismatch_names_the_actual_field(self):
        for key, name in zip(QR_FIELDS, FIELD_NAMES):
            with self.subTest(field=key), self.assertRaisesRegex(ValueError, re.escape(name)):
                capture_label(make_record(**{key: '4999' if key == 'quantity' else 'OTHER'}), SAMPLE_QR)

    def test_incomplete_extra_and_wrong_fixed_marker_are_rejected(self):
        for source in (SAMPLE_QR.rsplit(' ', 1)[0], SAMPLE_QR + ' EXTRA', 'B'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                capture_label(make_record(), source)
        for marker in ('A', 'b', 'WRONG'):
            with self.subTest(marker=marker), self.assertRaisesRegex(ValueError, 'B'):
                capture_label(make_record(), marker + SAMPLE_QR[1:])

    def test_missing_fields_and_invalid_quantities_stop_before_qr_generation(self):
        for key, name in zip(QR_FIELDS, FIELD_NAMES):
            with self.subTest(field=key), self.assertRaisesRegex(ValueError, re.escape(name)):
                capture_label(make_record(**{key: ''}))
        for quantity in ('0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'):
            with self.subTest(quantity=quantity), patch.object(renmao, 'build_reprint_qr_image') as qr:
                with self.assertRaisesRegex(ValueError, '数量'):
                    label_templates.build_native_label(make_record(quantity=quantity),
                                                      label_templates.NATIVE_LABEL_TEMPLATE_RENMAO)
                qr.assert_not_called()

    def test_fields_cannot_smuggle_separators_or_printer_control_characters(self):
        for key, name in zip(QR_FIELDS, FIELD_NAMES):
            for unsafe in ('A B', 'A\rB', 'A\nB', '\rA', 'A\r', 'A\tB', 'A\x00B', 'A"B', '中文'):
                with self.subTest(field=key, unsafe=repr(unsafe)), self.assertRaisesRegex(ValueError, re.escape(name)):
                    capture_label(make_record(**{key: unsafe}))
        for source in (SAMPLE_QR.replace(' ', '\r'), SAMPLE_QR.replace(' ', '\t')):
            with self.subTest(source=repr(source)), self.assertRaises(ValueError):
                capture_label(make_record(), source)

    def test_visible_values_marks_and_five_barcodes_match_the_reference(self):
        record = make_record()
        commands, captured = capture_label(record)
        text = [item[2] for item in captured['text']]
        for field in BARCODE_FIELDS:
            self.assertTrue(any(record[field] in item for item in text), field)
        self.assertIn('RoHS', text)
        self.assertFalse(any('QC' in item or 'PASS' in item for item in text))
        self.assertNotIn(record['production_date'], text)
        self.assertNotIn(record['source_no'], text)
        bars = barcode_rows(commands)
        self.assertEqual(len(bars), 5)
        self.assertEqual({value for value, *_rest in bars}, {record[field] for field in BARCODE_FIELDS})
        self.assertTrue(all(narrow == wide == 2 for _value, _bounds, narrow, wide in bars))

    def test_text_and_barcode_layout_keeps_each_barcode_below_its_value(self):
        commands, captured = capture_label(make_record())
        bars = barcode_rows(commands)
        qr = captured['qr']
        qr_bounds = (qr.x, qr.y, qr.quiet_right, qr.quiet_bottom)
        for value, bounds, _narrow, _wide in bars:
            x1, y1, x2, y2 = bounds
            self.assertGreaterEqual(x1, 8)
            self.assertGreaterEqual(y1, 8)
            self.assertLessEqual(x2, 792)
            self.assertLessEqual(y2, 392)
            self.assertFalse(intersects(bounds, qr_bounds), value)
            matching_text = [ink_bounds(item) for item in captured['text'] if value in item[2]]
            self.assertTrue(matching_text, value)
            self.assertTrue(any(box and box[3] < y1 and x1 <= box[0] < x2 for box in matching_text), value)
        for index, (_value, bounds, *_rest) in enumerate(bars):
            for _other, other_bounds, *_rest in bars[index + 1:]:
                self.assertFalse(intersects(bounds, other_bounds))

    def test_overlong_visible_values_are_rejected_instead_of_truncated(self):
        for key, name in zip(QR_FIELDS, FIELD_NAMES):
            if key not in ('version', 'model', 'package', 'batch'):
                continue
            with self.subTest(field=key), self.assertRaisesRegex(ValueError, re.escape(name)):
                capture_label(make_record(**{key: 'W' * 90}))

    def test_actual_raster_contains_complete_qr_and_its_quiet_zone(self):
        for quantity, source in (('5000', None), ('200', None), ('4800', None),
                                 ('5000', SAMPLE_QR), ('5000', SAMPLE_QR.replace(' ', '  '))):
            with self.subTest(quantity=quantity, source=source):
                commands, captured = capture_label(make_record(quantity=quantity), source, real_raster=True)
                marker = b'BITMAP 0,0,100,400,0,'
                offset = commands.index(marker) + len(marker)
                raster = Image.frombytes('1', (800, 400),
                                         bytes(byte ^ 255 for byte in commands[offset:offset + 40000]))
                qr = captured['qr']
                self.assertEqual(raster.crop((qr.x, qr.y, qr.quiet_right, qr.quiet_bottom)).tobytes(),
                                 qr.image.tobytes())
                self.assertGreaterEqual(qr.cell_dots, 3)
                self.assertGreaterEqual(qr.x, 8)
                self.assertGreaterEqual(qr.y, 8)
                self.assertLessEqual(qr.quiet_right, 792)
                self.assertLessEqual(qr.quiet_bottom, 392)
                quiet, side = qr.cell_dots * 4, qr.image.width
                for bounds in ((0, 0, side, quiet), (0, side - quiet, side, side),
                               (0, 0, quiet, side), (side - quiet, 0, side, side)):
                    self.assertIsNone(qr.image.crop(bounds).getbbox())

    def test_safe_reprint_diagnostics_keep_field_names_without_leaking_paths(self):
        for message in (
            '仁懋原始二维码须包含完整的八个空格分隔字段',
            '仁懋原始二维码第1段固定标识应为B',
            '仁懋标签数量须为有效的正整数',
            '仁懋标签缺少箱号',
            '仁懋标签型号含二维码分隔符空格，无法完整打印',
            '仁懋标签版本号文字超出模板宽度，请核对该字段内容和解析规则',
            '仁懋原始二维码批次与解析结果不一致，请核对该字段和解析规则',
        ):
            with self.subTest(message=message):
                self.assertEqual(server.get_safe_reprint_template_error(ValueError(message)), message)
        message = server.get_safe_reprint_template_error(
            RuntimeError('未找到标签图片文件：D:/SECRET/assets/renmao-logo.png'))
        self.assertIn('仁懋Logo', message)
        self.assertNotIn('SECRET', message)
        self.assertNotIn('SECRET', server.get_safe_reprint_template_error(ValueError('SECRET')))


if __name__ == '__main__':
    unittest.main()
