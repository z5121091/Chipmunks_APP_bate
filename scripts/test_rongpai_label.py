"""Rongpai payload, split/reprint, barcode and raster checks without printing."""

import re
import unittest
from unittest.mock import patch

from PIL import Image

from scripts import label_templates
from scripts.label_templates import rongpai
from scripts.label_templates.common import build_reprint_qr_image
from scripts.label_templates.code128 import get_reprint_barcode_width
from scripts.test_label_code128 import decode_manual_content


SUPPLIER = '荣湃半导体(上海)有限公司'
SAMPLE_QR = 'Pai8485E-W1R;A552588.1;2528HE;1500;2507260140109;A;LEVEL2;3001-250721001;1;01-A0162;'
QR_FIELDS = (
    'model', 'batch', 'production_date', 'quantity', 'trace_no',
    None, 'version', 'source_no', None, 'package',
)


def make_record(**changes):
    record = {
        'supplier': SUPPLIER, 'model': 'Pai8485E-W1R', 'batch': 'A552588.1',
        'production_date': '2528HE', 'quantity': '1500', 'trace_no': '2507260140109',
        'version': 'LEVEL2', 'source_no': '3001-250721001', 'package': '01-A0162',
    }
    record.update(changes)
    return record


def capture_label(record, source_qr=None):
    captured = {}

    def capture_bitmap(text_items, image_items=(), **options):
        captured.update(text=list(text_items), images=list(image_items), options=options)
        return b'BITMAP-CAPTURE\r\n'

    def capture_qr(payload, *args, **kwargs):
        captured['payload'] = payload
        result = build_reprint_qr_image(payload, *args, **kwargs)
        captured['qr'] = result
        return result

    with patch.object(rongpai, 'build_native_text_bitmap', side_effect=capture_bitmap), patch.object(
        rongpai, 'build_reprint_qr_image', side_effect=capture_qr,
    ):
        commands = label_templates.build_native_label(
            record, label_templates.NATIVE_LABEL_TEMPLATE_RONGPAI, source_qr=source_qr,
        )
    return commands, captured


def raster_from_commands(commands):
    marker = b'BITMAP 0,0,100,400,0,'
    offset = commands.index(marker) + len(marker)
    return Image.frombytes('1', (800, 400), bytes(byte ^ 255 for byte in commands[offset:offset + 40000]))


class RongpaiLabelTest(unittest.TestCase):
    def test_exact_supplier_routes_only_to_the_new_template(self):
        template = label_templates.NATIVE_LABEL_TEMPLATE_RONGPAI
        self.assertIs(label_templates.get_native_label_template(make_record()), template)
        self.assertIs(template['builder'], rongpai.build_native_rongpai_label)
        self.assertIs(label_templates.get_native_label_template(make_record(supplier='  ' + SUPPLIER + '  ')), template)
        for name in ('荣湃', '2Pai Semi', '荣湃半导体（上海）有限公司', SUPPLIER + '分公司'):
            with self.subTest(supplier=name):
                self.assertIsNone(label_templates.get_native_label_template({'supplier': name}))

    def test_sample_has_complete_ten_fields_fixed_segments_and_terminal_semicolon(self):
        commands, captured = capture_label(make_record())
        self.assertEqual(captured['payload'], SAMPLE_QR)
        self.assertEqual(captured['payload'].split(';')[5], 'A')
        self.assertEqual(captured['payload'].split(';')[8], '1')
        self.assertTrue(commands.startswith(b'SIZE 100 mm,50 mm\r\n'))
        self.assertEqual(commands.count(b'PRINT 1,2\r\n'), 1)
        self.assertNotIn(b'QRCODE ', commands)

    def test_split_quantity_and_trace_change_only_their_own_qr_positions(self):
        original = SAMPLE_QR.split(';')
        for quantity, trace in (('200', '2507260140109-1'), ('1300', '2507260140109-2'),
                                ('200', '2507260140109-10')):
            with self.subTest(quantity=quantity, trace=trace):
                commands, captured = capture_label(make_record(quantity=quantity, trace_no=trace))
                expected = original[:]
                expected[3], expected[4] = quantity, trace
                self.assertEqual(captured['payload'].split(';'), expected)
                self.assertIn(quantity, [item[2] for item in captured['text']])
                self.assertIn(trace, [item[2] for item in captured['text']])
                self.assertEqual(commands.count(b'BARCODE '), 5)

    def test_reprint_preserves_the_original_payload_without_reordering(self):
        for source in (SAMPLE_QR, SAMPLE_QR[:-1], SAMPLE_QR.replace(';1500;', ';01500;')):
            with self.subTest(source=source):
                _commands, captured = capture_label(make_record(), source_qr=source)
                self.assertEqual(captured['payload'], source)

    def test_each_parsed_field_mismatch_names_the_actual_field(self):
        for key, name in rongpai._FIELD_NAMES.items():
            value = '1499' if key == 'quantity' else 'OTHER'
            with self.subTest(field=key), self.assertRaisesRegex(ValueError, re.escape(name)):
                capture_label(make_record(**{key: value}), source_qr=SAMPLE_QR)

    def test_source_arity_and_both_fixed_segments_are_validated(self):
        for raw in ('A;B', SAMPLE_QR + ';', SAMPLE_QR + 'EXTRA;'):
            with self.subTest(source=raw), self.assertRaisesRegex(ValueError, '十个字段'):
                capture_label(make_record(), source_qr=raw)
        for index, expected in ((5, 'A'), (8, '1')):
            fields = SAMPLE_QR.split(';')
            fields[index] = 'WRONG'
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, f'第{index + 1}段固定标识应为{expected}'):
                capture_label(make_record(), source_qr=';'.join(fields))

    def test_quantity_normalization_never_changes_original_reprint_bytes(self):
        _commands, captured = capture_label(make_record(quantity='1500.0'))
        self.assertEqual(captured['payload'], SAMPLE_QR)
        source = SAMPLE_QR.replace(';1500;', ';01500;')
        _commands, captured = capture_label(make_record(quantity='1500.0'), source_qr=source)
        self.assertEqual(captured['payload'], source)
        self.assertIn('01500', [item[2] for item in captured['text']])
        for quantity in ('', '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'):
            with self.subTest(quantity=quantity), self.assertRaisesRegex(ValueError, '数量'):
                capture_label(make_record(quantity=quantity))

    def test_visible_rows_fonts_marks_and_hidden_fields_match_the_reference(self):
        _commands, captured = capture_label(make_record())
        text = captured['text']
        self.assertEqual(text[0], (24, 18, 'Pai8485E-W1R', True, round(12 * 203 / 72)))
        rows = [item for item in text if item[0] == 180]
        self.assertEqual([item[2] for item in rows], ['Pai8485E-W1R', 'A552588.1', '2528HE', '1500', '2507260140109'])
        self.assertTrue(rows[1][3])
        self.assertEqual(rows[3][3:], (True, round(10 * 203 / 72)))
        self.assertIn((610, 360, '2Pai Semi', True, round(10 * 203 / 72)), text)
        printed = [item[2] for item in text]
        self.assertIn('RoHS', printed)
        self.assertIn('MSL: LEVEL2', printed)
        self.assertNotIn('01-A0162', printed)
        self.assertNotIn('3001-250721001', printed)
        self.assertFalse(any('QC' in item or 'PASS' in item for item in printed))

    def test_five_code128_fields_round_trip_and_keep_two_dot_modules(self):
        commands, _captured = capture_label(make_record())
        barcodes = re.findall(rb'BARCODE (\d+),(\d+),"128M",(\d+),0,0,2,2,"([^"]*)"', commands)
        self.assertEqual(len(barcodes), 5)
        values = ['Pai8485E-W1R', 'A552588.1', '2528HE', '1500', '2507260140109']
        self.assertEqual([decode_manual_content(content.decode('ascii'))[0] for _x, _y, _height, content in barcodes], values)
        for (x, y, height, _content), value in zip(barcodes, values):
            self.assertGreaterEqual(int(x), 20)
            self.assertLessEqual(int(x) + get_reprint_barcode_width(value, 2), 540)
            self.assertLessEqual(int(y) + int(height), 380)

    def test_missing_required_and_unsafe_fields_fail_without_truncation(self):
        for key in ('model', 'trace_no'):
            with self.subTest(field=key), self.assertRaisesRegex(ValueError, rongpai._FIELD_NAMES[key]):
                capture_label(make_record(**{key: ''}))
        for key, name in rongpai._FIELD_NAMES.items():
            for value in ('A;B', 'A\rB', 'A\nB', 'A\tB', 'A\x00B', 'A"B', '中文'):
                with self.subTest(field=key, value=value), self.assertRaisesRegex(ValueError, re.escape(name)):
                    capture_label(make_record(**{key: value}))
        for key in ('model', 'batch', 'production_date', 'trace_no', 'version'):
            with self.subTest(field=key), self.assertRaisesRegex(ValueError, rongpai._FIELD_NAMES[key]):
                capture_label(make_record(**{key: 'W' * 90}))

    def test_actual_ink_groups_each_text_with_its_barcode_and_spaces_the_next_field(self):
        commands = label_templates.build_native_label(
            make_record(), label_templates.NATIVE_LABEL_TEMPLATE_RONGPAI,
        )
        text_layer = raster_from_commands(commands)
        barcodes = re.findall(rb'BARCODE (\d+),(\d+),"128M",(\d+),0,0,2,2,"[^"]*"', commands)
        self.assertEqual(len(barcodes), 5)
        text_tops = []
        for index, (_x, barcode_y, _height) in enumerate(barcodes):
            row_y, barcode_y = 60 + index * 64, int(barcode_y)
            ink = text_layer.crop((24, row_y, 540, barcode_y)).getbbox()
            self.assertIsNotNone(ink)
            text_tops.append(row_y + ink[1])
            text_bottom = row_y + ink[3]
            # Measure the actual raster rather than assuming an Arial glyph height.
            self.assertGreaterEqual(barcode_y - text_bottom, 3)
            self.assertLessEqual(barcode_y - text_bottom, 5)
        for index, (_x, barcode_y, height) in enumerate(barcodes[:-1]):
            gap_to_next_field = text_tops[index + 1] - (int(barcode_y) + int(height))
            self.assertGreaterEqual(gap_to_next_field, 12)

    def test_actual_raster_keeps_the_complete_qr_and_four_module_quiet_zone(self):
        for quantity, trace, source in (('1500', '2507260140109', SAMPLE_QR),
                                        ('200', '2507260140109-1', None),
                                        ('1300', '2507260140109-2', None)):
            qr_images = []

            def capture_qr(*args, **kwargs):
                result = build_reprint_qr_image(*args, **kwargs)
                qr_images.append(result)
                return result

            with self.subTest(quantity=quantity), patch.object(rongpai, 'build_reprint_qr_image', side_effect=capture_qr):
                commands = label_templates.build_native_label(
                    make_record(quantity=quantity, trace_no=trace),
                    label_templates.NATIVE_LABEL_TEMPLATE_RONGPAI, source_qr=source,
                )
            [qr] = qr_images
            raster = raster_from_commands(commands)
            crop = raster.crop((qr.x, qr.y, qr.quiet_right, qr.quiet_bottom))
            self.assertEqual(crop.tobytes(), qr.image.tobytes())
            self.assertGreaterEqual(qr.cell_dots, 3)
            self.assertGreaterEqual(qr.x, 552)
            self.assertLessEqual(qr.quiet_bottom, 344)
            quiet, side = qr.cell_dots * 4, qr.image.width
            for bounds in ((0, 0, side, quiet), (0, side - quiet, side, side),
                           (0, 0, quiet, side), (side - quiet, 0, side, side)):
                self.assertIsNone(crop.crop(bounds).getbbox())


if __name__ == '__main__':
    unittest.main()
