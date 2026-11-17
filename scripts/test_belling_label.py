"""Verify the Belling print payload and date conversion without spooling jobs."""

import unittest
from unittest.mock import patch

from scripts.label_templates import belling, build_native_label, get_native_label_template


SAMPLE_QR = 'BL0942||SSOP-10L||3000||2642||D85637ABPP||FPD85004SLC||HY111426R00218'
SAMPLE_RECORD = {
    'supplier': '上海贝岭股份有限公司',
    'model': 'BL0942', 'package': 'SSOP-10L', 'quantity': '3000', 'production_date': '2642',
    'batch': 'D85637ABPP', 'source_no': 'FPD85004SLC', 'trace_no': 'HY111426R00218',
}


class BellingLabelTest(unittest.TestCase):
    def capture_render(self, record, source_qr=None):
        with patch.object(belling, 'build_reprint_qr_image', wraps=belling.build_reprint_qr_image) as qr, \
                patch.object(belling, 'build_native_text_bitmap', wraps=belling.build_native_text_bitmap) as bitmap:
            commands = build_native_label(record, get_native_label_template(record), source_qr)
        return commands, qr.call_args.args[0], bitmap.call_args.args[0]

    def test_reprint_keeps_exact_qr_and_uses_original_layout(self):
        source = SAMPLE_QR.replace('||3000||', '|| 03000 ||') + '\r\n'
        commands, payload, items = self.capture_render(SAMPLE_RECORD, source)
        self.assertEqual(payload, source)
        self.assertTrue(commands.startswith(b'SIZE 100 mm,50 mm\r\n'))
        self.assertTrue(commands.endswith(b'PRINT 1,2\r\n'))
        self.assertIn(b'BITMAP 0,0,100,400,0,', commands)
        self.assertNotIn(b'QRCODE ', commands)
        text = [item[2] for item in items]
        self.assertEqual(text, [
            'PROD:', 'BL0942', 'PKG:', 'SSOP-10L', 'QTY:', '03000', 'D/C:', '2642',
            'BS Date:', '10-12-2026', 'LOT ID:', 'D85637ABPP/FPD85004SLC', 'ATL:',
            'HY111426R00218', 'MSL3', 'MADE IN CHINA', 'H.F', 'RoHS',
        ])

    def test_split_reconstructs_seven_fields_with_each_childs_quantity_and_trace(self):
        for quantity, suffix in [('200', '-1'), ('2800', '-2')]:
            with self.subTest(quantity=quantity):
                trace = SAMPLE_RECORD['trace_no'] + suffix
                record = dict(SAMPLE_RECORD, quantity=quantity, trace_no=trace)
                _commands, payload, items = self.capture_render(record)
                self.assertEqual(payload.split('||'), [
                    'BL0942', 'SSOP-10L', quantity, '2642', 'D85637ABPP', 'FPD85004SLC', trace,
                ])
                self.assertIn(trace, [item[2] for item in items])

    def test_week_date_changes_with_the_qr_week_and_supports_iso_year_boundaries(self):
        for week, expected in [('2645', '11-02-2026'), ('2601', '12-29-2025'), ('2653', '12-28-2026')]:
            with self.subTest(week=week):
                _commands, payload, items = self.capture_render(dict(SAMPLE_RECORD, production_date=week))
                self.assertEqual(payload.split('||')[3], week)
                dates = {item[2]: item[1] for item in items if item[2] in {week, expected}}
                self.assertEqual(set(dates), {week, expected})
                self.assertGreater(dates[expected], dates[week])

    def test_invalid_or_conflicting_qr_is_rejected_before_rendering(self):
        invalid_inputs = [
            (dict(SAMPLE_RECORD, production_date='2553'), None, '生产周'),
            (dict(SAMPLE_RECORD, production_date='2600'), None, '生产周'),
            (dict(SAMPLE_RECORD, quantity='12.5'), None, '数量'),
            (SAMPLE_RECORD, SAMPLE_QR.replace('||', '|'), '七个双竖线'),
            (SAMPLE_RECORD, SAMPLE_QR + '||EXTRA', '七个双竖线'),
            (SAMPLE_RECORD, SAMPLE_QR.replace('||2642||', '||2645||'), '生产日期'),
            (SAMPLE_RECORD, SAMPLE_QR.replace('||FPD85004SLC||', '||OTHER||'), '箱号'),
            (SAMPLE_RECORD, SAMPLE_QR.replace('||D85637ABPP||', '||||'), '七个双竖线'),
        ]
        for record, source, message in invalid_inputs:
            with self.subTest(record=record, source=source), patch.object(belling, 'build_reprint_qr_image') as qr:
                with self.assertRaisesRegex(ValueError, message):
                    build_native_label(record, get_native_label_template(record), source)
                qr.assert_not_called()
