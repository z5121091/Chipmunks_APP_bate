"""Synthetic full-label geometry checks. No printer or business data is used."""

import unittest
import re
from unittest.mock import patch

import qrcode
from PIL import Image
from qrcode.constants import ERROR_CORRECT_L

from scripts.label_templates import apm, boya, union, wch, registry
from scripts.label_templates.common import build_reprint_qr_image
from scripts.test_label_code128 import decode_manual_content


def synthetic_record():
    return {
        'model': 'APM32F103CBT6', 'version': '811200000001', 'quantity': '250',
        'batch': 'AB1234567890', 'package': 'LQFP48', 'production_date': '20261014',
        'trace_no': 'AB1234567890-2', 'source_no': 'TESTBOX001',
    }


def synthetic_source(template, record):
    if template['key'] == 'wch':
        return ','.join(str(record.get(key, '')) for key in (
            'model', 'version', 'code_no', 'package', 'batch', 'quantity',
            'production_date', 'origin', 'trace_no',
        ))
    return '/'.join(str(value) for value in record.values())


class ReprintGeometryTest(unittest.TestCase):
    def test_matrix_is_drawn_with_uniform_integer_cells_and_four_blank_modules(self):
        for raw in ('SYNTHETIC/250/LOT', 'SYNTHETIC/\rMODEL/250', 'SYNTHETIC/\nMODEL/250',
                    'SYNTHETIC/\r\nMODEL/250', 'x' * 78, 'x' * 134, 'x' * 192):
            with self.subTest(length=len(raw)):
                image = build_reprint_qr_image(raw, 198, (528, 0, 800, 246), 575, 20)
                expected = qrcode.QRCode(error_correction=ERROR_CORRECT_L, mask_pattern=7, border=4)
                expected.add_data(raw.encode('ascii'))
                expected.make(fit=True)
                matrix = expected.get_matrix()
                self.assertEqual(image.image.size, (len(matrix) * image.cell_dots,) * 2)
                for row, values in enumerate(matrix):
                    for column, dark in enumerate(values):
                        tile = image.image.crop((
                            column * image.cell_dots, row * image.cell_dots,
                            (column + 1) * image.cell_dots, (row + 1) * image.cell_dots,
                        ))
                        self.assertEqual(tile.getextrema(), (int(dark), int(dark)))
                quiet = 4 * image.cell_dots
                side = image.image.width
                for box in ((0, 0, side, quiet), (0, side - quiet, side, side),
                            (0, 0, quiet, side), (side - quiet, 0, side, side)):
                    self.assertIsNone(image.image.crop(box).getbbox())

    def test_full_label_bitmap_preserves_qr_and_no_text_or_logo_overwrites_its_border(self):
        for module, template in (
            (apm, registry.NATIVE_LABEL_TEMPLATE_GEEHY),
            (apm, registry.NATIVE_LABEL_TEMPLATE_LEADCORE),
            (boya, registry.NATIVE_LABEL_TEMPLATE_BOYA),
            (union, registry.NATIVE_LABEL_TEMPLATE_UNION),
            (wch, registry.NATIVE_LABEL_TEMPLATE_WCH),
        ):
            record = synthetic_record()
            if module is boya:
                record.update(model='BY25Q064ASWIG(R)', package='DFN(0405*0.65-1.20)010(E)',
                              source_no='BOX202610140000012345', trace_no='')
            if module is union:
                record.update(version='MARK01', production_date='261014')
            if module is wch:
                record.update(model='CH334U', version='31317.TB', code_no='---', origin='China')
            captured = []
            def capture(*args, **kwargs):
                result = build_reprint_qr_image(*args, **kwargs)
                captured.append(result)
                return result
            with self.subTest(template=template['key']), patch.object(module, 'build_reprint_qr_image', side_effect=capture):
                commands = registry.build_native_label(record, template, source_qr=synthetic_source(template, record))
                [qr] = captured
                marker = b'BITMAP 0,0,100,400,0,'
                offset = commands.index(marker) + len(marker)
                raster = Image.frombytes('1', (800, 400), bytes(value ^ 255 for value in commands[offset:offset + 40000]))
                crop = raster.crop((qr.x, qr.y, qr.quiet_right, qr.quiet_bottom))
                # The final TSPL bitmap has every encoded cell and all four quiet strips intact.
                self.assertEqual(crop.tobytes(), qr.image.tobytes())
                self.assertIn(b'PRINT 1,2\r\n', commands)
                self.assertNotIn(b'QRCODE ', commands)
                if module is wch:
                    self.assertAlmostEqual(qr.symbol_x + qr.symbol_size / 2, 638, delta=0.5)

    def test_boya_full_original_headers_do_not_force_qr_to_the_old_small_size(self):
        record = synthetic_record()
        record.update(model='BY25Q064ASWIG(R)', package='DFN(0405*0.65-1.20)010(E)',
                      source_no='BOX202610140000012345', trace_no='')
        raw = (f'BOYA MICROELECTRONICS/PART NO.:{record["model"]}/PACKAGE:{record["package"]}/'
               f'QUANTITY:250/LOT ID:{record["batch"]}/DATE CODE:2642/MSL3/Track ID:{record["source_no"]}')
        qr = build_reprint_qr_image(raw, 198, (554, 154, 800, 400), 610, 190)
        self.assertGreaterEqual(qr.symbol_size, 180)
        self.assertLessEqual(qr.quiet_right, 800)
        self.assertLessEqual(qr.quiet_bottom, 400)

    def test_apm_long_numeric_trace_suffix_keeps_full_text_and_two_dot_bars_in_real_blank_space(self):
        for template in (registry.NATIVE_LABEL_TEMPLATE_GEEHY, registry.NATIVE_LABEL_TEMPLATE_LEADCORE):
            for suffix in ('1', '9', '10', '11', '99', '100'):
                record = synthetic_record()
                record.update(model='APM32F103CBT6', batch='TEST', package='LQFP64',
                              production_date='2642', trace_no='AB1234567890123-' + suffix,
                              source_no='BOX123456789')
                source = '/'.join(record[key] for key in (
                    'model', 'batch', 'package', 'version', 'quantity',
                    'production_date', 'trace_no', 'source_no',
                ))
                captured_qr = []
                def capture_qr(*args, **kwargs):
                    result = build_reprint_qr_image(*args, **kwargs)
                    captured_qr.append(result)
                    return result
                with self.subTest(template=template['key'], suffix=suffix), patch.object(
                    apm, 'build_native_text_bitmap', wraps=apm.build_native_text_bitmap
                ) as text_bitmap, patch.object(apm, 'build_reprint_qr_image', side_effect=capture_qr) as qr_layer:
                    commands = registry.build_native_label(record, template, source_qr=source)
                self.assertEqual(qr_layer.call_args.args[0], source)
                trace_text = next(item for item in text_bitmap.call_args.args[0] if item[2] == record['trace_no'])
                # No smaller font override: the template still uses Arial 8pt / 23 dots.
                self.assertEqual(trace_text[4:], ())
                self.assertLessEqual(trace_text[0], 445)
                marker = b'BITMAP 0,0,100,400,0,'
                offset = commands.index(marker) + len(marker)
                raster = Image.frombytes('1', (800, 400), bytes(value ^ 255 for value in commands[offset:offset + 40000]))
                [qr] = captured_qr
                self.assertEqual(raster.crop((qr.x, qr.y, qr.quiet_right, qr.quiet_bottom)).tobytes(), qr.image.tobytes())
                barcodes = {}
                for match in re.finditer(rb'BARCODE (\d+),(\d+),"128M",(\d+),0,0,(\d+),(\d+),"([^"]*)"', commands[offset + 40000:]):
                    x, y, height, narrow, wide = map(int, match.groups()[:5])
                    decoded, words = decode_manual_content(match.group(6).decode('ascii'))
                    width = ((len(words) + 1) * 11 + 13) * narrow
                    barcodes[decoded] = (x, y, height, narrow, wide, width)
                x, y, height, narrow, wide, width = barcodes[record['trace_no']]
                pkg_x, _pkg_y, _pkg_height, _narrow, _wide, pkg_width = barcodes[record['package']]
                self.assertEqual((y, height, narrow, wide), (276, 32, 2, 2))
                self.assertGreaterEqual(x - (pkg_x + pkg_width), 20)
                self.assertLessEqual(x + width, 690)
                # Compliance text and all other bitmap ink stay outside bars + quiet zones.
                self.assertIsNone(raster.crop((x - 20, y, x + width + 20, y + height)).getbbox())
                self.assertIn(b'PRINT 1,2\r\n', commands)

    def test_apm_true_trace_overflow_is_still_reported_without_thinning_bars(self):
        record = synthetic_record()
        record.update(batch='TEST', package='LQFP64', production_date='2642', trace_no='i' * 18)
        with self.assertRaisesRegex(ValueError, '追溯码条码宽度466点，模板可用438点'):
            registry.build_native_label(record, registry.NATIVE_LABEL_TEMPLATE_GEEHY, source_qr='TEST/250')

    def test_boya_rohs_outline_never_draws_into_short_qr_quiet_border(self):
        for length in (17, 32, 54, 78, 134):
            captured = []
            def capture(*args, **kwargs):
                result = build_reprint_qr_image(*args, **kwargs)
                captured.append(result)
                return result
            with self.subTest(length=length), patch.object(boya, 'build_reprint_qr_image', side_effect=capture):
                commands = registry.build_native_label(synthetic_record(), registry.NATIVE_LABEL_TEMPLATE_BOYA, source_qr='x' * length)
                [qr] = captured
                marker = b'BITMAP 0,0,100,400,0,'
                offset = commands.index(marker) + len(marker)
                raster = Image.frombytes('1', (800, 400), bytes(value ^ 255 for value in commands[offset:offset + 40000]))
                self.assertEqual(raster.crop((qr.x, qr.y, qr.quiet_right, qr.quiet_bottom)).tobytes(), qr.image.tobytes())

    def test_no_space_is_reported_instead_of_shrinking_below_three_dots_or_truncating(self):
        with self.assertRaisesRegex(ValueError, '原始二维码内容过长'):
            build_reprint_qr_image('SYNTHETIC/250/LOT', 198, (700, 300, 750, 350), 700, 300)


if __name__ == '__main__':
    unittest.main()
