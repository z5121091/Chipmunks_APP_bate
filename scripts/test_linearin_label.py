"""LINEARIN field, QR and final printer-raster checks; no physical printing."""

import copy
import re
import unittest
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook
from PIL import Image, ImageDraw

from scripts import label_templates
from scripts import label_sync_server as server
from scripts.label_templates import linearin
from scripts.label_templates.common import build_reprint_qr_image, get_native_arial_font


SUPPLIER = '上海先积集成电路有限公司'
SAMPLE_QR = ('P/N:LTA8292XS8/R8\rPKG:SOIC-8L\rQTY:4000\r'
             'D/C:J-L14\rLOT:231012PJ\rDATE:17-04-2023')
FIELDS = ('model', 'package', 'quantity', 'version', 'batch', 'production_date')
PREFIXES = ('P/N:', 'PKG:', 'QTY:', 'D/C:', 'LOT:', 'DATE:')
NAMES = ('型号', '封装', '数量', '版本号', '批次', '生产日期')


def make_record(**changes):
    record = dict(supplier=SUPPLIER, model='LTA8292XS8/R8', package='SOIC-8L',
                  quantity='4000', version='J-L14', batch='231012PJ',
                  production_date='17-04-2023', trace_no='', source_no='')
    record.update(changes)
    return record


def capture_label(record, source_qr=None, real_raster=False):
    captured = {}

    def bitmap(text_items, image_items=(), **options):
        captured.update(text=list(text_items), images=list(image_items), options=options)
        if real_raster:
            return label_templates.build_native_text_bitmap(text_items, image_items, **options)
        return b'CAPTURE\r\n'

    def qr(*args, **kwargs):
        captured['payload'] = args[0]
        captured['qr'] = build_reprint_qr_image(*args, **kwargs)
        return captured['qr']

    with patch.object(linearin, 'build_native_text_bitmap', side_effect=bitmap), \
            patch.object(linearin, 'build_reprint_qr_image', side_effect=qr):
        commands = label_templates.build_native_label(
            record, label_templates.NATIVE_LABEL_TEMPLATE_LINEARIN, source_qr=source_qr,
        )
    return commands, captured


def ink_bounds(item):
    x, y, text, bold, size = item
    image = Image.new('1', (800, 400), 0)
    ImageDraw.Draw(image).text((x, y), text, anchor='lt', fill=1,
                              font=get_native_arial_font(bold=bold, size_pixels=size))
    return image.getbbox()


class LinearinLabelTest(unittest.TestCase):
    def test_only_exact_supplier_name_selects_new_template(self):
        for supplier in (SUPPLIER, ' ' + SUPPLIER + ' '):
            self.assertIs(label_templates.get_native_label_template(make_record(supplier=supplier)),
                          label_templates.NATIVE_LABEL_TEMPLATE_LINEARIN)
        for supplier in ('先积', '上海*先积*集成电路有限公司', SUPPLIER + '分公司', ''):
            with self.subTest(supplier=supplier):
                self.assertIsNone(label_templates.get_native_label_template(make_record(supplier=supplier)))

    def test_existing_excel_columns_route_a_package_without_trace(self):
        workbook = Workbook()
        workbook.active.append(['供应商', '型号', '封装', '标签数量', '版本号', '批次', '生产日期', '追溯码'])
        workbook.active.append([SUPPLIER, 'LTA8292XS8/R8', 'SOIC-8L', 4000, 'J-L14',
                                '231012PJ', '17-04-2023', ''])
        [record] = label_templates.get_native_label_records(workbook)
        _commands, captured = capture_label(record)
        self.assertEqual(captured['payload'], SAMPLE_QR)

    def test_user_sample_uses_five_carriage_returns_and_all_six_fixed_prefixes(self):
        commands, captured = capture_label(make_record())
        self.assertEqual(captured['payload'].encode('ascii'), SAMPLE_QR.encode('ascii'))
        self.assertEqual(captured['payload'].count('\r'), 5)
        self.assertNotIn('\n', captured['payload'])
        self.assertNotIn('\\', captured['payload'])
        self.assertIn('P/N:LTA8292XS8/R8\r', captured['payload'])
        rows = [item for item in captured['text'] if item[0] == 112]
        self.assertEqual([item[2] for item in rows], [make_record()[key] for key in FIELDS])
        self.assertEqual([item[1] for item in rows], [150, 190, 230, 270, 310, 350])
        self.assertTrue(commands.startswith(b'SIZE 100 mm,50 mm\r\n'))
        self.assertTrue(commands.endswith(b'PRINT 1,2\r\n'))
        self.assertNotIn(b'QRCODE ', commands)
        self.assertNotIn(b'BARCODE ', commands)

    def test_unpack_outbound_and_remaining_quantities_match_printed_text_and_qr(self):
        for quantity in ('200', '3800'):
            with self.subTest(quantity=quantity):
                record = make_record(quantity=quantity)
                before = copy.deepcopy(record)
                _commands, captured = capture_label(record)
                self.assertEqual(captured['payload'], SAMPLE_QR.replace('QTY:4000\r', f'QTY:{quantity}\r'))
                self.assertIn((112, 230, quantity, False), captured['text'])
                self.assertEqual(record, before)

    def test_reprint_preserves_cr_lf_crlf_and_optional_terminal_line_break(self):
        for separator in ('\r', '\n', '\r\n'):
            for terminal in ('', separator):
                raw = SAMPLE_QR.replace('\r', separator) + terminal
                with self.subTest(separator=repr(separator), terminal=repr(terminal)):
                    _commands, captured = capture_label(make_record(), source_qr=raw)
                    self.assertEqual(captured['payload'].encode('ascii'), raw.encode('ascii'))

    def test_numeric_quantity_equivalence_preserves_original_quantity_spelling_on_reprint(self):
        raw = SAMPLE_QR.replace('QTY:4000\r', 'QTY:04000\r')
        _commands, captured = capture_label(make_record(quantity='4000.0'), source_qr=raw)
        self.assertEqual(captured['payload'], raw)
        self.assertIn((112, 230, '04000', False), captured['text'])
        _commands, captured = capture_label(make_record(quantity='4000.0'))
        self.assertEqual(captured['payload'], SAMPLE_QR)

    def test_optional_empty_fields_keep_their_prefix_and_position(self):
        record = make_record(package='', version='', batch='', production_date='')
        raw = 'P/N:LTA8292XS8/R8\rPKG:\rQTY:4000\rD/C:\rLOT:\rDATE:'
        for source in (None, raw):
            with self.subTest(source=source):
                _commands, captured = capture_label(record, source_qr=source)
                self.assertEqual(captured['payload'], raw)
                self.assertEqual(sum(item[2] == '-' for item in captured['text']), 4)

    def test_each_mapped_field_mismatch_reports_the_actual_field(self):
        for key, name in zip(FIELDS, NAMES):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, name):
                capture_label(make_record(**{key: '3999' if key == 'quantity' else 'OTHER'}), SAMPLE_QR)

    def test_wrong_prefix_or_swapped_line_reports_expected_position_without_echoing_raw(self):
        for index, prefix in enumerate(PREFIXES):
            lines = SAMPLE_QR.split('\r')
            lines[index] = 'SECRET:' + lines[index][len(prefix):]
            with self.subTest(index=index), self.assertRaisesRegex(
                ValueError, rf'第{index + 1}行应以{re.escape(prefix)}开头',
            ) as error:
                capture_label(make_record(), '\r'.join(lines))
            self.assertNotIn('SECRET', str(error.exception))
            self.assertEqual(server.get_safe_reprint_template_error(error.exception), str(error.exception))
        lines = SAMPLE_QR.split('\r')
        lines[3], lines[4] = lines[4], lines[3]
        with self.assertRaisesRegex(ValueError, '第4行应以D/C:开头'):
            capture_label(make_record(), '\r'.join(lines))

    def test_missing_extra_and_literal_backslash_lines_are_rejected(self):
        for raw in (SAMPLE_QR.rsplit('\r', 1)[0], SAMPLE_QR + '\rEXTRA:1',
                    SAMPLE_QR.replace('\r', '\\'), SAMPLE_QR.replace('\r', '\r\r')):
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, '六个字段'):
                capture_label(make_record(), raw)

    def test_invalid_quantities_and_missing_model_stop_before_building_qr(self):
        for quantity in ('', '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'):
            with self.subTest(quantity=quantity), patch.object(linearin, 'build_reprint_qr_image') as qr:
                with self.assertRaisesRegex(ValueError, '数量'):
                    capture_label(make_record(quantity=quantity))
                qr.assert_not_called()
        with self.assertRaisesRegex(ValueError, '型号'):
            capture_label(make_record(model=''))

    def test_unsafe_characters_in_fields_are_named_and_not_silently_removed(self):
        for key, name in zip(FIELDS, NAMES):
            for unsafe in ('A\rB', 'A\nB', '\rA', 'A\r', 'A\tB', 'A\x00B', 'A"B', '中文'):
                with self.subTest(key=key, unsafe=repr(unsafe)), self.assertRaisesRegex(ValueError, name):
                    capture_label(make_record(**{key: unsafe}))

    def test_overlong_values_report_the_field_instead_of_shrinking_or_truncating(self):
        for key, name in zip(FIELDS, NAMES):
            if key == 'quantity':
                continue
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, name + '文字超出模板宽度'):
                capture_label(make_record(**{key: 'W' * 90}))

    def test_larger_pb_and_gp_and_two_line_rohs_are_centered_using_real_ink(self):
        _commands, captured = capture_label(make_record())
        [pb] = [image for image, xy in captured['images'] if xy == (466, 24)]
        self.assertEqual(pb.width, 84)
        self.assertLessEqual(24 + pb.height, 110)
        gp = next(item for item in captured['text'] if item[2] == 'GP')
        self.assertEqual(gp[4], 36)
        left, top, right, bottom = ink_bounds(gp)
        self.assertLessEqual(abs((left + right) / 2 - 608), 0.5)
        self.assertLessEqual(abs((top + bottom) / 2 - 66), 0.5)
        rohs = [ink_bounds(item) for item in captured['text'] if item[2] in ('RoHS', 'COMPLIANT')]
        for left, top, right, bottom in rohs:
            self.assertLessEqual(abs((left + right) / 2 - 719), 0.5)
            self.assertGreater(left, 667)
            self.assertLess(right, 771)
            self.assertGreater(top, 29)
            self.assertLess(bottom, 103)
        self.assertLessEqual(abs((min(row[1] for row in rohs) + max(row[3] for row in rohs)) / 2 - 66), 0.5)

    def test_print_logo_is_monochrome_english_artwork_without_transparent_padding(self):
        _commands, captured = capture_label(make_record())
        [logo] = [image for image, xy in captured['images'] if xy == (24, 24)]
        self.assertEqual(logo.mode, '1')
        self.assertEqual(logo.getbbox(), (0, 0, logo.width, logo.height))
        self.assertGreater(logo.width / logo.height, 6)
        self.assertLessEqual(24 + logo.width, 450)
        self.assertLessEqual(24 + logo.height, 100)
        with Image.open(Path(__file__).parent / 'assets' / 'linearin-logo.png') as source:
            self.assertEqual(source.mode, 'RGBA')
            self.assertEqual(source.getchannel('A').getextrema(), (0, 255))

    def test_actual_final_raster_preserves_qr_and_quiet_zone_without_overlap(self):
        for quantity, source in (('4000', None), ('200', None), ('3800', None),
                                 ('4000', SAMPLE_QR), ('4000', SAMPLE_QR.replace('\r', '\r\n'))):
            with self.subTest(quantity=quantity, source=source):
                commands, captured = capture_label(make_record(quantity=quantity), source, real_raster=True)
                start = commands.index(b'BITMAP 0,0,100,400,0,') + len(b'BITMAP 0,0,100,400,0,')
                raster = Image.frombytes('1', (800, 400), bytes(byte ^ 255 for byte in commands[start:start + 40000]))
                qr = captured['qr']
                crop = raster.crop((qr.x, qr.y, qr.quiet_right, qr.quiet_bottom))
                self.assertEqual(crop.tobytes(), qr.image.tobytes())
                self.assertGreaterEqual(qr.cell_dots, 3)
                self.assertGreaterEqual(qr.x, 552)
                self.assertGreaterEqual(qr.y, 148)
                self.assertLessEqual(qr.quiet_right, 792)
                self.assertLessEqual(qr.quiet_bottom, 392)
                quiet, side = qr.cell_dots * 4, qr.image.width
                for bounds in ((0, 0, side, quiet), (0, side - quiet, side, side),
                               (0, 0, quiet, side), (side - quiet, 0, side, side)):
                    self.assertIsNone(crop.crop(bounds).getbbox())

    def test_diagnostics_remain_specific_and_missing_logo_names_the_new_resource(self):
        for error in (ValueError('先积原始二维码须包含完整的六行字段'),
                      ValueError('先积标签缺少型号'), ValueError('先积标签数量须为有效的正整数'),
                      ValueError('先积原始二维码版本号与解析结果不一致，请核对该字段和解析规则')):
            self.assertEqual(server.get_safe_reprint_template_error(error), str(error))
        message = server.get_safe_reprint_template_error(RuntimeError('未找到标签图片文件：D:/assets/linearin-logo.png'))
        self.assertIn('先积Logo', message)
        self.assertNotIn('SECRET', server.get_safe_reprint_template_error(ValueError('SECRET')))

    def test_reprint_api_rejects_prefix_mismatch_without_spooling_or_recording_business_data(self):
        raw = SAMPLE_QR.replace('LOT:', 'SECRET:')
        record = make_record(source_qr=raw)
        with patch.object(server, 'EPHEMERAL_REPRINT_JOBS', {}), \
                patch.object(server, 'send_raw_tspl_to_printer') as spool, \
                patch.object(server, 'log') as log, \
                patch.object(server, 'save_native_print_history') as history:
            receipt = server.submit_native_label_reprint(dict(
                record=record, print_job_id='LINEARIN-PREFIX',
                reprint_session_id=server.LABEL_REPRINT_SESSION_ID,
            ))
            self.assertFalse(receipt['success'])
            self.assertEqual(receipt['code'], 'INVALID_LABEL_CONTENT')
            self.assertIn('第5行应以LOT:开头', receipt['message'])
            self.assertNotIn('SECRET', repr(receipt))
            self.assertNotIn(raw, repr(server.EPHEMERAL_REPRINT_JOBS))
            spool.assert_not_called()
            log.assert_not_called()
            history.assert_not_called()


if __name__ == '__main__':
    unittest.main()
