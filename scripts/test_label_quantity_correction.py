"""Quantity-corrected reprints through the existing API, without a printer.

These tests start with a fully corrected JSON record and original-format QR,
the same contract used by the client. They deliberately do not implement the
client's parser, QR editing or trace increment logic. Real supplier builders,
QR matrices, text rasters and Code 128 encoders run; only Windows spooling and
persistent business paths are forbidden/mocked.
"""

import builtins
import copy
import re
import unittest
from contextlib import ExitStack
from unittest.mock import patch

from scripts import label_sync_server as server
from scripts import label_templates
from scripts.label_templates import apm, boya, dongwei, linearin, rongpai, union, wch
from scripts.test_label_code128 import decode_manual_content


def fixture(key):
    """Independent raw fixtures include supplier metadata ignored by parsing."""
    suppliers = {
        'geehy': '珠海极海半导体有限公司',
        'leadcore': '珠海领芯科技有限公司',
        'boya': '珠海博雅科技股份有限公司',
        'union': '盈力半导体(上海)有限公司',
        'wch': '南京沁恒微电子股份有限公司',
        'dongwei': '苏州东微半导体股份有限公司',
        'linearin': '上海先积集成电路有限公司',
        'rongpai': '荣湃半导体(上海)有限公司',
    }
    record = dict(
        supplier=suppliers[key], model='APM32F103RBT6', batch='NYORY',
        package='LQFP64', version='801204300041', quantity='1500',
        production_date='2436', trace_no='BT7124009010023-1',
        source_no='OPGD144429023', inventory_code='',
    )
    if key == 'leadcore':
        record.update(model='LX32F003F6P6', batch='V01H1', version='811206700006',
                      production_date='2510', trace_no='BT7125032100-1',
                      source_no='IPCG0195321006')
    if key in ('geehy', 'leadcore'):
        raw = '/'.join(record[field] for field in (
            'model', 'batch', 'package', 'version', 'quantity',
            'production_date', 'trace_no', 'source_no',
        ))
    elif key == 'boya':
        record.update(model='BY25Q128ESSIG(R)', package='SOP8-208MIL', batch='AP5G751',
                      production_date='2620', source_no='TP260619006-00100',
                      trace_no='', version='')
        raw = ('BOYA MICROELECTRONICS/\r\nPART NO.:BY25Q128ESSIG(R)/\r\n'
               'PACKAGE:SOP8-208MIL/\r\nQUANTITY:1500/\r\nLOT ID:AP5G751/\r\n'
               'DATE CODE:2620/Track ID:\r\nTP260619006-00100/MSL3')
    elif key == 'union':
        record.update(model='UM809', version='UM809', batch='LOT26',
                      production_date='2638', trace_no='TRACE26-1', source_no='260101')
        raw = 'UM809;1500;TRACE26-1;LOT26;260101;UM809;2638'
    elif key == 'wch':
        record.update(model='CH334U', version='31317.TB', package='QSOP28',
                      batch='313174G25', production_date='20260923',
                      trace_no='W52609160004006-1', source_no='')
        raw = ('CH334U,31317.TB,---,QSOP28,313174G25,1500,'
               '20260923,China,W52609160004006-1')
    elif key == 'dongwei':
        record.update(model='SFS10R09UNNF', version='1009UN', package='PDFN3.3*3.3',
                      batch='70I0BH6770001', production_date='G36PE01N',
                      source_no='1-4', trace_no='')
        raw = 'SFS10R09UNNF;1009UN;PDFN3.3*3.3;70I0BH6770001;1500;G36PE01N;1-4;'
    elif key == 'linearin':
        record.update(model='LTA8292XS8/R8', package='SOIC-8L', quantity='4000',
                      version='J-L14', batch='231012PJ', production_date='17-04-2023',
                      source_no='', trace_no='')
        raw = ('P/N:LTA8292XS8/R8\rPKG:SOIC-8L\rQTY:4000\r'
               'D/C:J-L14\rLOT:231012PJ\rDATE:17-04-2023')
    else:
        record.update(model='Pai8485E-W1R', batch='A552588.1', production_date='2528HE',
                      trace_no='2507260140109-1', version='LEVEL2',
                      source_no='3001-250721001', package='01-A0162')
        raw = ('Pai8485E-W1R;A552588.1;2528HE;1500;2507260140109-1;'
               'A;LEVEL2;3001-250721001;1;01-A0162;')
    record['source_qr'] = raw
    return record


def quantity_token(key, quantity):
    """Return the known fixture span; this is not a supplier QR parser."""
    if key == 'boya':
        return f'QUANTITY:{quantity}'
    if key == 'linearin':
        return f'QTY:{quantity}\r'
    if key == 'wch':
        return f',{quantity},'
    if key in ('union', 'dongwei', 'rongpai'):
        return f';{quantity};'
    return f'/{quantity}/'


def corrected_record(key, quantity, suffix=2):
    """Fixture preparation only: replace known quantity/trace spans exactly."""
    original = fixture(key)
    result = copy.deepcopy(original)
    result['quantity'] = str(quantity)
    # Locate the one known quantity field, never a numeric substring elsewhere.
    old = quantity_token(key, original['quantity'])
    new = quantity_token(key, quantity)
    assert original['source_qr'].count(old) == 1
    result['source_qr'] = original['source_qr'].replace(old, new)
    if original['trace_no']:
        result['trace_no'] = original['trace_no'][:-1] + str(suffix)
        assert result['source_qr'].count(original['trace_no']) == 1
        result['source_qr'] = result['source_qr'].replace(original['trace_no'], result['trace_no'])
    return result


MODULES = {'geehy': apm, 'leadcore': apm, 'boya': boya, 'union': union,
           'wch': wch, 'dongwei': dongwei, 'linearin': linearin, 'rongpai': rongpai}
BARCODE_COUNTS = {'geehy': 8, 'leadcore': 8, 'boya': 0, 'union': 7,
                  'wch': 0, 'dongwei': 0, 'linearin': 0, 'rongpai': 5}


class CorrectedReprintCompatibilityTest(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(server, 'EPHEMERAL_REPRINT_JOBS', {}))
        self.stack.enter_context(patch.object(server, 'read_sync_pairing_key', return_value=''))
        self.send = self.stack.enter_context(
            patch.object(server, 'send_raw_tspl_to_printer', return_value=42),
        )
        for name in ('load_native_print_history', 'save_native_print_history', 'log',
                     'save_workbook_atomically', 'load_workbook', 'open_native_print_ledger',
                     'build_native_unpack_time_label'):
            self.stack.enter_context(patch.object(server, name, side_effect=AssertionError(name)))
        self.stack.enter_context(patch.object(server.sqlite3, 'connect', side_effect=AssertionError('database write')))
        real_open = builtins.open

        def read_only_open(file, mode='r', *args, **kwargs):
            if any(flag in str(mode) for flag in ('w', 'a', 'x', '+')):
                raise AssertionError('Reprint must not write a file: ' + str(file))
            return real_open(file, mode, *args, **kwargs)

        self.stack.enter_context(patch('builtins.open', side_effect=read_only_open))

    def payload(self, record, job='CORRECT-1'):
        return dict(record=record, print_job_id=job,
                    reprint_session_id=server.LABEL_REPRINT_SESSION_ID)

    def capture_submit(self, key, record, job='CORRECT-1'):
        module = MODULES[key]
        # Wrapping leaves all raster/font/width/matrix calculations active.
        with patch.object(module, 'build_native_text_bitmap', wraps=module.build_native_text_bitmap) as text, \
             patch.object(module, 'build_reprint_qr_image', wraps=module.build_reprint_qr_image) as qr:
            receipt = server.submit_native_label_reprint(self.payload(record, job))
        self.assertTrue(receipt['success'], receipt)
        commands = self.send.call_args.args[1]
        self.assertTrue(commands.startswith(b'SIZE 100 mm,50 mm\r\n'))
        self.assertTrue(commands.endswith(b'PRINT 1,2\r\n'))
        self.assertEqual(receipt['copies'], 2)
        self.assertEqual(qr.call_args.args[0], record['source_qr'])
        self.assertIn(b'BITMAP 0,0,100,400,0,', commands)
        displayed = [item[2] for item in text.call_args.args[0]]
        self.assertIn(record['quantity'], displayed)
        self.assertIn(record['model'], displayed)
        if record['trace_no']:
            self.assertIn(record['trace_no'], displayed)
        # Read commands after the actual raster; binary pixels cannot mimic bars.
        marker = b'BITMAP 0,0,100,400,0,'
        after_bitmap = commands[commands.index(marker) + len(marker) + 40000:].decode('ascii')
        bars = re.findall(r'^BARCODE [^\r\n]*,"(128M|128)"[^\r\n]*,"([^"\r\n]*)"\r?$',
                          after_bitmap, flags=re.MULTILINE)
        self.assertEqual(len(bars), BARCODE_COUNTS[key], after_bitmap)
        decoded = [decode_manual_content(data)[0] if symbology == '128M' else data
                   for symbology, data in bars]
        if bars:
            self.assertIn(record['quantity'], decoded)
            self.assertIn(record['model'], decoded)
            if record['trace_no']:
                self.assertIn(record['trace_no'], decoded)
        if key == 'rongpai':
            self.assertCountEqual(decoded, [record[field] for field in (
                'model', 'batch', 'production_date', 'quantity', 'trace_no',
            )])
        return receipt, commands, displayed

    def assert_supplier_corrections(self, key):
        original = fixture(key)
        for quantity in (100, 5000):
            with self.subTest(quantity=quantity):
                corrected = corrected_record(key, quantity)
                receipt, commands, _displayed = self.capture_submit(key, corrected, f'{key}-{quantity}')
                count = self.send.call_count
                retry = server.submit_native_label_reprint(self.payload(corrected, f'{key}-{quantity}'))
                self.assertTrue(retry['duplicate'])
                self.assertEqual(self.send.call_count, count)
                self.assertEqual(self.send.call_args.args[1], commands)
                # Restore only edited fields: every ignored token, prefix,
                # delimiter, CRLF and terminal separator must still be intact.
                restored = corrected['source_qr']
                if original['trace_no']:
                    restored = restored.replace(corrected['trace_no'], original['trace_no'])
                restored = restored.replace(quantity_token(key, quantity),
                                            quantity_token(key, original['quantity']))
                self.assertEqual(restored, original['source_qr'])
                self.assertEqual(receipt['state'], 'submitted')
        self.assertEqual(original, fixture(key), 'Original fixture must remain unchanged')

    def test_geehy_lower_and_higher_quantities(self):
        self.assert_supplier_corrections('geehy')

    def test_leadcore_lower_and_higher_quantities(self):
        self.assert_supplier_corrections('leadcore')

    def test_boya_lower_and_higher_quantities(self):
        self.assert_supplier_corrections('boya')

    def test_union_lower_and_higher_quantities(self):
        self.assert_supplier_corrections('union')

    def test_wch_lower_and_higher_quantities(self):
        self.assert_supplier_corrections('wch')

    def test_dongwei_lower_and_higher_quantities(self):
        self.assert_supplier_corrections('dongwei')

    def test_rongpai_lower_and_higher_quantities(self):
        self.assert_supplier_corrections('rongpai')

    def test_linearin_lower_and_higher_quantities(self):
        self.assert_supplier_corrections('linearin')

    def test_linearin_prefixes_and_line_endings_survive_quantity_correction(self):
        expected_lines = [
            'P/N:LTA8292XS8/R8', 'PKG:SOIC-8L', 'QTY:5000',
            'D/C:J-L14', 'LOT:231012PJ', 'DATE:17-04-2023',
        ]
        for index, ending in enumerate(('\r', '\n', '\r\n')):
            with self.subTest(ending=repr(ending)):
                record = corrected_record('linearin', 5000)
                record['source_qr'] = record['source_qr'].replace('\r', ending)
                _receipt, _commands, text = self.capture_submit('linearin', record, f'LINEARIN-{index}')
                self.assertEqual(record['source_qr'].encode('ascii'), ending.join(expected_lines).encode('ascii'))
                self.assertEqual(record['source_qr'].count(ending), 5)
                self.assertEqual(record['trace_no'], '')
                self.assertEqual(record['source_no'], '')
                for field in ('package', 'version', 'batch', 'production_date'):
                    self.assertIn(record[field], text)

    def test_no_trace_does_not_change_supplier_box_identifiers(self):
        for key in ('boya', 'dongwei'):
            with self.subTest(key=key):
                record = corrected_record(key, 100)
                _receipt, _commands, text = self.capture_submit(key, record, key)
                self.assertEqual(record['trace_no'], '')
                self.assertEqual(record['source_no'], fixture(key)['source_no'])
                self.assertIn(record['source_no'], text)
                self.assertEqual(record['source_qr'].count(record['source_no']), 1)
                self.assertNotIn(record['source_no'] + '-1', record['source_qr'])

    def test_boya_prefixes_linebreaks_track_id_and_msl_are_preserved(self):
        record = corrected_record('boya', 5000)
        self.capture_submit('boya', record)
        expected = fixture('boya')['source_qr'].replace('QUANTITY:1500', 'QUANTITY:5000')
        self.assertEqual(record['source_qr'].encode('ascii'), expected.encode('ascii'))
        self.assertEqual(record['source_qr'].count('\r\n'), 6)
        self.assertTrue(record['source_qr'].endswith('/MSL3'))
        self.assertIn('Track ID:\r\nTP260619006-00100', record['source_qr'])

    def test_wch_ignored_code_and_origin_are_printed_unchanged(self):
        record = corrected_record('wch', 100)
        _receipt, _commands, text = self.capture_submit('wch', record)
        self.assertIn('---', text)
        self.assertIn('China', text)
        self.assertEqual(record['source_qr'].split(',')[2], '---')
        self.assertEqual(record['source_qr'].split(',')[7], 'China')
        self.assertFalse(record['source_qr'].endswith(','))

    def test_rongpai_fixed_markers_box_package_and_version_survive(self):
        record = corrected_record('rongpai', 5000)
        _receipt, _commands, text = self.capture_submit('rongpai', record)
        fields = record['source_qr'].split(';')
        self.assertEqual((fields[5], fields[8], fields[7], fields[9], fields[10]),
                         ('A', '1', '3001-250721001', '01-A0162', ''))
        self.assertIn('MSL: LEVEL2', text)

    def test_same_job_payload_conflict_but_new_correction_has_own_identity(self):
        one = corrected_record('rongpai', 100)
        two = corrected_record('rongpai', 5000, suffix=3)
        self.capture_submit('rongpai', one)
        denied = server.submit_native_label_reprint(self.payload(two))
        self.assertEqual(denied['code'], 'JOB_CONFLICT')
        self.assertEqual(self.send.call_count, 1)
        self.capture_submit('rongpai', two, 'CORRECT-2')
        self.assertEqual(self.send.call_count, 2)

    def test_retry_after_unsubmitted_spool_failure_keeps_corrected_payload(self):
        record = corrected_record('rongpai', 100)
        self.send.side_effect = [RuntimeError('printer unavailable'), 42]
        one = server.submit_native_label_reprint(self.payload(record))
        self.assertFalse(one['success'])
        self.assertFalse(one['resultUnknown'])
        two = server.submit_native_label_reprint(self.payload(record))
        self.assertTrue(two['success'], two)
        self.assertEqual(self.send.call_args_list[0].args[1], self.send.call_args_list[1].args[1])
        self.assertEqual(record['trace_no'], '2507260140109-2')

    def test_nonpositive_fractional_and_unsafe_quantity_never_print(self):
        for quantity in ('0', '-1', '1.2', '1.2.3', 'NaN', 'Infinity', '9007199254740992'):
            with self.subTest(quantity=quantity):
                record = corrected_record('rongpai', quantity)
                receipt = server.submit_native_label_reprint(self.payload(record, 'BAD-' + quantity))
                self.assertFalse(receipt['success'])
                self.assertEqual(receipt['code'], 'INVALID_LABEL_CONTENT')
        self.send.assert_not_called()

    def test_corrected_qr_and_record_cannot_disagree_in_validating_templates(self):
        for key in ('wch', 'dongwei', 'linearin', 'rongpai'):
            with self.subTest(key=key):
                record = corrected_record(key, 100)
                record['source_qr'] = fixture(key)['source_qr']
                receipt = server.submit_native_label_reprint(self.payload(record, key))
                self.assertEqual(receipt['code'], 'INVALID_LABEL_CONTENT')
        self.send.assert_not_called()

    def test_memory_retry_cache_does_not_retain_label_business_fields(self):
        record = corrected_record('rongpai', 100)
        self.capture_submit('rongpai', record)
        retained = repr(server.EPHEMERAL_REPRINT_JOBS)
        for field in ('source_qr', 'trace_no', 'model', 'batch', 'source_no'):
            self.assertNotIn(record[field], retained)


if __name__ == '__main__':
    unittest.main(verbosity=2)
