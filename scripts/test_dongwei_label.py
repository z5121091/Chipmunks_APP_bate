"""Dongwei label content and actual raster checks; no printer, network or DB."""

import re
import unittest
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook
from PIL import Image

from scripts import label_templates
from scripts.label_templates import apm, boya, dongwei, union, wch
from scripts.label_templates.common import (
    NATIVE_LABEL_FONT_SIZE_PIXELS,
    build_reprint_qr_image,
)


SUPPLIER = '苏州东微半导体股份有限公司'
SAMPLE_QR = 'SFS10R09UNNF;1009UN;PDFN3.3*3.3;70I0BH6770001;2000;G36PE01N;1-4;'
QR_FIELDS = ('model', 'version', 'package', 'batch', 'quantity', 'production_date', 'source_no')
VISIBLE_FIELDS = ('model', 'version', 'package', 'batch', 'production_date', 'quantity', 'source_no')
FIELD_NAMES = {
    'model': '型号', 'version': '版本号', 'package': '封装', 'batch': '批次',
    'quantity': '数量', 'production_date': '生产日期', 'source_no': '箱号',
}


def make_record(**changes):
    record = {
        'supplier': SUPPLIER,
        'model': 'SFS10R09UNNF',
        'version': '1009UN',
        'package': 'PDFN3.3*3.3',
        'batch': '70I0BH6770001',
        'quantity': '2000',
        'production_date': 'G36PE01N',
        'source_no': '1-4',
        'trace_no': '',
    }
    record.update(changes)
    return record


def capture_label(record, source_qr=None):
    captured = {}

    def capture_bitmap(text_items, image_items=(), **options):
        captured['text'] = list(text_items)
        captured['images'] = list(image_items)
        captured['drawing_options'] = options
        return b'BITMAP-CAPTURE\r\n'

    def capture_qr(payload, *args, **kwargs):
        result = build_reprint_qr_image(payload, *args, **kwargs)
        captured['payload'] = payload
        captured['qr'] = result
        return result

    with patch.object(dongwei, 'build_native_text_bitmap', side_effect=capture_bitmap), patch.object(
        dongwei, 'build_reprint_qr_image', side_effect=capture_qr,
    ):
        commands = label_templates.build_native_label(
            record, label_templates.NATIVE_LABEL_TEMPLATE_DONGWEI, source_qr=source_qr,
        )
    return commands, captured


class DongweiLabelTest(unittest.TestCase):
    def assert_visible_values(self, captured, record):
        values = [record[key] or '-' for key in VISIBLE_FIELDS]
        # Captions and values are independent text objects in the common raster.
        # Group by the seven actual data rows so a swapped DC/QTY cannot pass.
        rows = []
        for value in values:
            matches = [item for item in captured['text'] if item[2] == value]
            self.assertEqual(len(matches), 1, f'Visible value is missing or repeated: {value}')
            rows.append(matches[0])
        self.assertEqual([item[1] for item in rows], sorted(item[1] for item in rows))
        self.assertEqual(len({item[1] for item in rows}), 7)
        self.assertEqual([item[2] for item in rows], values)

    def test_exact_supplier_routing_and_existing_template_builders_are_preserved(self):
        self.assertIs(
            label_templates.get_native_label_template(make_record()),
            label_templates.NATIVE_LABEL_TEMPLATE_DONGWEI,
        )
        self.assertIs(
            label_templates.get_native_label_template(make_record(supplier='  ' + SUPPLIER + '  ')),
            label_templates.NATIVE_LABEL_TEMPLATE_DONGWEI,
        )
        for name in ('东微', '苏州东微半导体有限公司', 'ORIENTAL SEMI', '', SUPPLIER + '分公司'):
            with self.subTest(supplier=name):
                self.assertIsNone(label_templates.get_native_label_template(make_record(supplier=name)))
        for supplier, template, builder in (
            ('珠海极海半导体有限公司', label_templates.NATIVE_LABEL_TEMPLATE_GEEHY, apm.build_native_apm_label),
            ('珠海领芯科技有限公司', label_templates.NATIVE_LABEL_TEMPLATE_LEADCORE, apm.build_native_apm_label),
            ('珠海博雅科技股份有限公司', label_templates.NATIVE_LABEL_TEMPLATE_BOYA, boya.build_native_boya_label),
            ('盈力半导体(上海)有限公司', label_templates.NATIVE_LABEL_TEMPLATE_UNION, union.build_native_union_label),
            ('南京沁恒微电子股份有限公司', label_templates.NATIVE_LABEL_TEMPLATE_WCH, wch.build_native_wch_label),
        ):
            with self.subTest(supplier=supplier):
                self.assertIs(label_templates.get_native_label_template({'supplier': supplier}), template)
                self.assertIs(template['builder'], builder)

    def test_existing_excel_schema_can_route_a_label_without_trace_code(self):
        workbook = Workbook()
        workbook.active.append([
            '供应商', '型号', '版本号', '封装', '批次', '标签数量', '生产日期', '箱号', '追溯码',
        ])
        workbook.active.append([
            SUPPLIER, 'SFS10R09UNNF', '1009UN', 'PDFN3.3*3.3',
            '70I0BH6770001', 2000, 'G36PE01N', '1-4', '',
        ])
        [record] = label_templates.get_native_label_records(workbook)
        self.assertIs(label_templates.get_native_label_template(record), label_templates.NATIVE_LABEL_TEMPLATE_DONGWEI)
        _commands, captured = capture_label(record)
        self.assertEqual(captured['payload'], SAMPLE_QR)

    def test_user_sample_has_seven_visible_rows_and_the_original_qr_order(self):
        record = make_record()
        commands, captured = capture_label(record)
        self.assertEqual(captured['payload'], SAMPLE_QR)
        self.assertEqual(captured['payload'].split(';'), [record[key] for key in QR_FIELDS] + [''])
        self.assert_visible_values(captured, record)
        self.assertTrue(commands.startswith(b'SIZE 100 mm,50 mm\r\n'))
        self.assertEqual(commands.count(b'PRINT 1,2\r\n'), 1)
        self.assertNotIn(b'QRCODE ', commands)  # exact QR matrix is part of the raster

    def test_outbound_and_remaining_quantities_are_consistent_in_both_layers(self):
        for quantity in ('200', '1800'):
            record = make_record(quantity=quantity)
            with self.subTest(quantity=quantity):
                _commands, captured = capture_label(record)
                self.assertEqual(captured['payload'].split(';')[4], quantity)
                self.assert_visible_values(captured, record)
        self.assertEqual(make_record()['quantity'], '2000')

    def test_normal_and_reprint_both_keep_terminal_semicolon_and_same_fields(self):
        for source in (None, SAMPLE_QR, SAMPLE_QR[:-1]):
            with self.subTest(source=source):
                _commands, captured = capture_label(make_record(), source_qr=source)
                self.assertEqual(captured['payload'], SAMPLE_QR if source is None else source)
                self.assert_visible_values(captured, make_record())

    def test_each_mismatched_parsed_field_reports_the_actual_field(self):
        for field in QR_FIELDS:
            replacement = '1999' if field == 'quantity' else 'OTHER'
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, FIELD_NAMES[field]):
                capture_label(make_record(**{field: replacement}), source_qr=SAMPLE_QR)

    def test_numeric_quantity_equivalence_keeps_source_reprint_content(self):
        source = SAMPLE_QR.replace(';2000;', ';02000;')
        _commands, captured = capture_label(make_record(quantity='2000.0'), source_qr=source)
        self.assertEqual(captured['payload'], source)
        self.assertIn('02000', [item[2] for item in captured['text']])
        _commands, captured = capture_label(make_record(quantity='2000.0'))
        self.assertEqual(captured['payload'], SAMPLE_QR)

    def test_optional_fields_may_be_empty_without_moving_qr_positions(self):
        record = make_record(version='', package='', batch='', production_date='', source_no='')
        for source in (None, 'SFS10R09UNNF;;;;2000;;;'):
            with self.subTest(source=source):
                _commands, captured = capture_label(record, source_qr=source)
                self.assertEqual(captured['payload'], 'SFS10R09UNNF;;;;2000;;;')
                self.assertEqual(sum(item[2] == '-' for item in captured['text']), 5)

    def test_unsafe_record_characters_are_named_instead_of_truncated(self):
        for field in QR_FIELDS:
            for unsafe in ('A;B', 'A\rB', 'A\nB', 'A\tB', 'A\x00B', 'A"B', '中文'):
                for source in (None, SAMPLE_QR):
                    with self.subTest(field=field, unsafe=unsafe, reprint=source is not None):
                        with self.assertRaisesRegex(ValueError, FIELD_NAMES[field]):
                            capture_label(make_record(**{field: unsafe}), source_qr=source)

    def test_overlong_field_errors_identify_the_field_without_changing_the_record(self):
        for field in VISIBLE_FIELDS:
            if field == 'quantity':
                continue
            record = make_record(**{field: 'W' * 90})
            source = ';'.join(record[key] for key in QR_FIELDS) + ';'
            for raw in (None, source):
                with self.subTest(field=field, reprint=raw is not None):
                    with self.assertRaisesRegex(ValueError, FIELD_NAMES[field]):
                        capture_label(record, source_qr=raw)
            self.assertEqual(record[field], 'W' * 90)

    def test_missing_model_invalid_quantity_and_wrong_source_arity_are_rejected(self):
        with self.assertRaisesRegex(ValueError, '型号'):
            capture_label(make_record(model=''))
        for quantity in ('', '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'):
            with self.subTest(quantity=quantity), self.assertRaisesRegex(ValueError, '数量'):
                capture_label(make_record(quantity=quantity))
        for raw in ('A;B', SAMPLE_QR + ';', SAMPLE_QR + 'EXTRA;'):
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, '七个字段'):
                capture_label(make_record(), source_qr=raw)

    def test_green_is_retained_without_qc_or_invented_trace_and_fonts_stay_eight_point(self):
        _commands, captured = capture_label(make_record(trace_no='DO-NOT-PRINT-TRACE'))
        printed = [item[2] for item in captured['text']]
        self.assertIn('Green', printed)
        self.assertFalse(any('QC' in text or 'PASS' in text for text in printed))
        self.assertNotIn('DO-NOT-PRINT-TRACE', printed)
        self.assertNotIn('DO-NOT-PRINT-TRACE', captured['payload'])
        self.assertFalse(captured['drawing_options'].get('ellipse_items'))
        for item in captured['text']:
            size = item[4] if len(item) > 4 else NATIVE_LABEL_FONT_SIZE_PIXELS
            self.assertEqual(size, round(8 * 203 / 72))

    def test_monochrome_logo_retains_aspect_ratio_and_stays_inside_label(self):
        _commands, captured = capture_label(make_record())
        qr = captured['qr']
        logos = [(image, xy) for image, xy in captured['images'] if image is not qr.image]
        self.assertEqual(len(logos), 1)
        logo, (x, y) = logos[0]
        self.assertEqual(logo.mode, '1')
        self.assertIsNotNone(logo.getbbox())
        asset = Path(__file__).resolve().parent / 'assets' / 'dongwei-logo.png'
        with Image.open(asset) as source:
            self.assertAlmostEqual(logo.width / logo.height, source.width / source.height, delta=0.06)
        self.assertGreaterEqual(x, 0)
        self.assertGreaterEqual(y, 0)
        self.assertLessEqual(x + logo.width, 800)
        self.assertLessEqual(y + logo.height, min(item[1] for item in captured['text']))

    def test_actual_bitmap_keeps_complete_qr_with_clear_quiet_zone_and_no_overlap(self):
        # Exercise the real composite, not only captured layout declarations.
        # Cropping the final TSPL bitmap catches text/logo drawing over the QR.
        for quantity, source in (('2000', None), ('200', None), ('1800', None), ('2000', SAMPLE_QR)):
            qr_images = []

            def capture_qr(*args, **kwargs):
                result = build_reprint_qr_image(*args, **kwargs)
                qr_images.append(result)
                return result

            with self.subTest(quantity=quantity, reprint=source is not None), patch.object(
                dongwei, 'build_reprint_qr_image', side_effect=capture_qr,
            ):
                commands = label_templates.build_native_label(
                    make_record(quantity=quantity), label_templates.NATIVE_LABEL_TEMPLATE_DONGWEI,
                    source_qr=source,
                )
            [qr] = qr_images
            match = re.search(rb'BITMAP 0,0,100,400,0,', commands)
            self.assertIsNotNone(match)
            raster = Image.frombytes('1', (800, 400), bytes(byte ^ 255 for byte in commands[match.end():match.end() + 40000]))
            qr_crop = raster.crop((qr.x, qr.y, qr.quiet_right, qr.quiet_bottom))
            self.assertEqual(qr_crop.tobytes(), qr.image.tobytes())
            self.assertGreaterEqual(qr.cell_dots, 3)
            self.assertGreaterEqual(qr.symbol_size, 160)
            self.assertGreaterEqual(qr.x, 0)
            self.assertGreaterEqual(qr.y, 0)
            self.assertLessEqual(qr.quiet_right, 800)
            self.assertLessEqual(qr.quiet_bottom, 400)
            quiet = qr.cell_dots * 4
            side = qr.image.width
            for bounds in ((0, 0, side, quiet), (0, side - quiet, side, side),
                           (0, 0, quiet, side), (side - quiet, 0, side, side)):
                self.assertIsNone(qr_crop.crop(bounds).getbbox())
            self.assertEqual(commands.count(b'PRINT 1,2\r\n'), 1)


if __name__ == '__main__':
    unittest.main()
