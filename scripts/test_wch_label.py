"""WCH data routing and printable-content checks; never access a printer."""

import re
import unittest
from unittest.mock import patch

from openpyxl import Workbook
import qrcode
from qrcode.constants import ERROR_CORRECT_L
from qrcode.util import MODE_8BIT_BYTE, QRData

from scripts.label_templates import (
    NATIVE_LABEL_TEMPLATE_WCH,
    build_native_label,
    get_native_label_records,
    get_native_label_template,
)
from scripts.label_templates import wch
from scripts.label_templates.common import get_native_arial_font


SUPPLIER = '南京沁恒微电子股份有限公司'


def make_record(**changes):
    record = {
        'model': 'CH32V203C8T6',
        'version': 'V1.0',
        'package': 'LQFP48',
        'batch': 'LOT2607',
        'quantity': '2300',
        'production_date': '2638',
        'trace_no': 'WCH2607001-2',
        'inventory_code': 'IC.00000537.01',
        'source_no': 'BOX10',
        'supplier': SUPPLIER,
        'label_type': '剩余标签',
    }
    record.update(changes)
    return record


def make_workbook():
    workbook = Workbook()
    sheet = workbook.active
    sheet.append([
        '供应商', '型号', '版本号', '封装', '批次', '标签数量',
        '生产日期', '追溯码', '存货编码', '箱号', '标签类型',
    ])
    sheet.append([
        SUPPLIER, 'CH32V203C8T6', 'V1.0', 'LQFP48', 'LOT2607', 2300,
        '2638', 'WCH2607001-2', 'IC.00000537.01', 'BOX10', '剩余标签',
    ])
    return workbook


def build_and_capture(record):
    captured = {}

    def bitmap(text_items, image_items=(), **_options):
        captured['text'] = text_items
        captured['images'] = image_items
        return b'BITMAP-CAPTURE\r\n'

    with patch.object(wch, 'build_native_text_bitmap', side_effect=bitmap):
        result = build_native_label(record, NATIVE_LABEL_TEMPLATE_WCH)
    match = re.search(
        rb'QRCODE (\d+),(\d+),L,(\d+),A,0,J2,M2,S7,"([^"\r\n]*)"',
        result,
    )
    if not match:
        raise AssertionError('WCH print job does not contain one valid QR command')
    captured['qr'] = tuple(int(match.group(i)) for i in (1, 2, 3))
    captured['payload'] = match.group(4).decode('ascii')
    return result, captured


def record_for_payload_length(length):
    # Narrow glyphs allow long but still printable individual fields, so the
    # QR capacity tests exercise a real complete label rather than only a helper.
    record = make_record(
        model='i', quantity='1', version='', package='', batch='',
        production_date='', trace_no='i',
    )
    remaining = length - 19  # three required chars, fixed values and eight commas
    if remaining < 0:
        raise ValueError('Requested payload is shorter than the minimum')
    for key, room in (
        ('model', 59), ('version', 60), ('package', 60), ('batch', 60),
        ('production_date', 60), ('trace_no', 60),
    ):
        added = min(remaining, room)
        record[key] += 'i' * added
        remaining -= added
    if remaining:
        raise ValueError('Requested payload does not fit test fields')
    return record


class WchLabelTest(unittest.TestCase):
    def test_complete_excel_routes_to_exact_supplier_and_preserves_fields(self):
        [record] = get_native_label_records(make_workbook())
        self.assertEqual(record, make_record(unpacked_at=''))
        self.assertIs(get_native_label_template(record), NATIVE_LABEL_TEMPLATE_WCH)
        result, captured = build_and_capture(record)
        self.assertEqual(
            captured['payload'],
            'CH32V203C8T6,V1.0,---,LQFP48,LOT2607,2300,2638,China,WCH2607001-2',
        )
        self.assertEqual(len(captured['payload'].split(',')), 9)
        self.assertEqual(result.count(b'QRCODE '), 1)
        self.assertIn(b'PRINT 1,2\r\n', result)
        self.assertEqual(len(captured['text']), 17)  # eight captions/values + trace
        self.assertEqual(
            [item[2] for item in captured['text'][:-1:2]],
            ['Part No:', 'item No:', 'Code NO:', 'Package:', 'LOT NO:', 'QTY:', 'DATE:', 'Origin:'],
        )
        self.assertEqual(
            [item[2] for item in captured['text'][1:-1:2]],
            ['CH32V203C8T6', 'V1.0', '---', 'LQFP48', 'LOT2607', '2300', '2638', 'China'],
        )
        self.assertEqual(captured['text'][-1][2], 'WCH2607001-2')
        trace = captured['text'][-1]
        trace_width = get_native_arial_font(size_pixels=23).getlength(trace[2])
        self.assertAlmostEqual(trace[0] + trace_width / 2, captured['qr'][0], delta=0.5)

    def test_unrecognized_supplier_never_selects_wch_by_substring(self):
        for supplier in ('沁恒', 'WCH', '南京沁恒微电子有限公司', '', SUPPLIER + '分公司'):
            with self.subTest(supplier=supplier):
                self.assertIsNone(get_native_label_template(make_record(supplier=supplier)))
        self.assertIs(
            get_native_label_template(make_record(supplier='  ' + SUPPLIER + '  ')),
            NATIVE_LABEL_TEMPLATE_WCH,
        )

    def test_empty_optional_fields_stay_in_their_nine_qr_positions(self):
        _result, captured = build_and_capture(make_record(
            version='', package='', batch='', production_date='',
        ))
        self.assertEqual(
            captured['payload'], 'CH32V203C8T6,,---,,,2300,,China,WCH2607001-2',
        )
        self.assertEqual(len(captured['payload'].split(',')), 9)
        self.assertEqual(captured['payload'].split(',')[-1], 'WCH2607001-2')
        self.assertFalse(captured['payload'].endswith(','))
        self.assertNotIn('BOX10', captured['payload'])
        self.assertNotIn('IC.00000537.01', captured['payload'])

    def test_missing_wch_trace_is_rejected_instead_of_invented(self):
        for trace in ('', None, '   '):
            with self.subTest(trace=trace), self.assertRaisesRegex(ValueError, 'trace_no'):
                build_and_capture(make_record(trace_no=trace))

    def test_separator_quotes_controls_and_non_ascii_are_rejected(self):
        for field in ('model', 'version', 'package', 'batch', 'quantity', 'production_date', 'trace_no'):
            for value in ('ABC,DEF', 'ABC\nDEF', 'ABC\rDEF', 'ABC\tDEF', 'ABC"DEF', 'ABC\x00DEF', '型号'):
                with self.subTest(field=field, value=value):
                    with self.assertRaises(ValueError):
                        build_and_capture(make_record(**{field: value}))

    def test_all_text_keeps_fixed_eight_point_arial(self):
        model = 'W' * 14
        _result, captured = build_and_capture(make_record(model=model))
        value_item = captured['text'][1]
        self.assertEqual(value_item[2], model)
        self.assertEqual(captured['payload'].split(',')[0], model)
        for item in captured['text']:
            sizes = item[4:]
            self.assertEqual(sizes[0] if sizes else 23, 23)
        font = get_native_arial_font(size_pixels=23)
        self.assertLessEqual(value_item[0] + font.getlength(model), 480)

    def test_model_cannot_shrink_to_fit_a_fixed_font_label(self):
        record = make_record(model='W' * 19)
        with self.assertRaisesRegex(ValueError, '内容过长'):
            build_and_capture(record)
        self.assertEqual(record['model'], 'W' * 19)

    def test_user_sample_retains_exact_payload_without_a_trailing_separator(self):
        _result, captured = build_and_capture(make_record(
            model='CH334U', version='31317.TB', package='QSOP28', batch='313174G25',
            quantity='2500', production_date='20260923', trace_no='W52609160004006-1',
        ))
        self.assertEqual(
            captured['payload'],
            'CH334U,31317.TB,---,QSOP28,313174G25,2500,20260923,China,W52609160004006-1',
        )
        self.assertEqual(captured['payload'].count(','), 8)
        self.assertFalse(captured['payload'].endswith(','))

    def test_trace_uses_qr_center_for_different_text_widths(self):
        for trace in ('A', 'WCH2607001-2', 'W52609160004006-1'):
            with self.subTest(trace=trace):
                _result, captured = build_and_capture(make_record(trace_no=trace))
                trace_item = captured['text'][-1]
                width = get_native_arial_font(size_pixels=23).getlength(trace)
                self.assertAlmostEqual(
                    trace_item[0] + width / 2, captured['qr'][0], delta=0.5,
                )

    def test_logo_fits_twenty_by_five_millimetre_box_without_distortion(self):
        from PIL import Image

        _result, captured = build_and_capture(make_record())
        [(logo, position)] = captured['images']
        self.assertLessEqual(logo.width, 160)
        self.assertLessEqual(logo.height, 40)
        self.assertAlmostEqual(position[0] + logo.width / 2, captured['qr'][0], delta=0.5)
        with Image.open('scripts/assets/wch-logo.png') as source:
            source_ratio = source.width / source.height
        self.assertAlmostEqual(logo.width / logo.height, source_ratio, delta=0.03)

    def test_unprintably_long_model_and_trace_are_rejected_not_truncated(self):
        for field in ('model', 'trace_no'):
            record = make_record(**{field: 'W' * 80})
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, '内容过长'):
                build_and_capture(record)
            self.assertEqual(record[field], 'W' * 80)

    def test_qr_all_capacity_boundaries_have_full_payload_and_clear_quiet_zone(self):
        for length, expected_cell in (
            (78, 6), (79, 5), (134, 5), (135, 4),
            (192, 4), (193, 3), (367, 3),
        ):
            with self.subTest(length=length):
                _result, captured = build_and_capture(record_for_payload_length(length))
                payload = captured['payload']
                self.assertEqual(len(payload.encode('ascii')), length)
                x, y, cell = captured['qr']
                self.assertEqual(cell, expected_cell)
                qr = qrcode.QRCode(error_correction=ERROR_CORRECT_L, border=4)
                qr.add_data(QRData(payload.encode('ascii'), mode=MODE_8BIT_BYTE), optimize=0)
                qr.make(fit=True)
                # Calculate from a real byte-mode QR, not a guessed fixed symbol.
                half_symbol_width = qr.modules_count * cell / 2
                quiet_left = x - half_symbol_width - 4 * cell
                quiet_top = y - 4 * cell
                quiet_right = x + half_symbol_width + 4 * cell
                quiet_bottom = y + (qr.modules_count + 4) * cell
                self.assertGreaterEqual(quiet_left, 0)
                self.assertLessEqual(quiet_right, 800)
                self.assertGreaterEqual(quiet_top, 0)
                self.assertLessEqual(quiet_bottom, 400)
                for item in captured['text'][:-1]:
                    ix, _iy, text, _bold, *sizes = item
                    font = get_native_arial_font(size_pixels=sizes[0] if sizes else 23)
                    self.assertLessEqual(ix + font.getlength(text), quiet_left)
                trace = captured['text'][-1]
                self.assertGreater(trace[1], quiet_bottom)
                trace_font = get_native_arial_font(size_pixels=23)
                self.assertAlmostEqual(
                    trace[0] + trace_font.getlength(trace[2]) / 2, x, delta=0.5,
                )
                for image, (ix, iy) in captured['images']:
                    self.assertLessEqual(iy + image.height, quiet_top)
                    self.assertGreaterEqual(ix, 0)
                    self.assertLessEqual(ix + image.width, 800)

    def test_payload_over_maximum_is_rejected_without_truncation(self):
        record = record_for_payload_length(368)
        with self.assertRaisesRegex(ValueError, '二维码内容过长'):
            build_and_capture(record)


if __name__ == '__main__':
    unittest.main()
