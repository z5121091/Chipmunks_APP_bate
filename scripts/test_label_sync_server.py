import unittest
from unittest.mock import patch

from openpyxl import Workbook

from scripts import label_sync_server
from scripts import label_templates
from scripts.label_templates import apm, boya


class NativeLabelWithoutTraceTest(unittest.TestCase):
    def test_empty_trace_keeps_printing_without_trace_barcode(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.append([
            '型号', '标签数量', '追溯码', '批次', '生产日期', '封装',
            '存货编码', '箱号', '版本号', '标签类型', '供应商',
        ])
        sheet.append([
            'A', 960, '', 'LOT-1', '20260411', 'SOT223',
            'PN-1', 'BOX-1', '', '剩余标签', '珠海领芯科技有限公司',
        ])

        [record] = label_sync_server.get_native_label_records(workbook)
        captured_text_items = []

        def capture_text_bitmap(text_items, image_items=(), **_options):
            captured_text_items.extend(text_items)
            return b'BITMAP\r\n'

        with patch.object(
            apm,
            'build_native_text_bitmap',
            side_effect=capture_text_bitmap,
        ):
            commands = apm.build_native_apm_label(
                record,
                label_templates.NATIVE_LABEL_TEMPLATE_LEADCORE,
            )

        self.assertEqual(record['trace_no'], '')
        self.assertIn(
            (label_templates.NATIVE_LABEL_RIGHT_VALUE_X, 242, '-', False),
            captured_text_items,
        )
        self.assertNotIn(b'BARCODE 350,268', commands)
        self.assertIn(b'"A/LOT-1/SOT223/PN-1/960/20260411//BOX-1"', commands)

        record['trace_no'] = 'TRACE-1'
        with patch.object(apm, 'build_native_text_bitmap', return_value=b'BITMAP\r\n'):
            commands = apm.build_native_apm_label(
                record,
                label_templates.NATIVE_LABEL_TEMPLATE_LEADCORE,
            )

        self.assertIn(b'BARCODE 350,268', commands)
        self.assertIn(b'"A/LOT-1/SOT223/PN-1/960/20260411/TRACE-1/BOX-1"', commands)

    def test_boya_supplier_uses_its_own_layout(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.append([
            '型号', '标签数量', '追溯码', '批次', '生产日期', '封装',
            '存货编码', '箱号', '版本号', '标签类型', '供应商',
        ])
        sheet.append([
            'BY25Q128ESSIG(R)', 1255, '', 'AP5P001', '2617', 'SOP8L(208mil)',
            'BY25Q128', 'BOX-1', '', '剩余标签', '珠海博雅科技股份有限公司',
        ])

        [record] = label_sync_server.get_native_label_records(workbook)
        template = label_sync_server.get_native_label_template(record)
        captured = {}

        def capture_text_bitmap(
            text_items,
            image_items=(),
            ellipse_items=(),
            line_items=(),
        ):
            captured['text_items'] = text_items
            captured['image_items'] = image_items
            captured['ellipse_items'] = ellipse_items
            captured['line_items'] = line_items
            return b'BITMAP\r\n'

        with patch.object(
            boya,
            'build_native_text_bitmap',
            side_effect=capture_text_bitmap,
        ):
            commands = label_sync_server.build_native_label(record, template)

        self.assertEqual(template, label_templates.NATIVE_LABEL_TEMPLATE_BOYA)
        self.assertEqual(
            {
                key: record[key]
                for key in ('model', 'package', 'quantity', 'batch', 'production_date', 'source_no')
            },
            {
                'model': 'BY25Q128ESSIG(R)',
                'package': 'SOP8L(208mil)',
                'quantity': '1255',
                'batch': 'AP5P001',
                'production_date': '2617',
                'source_no': 'BOX-1',
            },
        )
        header = 'BOYA MICROELECTRONICS'
        self.assertIn(
            (
                label_templates.get_native_centered_text_x(
                    header,
                    size_pixels=label_templates.NATIVE_LABEL_BOYA_HEADER_FONT_SIZE_PIXELS,
                ),
                28,
                header,
                False,
                label_templates.NATIVE_LABEL_BOYA_HEADER_FONT_SIZE_PIXELS,
            ),
            captured['text_items'],
        )
        self.assertIn((210, 330, 'BOX-1', False), captured['text_items'])
        self.assertIn((701, 122, 'RoHS', True), captured['text_items'])
        self.assertNotIn('PASS', {item[2] for item in captured['text_items']})
        self.assertNotIn('QC03', {item[2] for item in captured['text_items']})
        self.assertEqual(len(captured['image_items']), 1)
        self.assertEqual(captured['ellipse_items'], (((694, 92, 770, 168), 3),))
        self.assertEqual(captured['line_items'], ())
        self.assertNotIn(b'BARCODE ', commands)
        self.assertIn(b'QRCODE 610,190,L,6', commands)
        self.assertIn(
            b'"BY25Q128ESSIG(R)/SOP8L(208mil)/1255/AP5P001/2617/BOX-1"',
            commands,
        )
        self.assertIn(b'PRINT 1,2', commands)


if __name__ == '__main__':
    unittest.main()
