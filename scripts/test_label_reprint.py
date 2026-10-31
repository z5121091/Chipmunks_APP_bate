"""Ephemeral label reprinting checks. Every spool submission is mocked."""

import io
import json
import re
import sys
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import Mock, patch
from wsgiref.util import setup_testing_defaults

from scripts import label_sync_server as server
from scripts import label_templates
from scripts.label_templates import apm, boya, dongwei, linearin, rongpai, union, wch
from scripts.label_templates.common import build_reprint_qr_image, get_native_arial_font, normalize_tspl_value


SOURCE_QR = 'CH334U,31317.TB,---,QSOP28,313174G25,250,20260923,China,W52609160004006-1'


def make_payload(**changes):
    record = {
        'model': 'CH334U', 'version': '31317.TB', 'package': 'QSOP28',
        'batch': '313174G25', 'quantity': '250', 'production_date': '20260923',
        'trace_no': 'W52609160004006-1', 'source_no': '', 'inventory_code': '',
        'supplier': '南京沁恒微电子股份有限公司', 'source_qr': SOURCE_QR,
    }
    record.update(changes)
    return {
        'print_job_id': 'REPRINT-1',
        'reprint_session_id': server.LABEL_REPRINT_SESSION_ID,
        'record': record,
    }


class EphemeralReprintTest(unittest.TestCase):
    def setUp(self):
        self.memory = patch.object(server, 'EPHEMERAL_REPRINT_JOBS', {})
        self.memory.start()
        self.addCleanup(self.memory.stop)
        # Pairing configuration is read-only and covered separately; these
        # checks forbid persistent label/business paths after authorization.
        pairing = patch.object(server, 'read_sync_pairing_key', return_value='')
        pairing.start()
        self.addCleanup(pairing.stop)

    def test_health_announces_ephemeral_capability_without_changing_version(self):
        with patch.object(server, 'enable_cors'), patch.object(server, 'get_lan_ipv4_addresses', return_value=[]):
            result = json.loads(server.Health().GET())
        self.assertEqual(result['version'], 'V1.0')
        self.assertEqual(result['labelReprintApiVersion'], 1)
        self.assertEqual(result['labelReprintSessionId'], server.LABEL_REPRINT_SESSION_ID)
        self.assertEqual(set(result['labelReprintSuppliers']), set(label_templates.NATIVE_LABEL_TEMPLATE_BY_SUPPLIER))

    def test_reprint_mount_disables_upload_processing_and_request_file_logs(self):
        with patch.object(server, 'get_lan_ip', return_value='127.0.0.1'), patch.object(server, 'get_lan_ipv4_addresses', return_value=[]), patch.object(server.cherrypy.tree, 'mount') as mount, patch.object(server.cherrypy.config, 'update'), patch.object(server.cherrypy.engine, 'start'), patch.object(server, 'log'):
            server.start_server()
        [route] = [call for call in mount.call_args_list if call.args[1] == '/label-reprint']
        config = route.args[2]['/']
        self.assertFalse(config['request.process_request_body'])
        self.assertEqual(config['log.access_file'], '')
        self.assertEqual(config['log.error_file'], '')
        self.assertFalse(config['log.screen'])

    def test_two_copies_only_and_no_file_history_workbook_or_log_writes(self):
        payload = make_payload()
        with ExitStack() as stack:
            forbidden = [stack.enter_context(patch.object(server, name, side_effect=AssertionError(name))) for name in (
                'load_native_print_history', 'save_native_print_history', 'log',
                'save_workbook_atomically', 'build_native_unpack_time_label', 'load_workbook',
            )]
            stack.enter_context(patch('builtins.open', side_effect=AssertionError('file write')))
            stack.enter_context(patch.object(server, 'build_native_label', return_value=b'ONE LABEL\r\nPRINT 1,2\r\n'))
            send = stack.enter_context(patch.object(server, 'send_raw_tspl_to_printer', return_value=42))
            first = server.submit_native_label_reprint(payload)
            second = server.submit_native_label_reprint(payload)
        self.assertTrue(first['success'])
        self.assertEqual(first['state'], 'submitted')
        self.assertEqual(first['copies'], 2)
        self.assertTrue(second['duplicate'])
        send.assert_called_once()
        self.assertEqual(send.call_args.args[1].count(b'PRINT 1,2'), 1)
        for method in forbidden:
            method.assert_not_called()
        retained = repr(server.EPHEMERAL_REPRINT_JOBS)
        for field in ('CH334U', 'W52609160004006-1', SOURCE_QR, '313174G25'):
            self.assertNotIn(field, retained)

    def test_task_id_cannot_be_reused_with_changed_label(self):
        with patch.object(server, 'build_native_label', return_value=b'PRINT 1,2'), patch.object(server, 'send_raw_tspl_to_printer', return_value=42) as send:
            server.submit_native_label_reprint(make_payload())
            changed = server.submit_native_label_reprint(make_payload(quantity='251'))
        self.assertEqual(changed['code'], 'JOB_CONFLICT')
        send.assert_called_once()

    def test_deliberate_new_scan_of_same_qr_gets_another_print_job(self):
        one = make_payload()
        two = dict(one, print_job_id='REPRINT-2')
        with patch.object(server, 'build_native_label', return_value=b'PRINT 1,2'), patch.object(server, 'send_raw_tspl_to_printer', return_value=42) as send:
            server.submit_native_label_reprint(one)
            result = server.submit_native_label_reprint(two)
        self.assertTrue(result['success'])
        self.assertFalse(result['duplicate'])
        self.assertEqual(send.call_count, 2)

    def test_missing_template_rejects_instead_of_saving_or_skipping(self):
        with patch.object(server, 'send_raw_tspl_to_printer') as send, patch.object(server, 'log') as log:
            result = server.submit_native_label_reprint(make_payload(supplier='未配置供应商'))
        self.assertEqual(result['code'], 'NO_TEMPLATE')
        self.assertFalse(result['success'])
        send.assert_not_called()
        log.assert_not_called()
        self.assertNotIn(SOURCE_QR, repr(server.EPHEMERAL_REPRINT_JOBS))

    def test_old_process_session_requires_check_before_any_print(self):
        payload = dict(make_payload(), reprint_session_id='previous-process')
        with patch.object(server, 'send_raw_tspl_to_printer') as send:
            result = server.submit_native_label_reprint(payload)
        self.assertEqual(result['code'], 'SESSION_CHANGED')
        self.assertTrue(result['retryAllowed'])
        self.assertTrue(result['resultUnknown'])
        send.assert_not_called()

    def test_failure_before_spool_can_retry_with_same_job_id(self):
        with patch.object(server, 'build_native_label', return_value=b'PRINT 1,2'), patch.object(server, 'send_raw_tspl_to_printer', side_effect=[RuntimeError('printer missing'), 42]) as send:
            first = server.submit_native_label_reprint(make_payload())
            second = server.submit_native_label_reprint(make_payload())
        self.assertEqual(first['code'], 'PRINT_FAILED')
        self.assertFalse(first['resultUnknown'])
        self.assertTrue(second['success'])
        self.assertEqual(send.call_count, 2)

    def test_failure_after_spool_requires_manual_confirmation_and_keeps_payload_identity(self):
        attempts = 0

        def spool(_printer, _commands, _name, submission_callback=None):
            nonlocal attempts
            attempts += 1
            submission_callback()
            if attempts == 1:
                raise RuntimeError('partial spool')
            return 42

        with patch.object(server, 'build_native_label', return_value=b'PRINT 1,2'), patch.object(server, 'send_raw_tspl_to_printer', side_effect=spool) as send:
            first = server.submit_native_label_reprint(make_payload())
            second = server.submit_native_label_reprint(make_payload())
            self.assertEqual(send.call_count, 1)
            third = server.submit_native_label_reprint(dict(make_payload(), retry_confirmed=True))
        self.assertEqual(first['code'], 'PRINT_RESULT_UNKNOWN')
        self.assertTrue(first['resultUnknown'])
        self.assertEqual(second, first)
        self.assertTrue(third['success'])
        self.assertEqual(send.call_count, 2)

    def test_invalid_content_does_not_reach_printer(self):
        for changes in (
            {'source_qr': SOURCE_QR + '\t'}, {'source_qr': '型号'},
            {'source_qr': SOURCE_QR + '"'}, {'quantity': 'NaN'},
            {'quantity': '-1'}, {'quantity': '0'}, {'model': ''},
            {'quantity': '1.5'}, {'quantity': '9007199254740992'},
            {'trace_no': 'TRACE"BAD'}, {'quantity': True},
        ):
            with self.subTest(changes=changes), patch.object(server, 'send_raw_tspl_to_printer') as send:
                result = server.submit_native_label_reprint(make_payload(**changes))
                self.assertEqual(result['code'], 'INVALID_LABEL_CONTENT')
                send.assert_not_called()

    def test_original_cr_lf_and_crlf_are_preserved_without_file_or_history_writes(self):
        for ending in ('\r', '\n', '\r\n'):
            raw = f'SYNTHETIC/{ending}MODEL/100/{ending}LOT'
            with self.subTest(ending=repr(ending)), ExitStack() as stack:
                stack.enter_context(patch('builtins.open', side_effect=AssertionError('file write')))
                for name in ('load_native_print_history', 'save_native_print_history', 'log', 'save_workbook_atomically'):
                    stack.enter_context(patch.object(server, name, side_effect=AssertionError(name)))
                build = stack.enter_context(patch.object(server, 'build_native_label', return_value=b'BITMAP\r\nPRINT 1,2\r\n'))
                send = stack.enter_context(patch.object(server, 'send_raw_tspl_to_printer', return_value=42))
                payload = make_payload(source_qr=raw)
                payload['print_job_id'] = f'LINEBREAK-{len(ending)}-{ord(ending[0])}'
                result = server.submit_native_label_reprint(payload)
                self.assertTrue(result['success'], result)
                self.assertEqual(build.call_args.kwargs['source_qr'].encode('ascii'), raw.encode('ascii'))
                self.assertEqual(build.call_args.args[0]['source_qr'], raw)
                self.assertEqual(send.call_args.args[1].count(b'PRINT 1,2\r\n'), 1)

    def test_line_break_exception_does_not_relax_printed_fields_or_other_controls(self):
        cases = [{'source_qr': f'SYNTH/{character}DATA'} for character in ('\t', '\0', '\x1b', '\x7f')]
        cases += [{field: f'AB{ending}CD'} for field in ('model', 'batch', 'source_no', 'trace_no', 'package') for ending in ('\r', '\n', '\r\n')]
        for changes in cases:
            with self.subTest(changes=changes), patch.object(server, 'send_raw_tspl_to_printer') as send:
                result = server.submit_native_label_reprint(make_payload(**changes))
                self.assertEqual(result['code'], 'INVALID_LABEL_CONTENT')
                send.assert_not_called()

    def test_json_endpoint_has_no_persistent_paths_on_success_or_failure(self):
        for body, content_type in (
            (json.dumps(make_payload()).encode(), 'application/json'),
            (b'bad-json', 'application/json'),
            (b'PK workbook', 'application/octet-stream'),
            (b'a' * (server.MAX_LABEL_REPRINT_BYTES + 1), 'application/json'),
        ):
            request = SimpleNamespace(headers={'Content-Type': content_type}, body=io.BytesIO(body))
            with self.subTest(content_type=content_type), patch.object(server.cherrypy, 'request', request), patch.object(server, 'enable_cors'), patch.object(server, 'log', side_effect=AssertionError('persistent log')), patch.object(server, 'build_native_label', return_value=b'PRINT 1,2'), patch.object(server, 'send_raw_tspl_to_printer', return_value=42), patch('builtins.open', side_effect=AssertionError('file write')):
                result = json.loads(server.LabelReprint().POST())
            if body.startswith(b'{'):
                self.assertTrue(result['success'])
            else:
                self.assertEqual(result['code'], 'INVALID_REQUEST')

    def test_json_body_survives_real_cherrypy_method_dispatch_without_excel_fallback(self):
        app = server.cherrypy.Application(server.LabelReprint(), config={
            '/': {
                'request.dispatch': server.cherrypy.dispatch.MethodDispatcher(),
                'request.process_request_body': False,
                'tools.cors.on': True,
            },
        })
        body = json.dumps(make_payload()).encode('utf-8')
        environ = {}
        setup_testing_defaults(environ)
        environ.update({
            'REQUEST_METHOD': 'POST', 'PATH_INFO': '/',
            'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(body)),
            'wsgi.input': io.BytesIO(body),
        })
        captured = {}

        def start_response(status, headers, _exc_info=None):
            captured.update(status=status, headers=dict(headers))

        with patch.object(app.log, 'access'), patch.object(server, 'build_native_label', return_value=b'PRINT 1,2'), patch.object(server, 'send_raw_tspl_to_printer', return_value=42) as send, patch.object(server, 'log', side_effect=AssertionError('persistent log')):
            result = json.loads(b''.join(app(environ, start_response)))
        self.assertEqual(captured['status'], '200 OK')
        self.assertEqual(captured['headers']['Access-Control-Allow-Origin'], '*')
        self.assertTrue(result['success'], result)
        send.assert_called_once()


class OriginalPayloadTemplateTest(unittest.TestCase):
    def test_geehy_and_leadcore_box_id_barcodes_use_025_mm_modules(self):
        record = {
            'model': 'TESTMODEL', 'batch': 'LOT01', 'package': 'SOP8',
            'version': 'V1', 'quantity': '2000', 'production_date': '2642',
            'trace_no': '', 'source_no': 'BOX-20261021-01', 'inventory_code': '',
        }
        for template in (label_templates.NATIVE_LABEL_TEMPLATE_GEEHY,
                         label_templates.NATIVE_LABEL_TEMPLATE_LEADCORE):
            with self.subTest(template=template['key']):
                with patch.object(apm, 'build_native_text_bitmap', return_value=b'BITMAP\r\n'):
                    regular = label_templates.build_native_label(record, template).decode('ascii')
                regular_box_barcode = next(line for line in regular.splitlines()
                                           if line.startswith('BARCODE 350,346,'))
                self.assertIn(',2,2,"BOX-20261021-01"', regular_box_barcode)

                original = '/'.join((record['model'], record['batch'], record['package'],
                                     record['version'], record['quantity'],
                                     record['production_date'], record['trace_no'], record['source_no']))
                with patch.object(apm, 'build_native_text_bitmap', return_value=b'BITMAP\r\n'):
                    reprint = label_templates.build_native_label(record, template, source_qr=original).decode('ascii')
                reprint_box_barcode = next(line for line in reprint.splitlines()
                                           if line.startswith('BARCODE 350,346,'))
                self.assertIn(',2,2,"', reprint_box_barcode)

    def test_line_breaks_cannot_turn_qr_content_into_print_commands(self):
        raw = 'SYNTH/100\r\nPRINT 1,99\r\nCLS\nBOX'
        record = {'model': 'TEST', 'quantity': '100', 'package': 'SOP8',
                  'batch': 'LOT01', 'production_date': '2642', 'source_no': 'BOX01'}
        with patch.object(boya, 'build_reprint_qr_image', wraps=build_reprint_qr_image) as qr, patch.object(boya, 'build_native_text_bitmap', return_value=b'BITMAP-CAPTURE\r\n'):
            commands = label_templates.build_native_label(record, label_templates.NATIVE_LABEL_TEMPLATE_BOYA, source_qr=raw)
        self.assertEqual(qr.call_args.args[0], raw)
        self.assertEqual(commands, b'SIZE 100 mm,50 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nBITMAP-CAPTURE\r\nPRINT 1,2\r\n')
        self.assertNotIn(b'PRINT 1,99', commands)

    def test_boya_multiline_payload_is_unchanged_matrix_data_not_a_tspl_command(self):
        record = {'model': 'BY25Q064ASWIG(R)', 'quantity': '3000', 'package': 'SOP8-208MIL',
                  'batch': 'SYNTH01', 'production_date': '2642', 'source_no': 'TEST260101-001', 'trace_no': ''}
        for ending in ('\r', '\n', '\r\n'):
            raw = (f'BOYA MICROELECTRONICS/{ending}PART NO.:{record["model"]}/{ending}'
                   f'PACKAGE:{record["package"]}/{ending}QUANTITY:3000/{ending}'
                   f'LOT ID:SYNTH01/{ending}DATE CODE:2642/Track ID:{ending}TEST260101-001/MSL3')
            with self.subTest(ending=repr(ending)), patch.object(boya, 'build_reprint_qr_image', wraps=build_reprint_qr_image) as qr, patch.object(boya, 'build_native_text_bitmap', return_value=b'BITMAP-CAPTURE\r\n'):
                commands = label_templates.build_native_label(record, label_templates.NATIVE_LABEL_TEMPLATE_BOYA, source_qr=raw)
            self.assertEqual(qr.call_args.args[0].encode('ascii'), raw.encode('ascii'))
            self.assertEqual(commands, b'SIZE 100 mm,50 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nBITMAP-CAPTURE\r\nPRINT 1,2\r\n')

    def test_all_templates_keep_original_delimiters_and_two_copies(self):
        record = make_payload()['record']
        source = ' CH334U|LOT|QSOP28|V1|250||TRACE|BOX;'
        for supplier, template in label_templates.NATIVE_LABEL_TEMPLATE_BY_SUPPLIER.items():
            with self.subTest(supplier=supplier), ExitStack() as stack:
                for module in (apm, boya, dongwei, linearin, rongpai, union, wch):
                    stack.enter_context(patch.object(module, 'build_native_text_bitmap', return_value=b'BITMAP\r\n'))
                module = {'geehy': apm, 'leadcore': apm, 'boya': boya, 'union': union, 'wch': wch, 'dongwei': dongwei, 'linearin': linearin, 'rongpai': rongpai}[template['key']]
                qr_layer = stack.enter_context(patch.object(module, 'build_reprint_qr_image', wraps=build_reprint_qr_image))
                raw = SOURCE_QR if template['key'] == 'wch' else source
                supplier_record = dict(record, production_date='2638') if template['key'] == 'union' else record
                if template['key'] == 'dongwei':
                    supplier_record = dict(record, model='SFS10R09UNNF', version='1009UN',
                                           package='PDFN3.3*3.3', batch='70I0BH6770001',
                                           quantity='2000', production_date='G36PE01N', source_no='1-4')
                    raw = 'SFS10R09UNNF;1009UN;PDFN3.3*3.3;70I0BH6770001;2000;G36PE01N;1-4;'
                if template['key'] == 'rongpai':
                    supplier_record = dict(record, model='Pai8485E-W1R', batch='A552588.1',
                                           production_date='2528HE', quantity='1500', trace_no='2507260140109',
                                           version='LEVEL2', source_no='3001-250721001', package='01-A0162')
                    raw = 'Pai8485E-W1R;A552588.1;2528HE;1500;2507260140109;A;LEVEL2;3001-250721001;1;01-A0162;'
                if template['key'] == 'linearin':
                    supplier_record = dict(record, supplier=supplier, model='LTA8292XS8/R8',
                                           package='SOIC-8L', quantity='4000', version='J-L14',
                                           batch='231012PJ', production_date='17-04-2023',
                                           trace_no='', source_no='')
                    raw = ('P/N:LTA8292XS8/R8\rPKG:SOIC-8L\rQTY:4000\r'
                           'D/C:J-L14\rLOT:231012PJ\rDATE:17-04-2023')
                commands = label_templates.build_native_label(supplier_record, template, source_qr=raw)
            self.assertEqual(qr_layer.call_args.args[0], raw)
            self.assertEqual(commands.count(b'PRINT 1,2\r\n'), 1)
            self.assertNotIn(b'QRCODE ', commands)
            self.assertNotIn(b'PRINT 1,1', commands)

    def test_wch_ignored_code_and_origin_are_read_from_original_qr(self):
        raw = SOURCE_QR.replace(',---,', ',CODE99,').replace(',China,', ',USA,')
        with patch.object(wch, 'build_native_text_bitmap', return_value=b'BITMAP\r\n') as bitmap, patch.object(wch, 'build_reprint_qr_image', wraps=build_reprint_qr_image) as qr_layer:
            commands = label_templates.build_native_label(make_payload()['record'], label_templates.NATIVE_LABEL_TEMPLATE_WCH, source_qr=raw)
        displayed = [item[2] for item in bitmap.call_args.args[0]]
        self.assertIn('CODE99', displayed)
        self.assertIn('USA', displayed)
        self.assertEqual(qr_layer.call_args.args[0], raw)

    def test_source_override_is_explicit_and_cannot_change_existing_unpack_call(self):
        record = make_payload(source_qr='ignored by old printing')['record']
        with patch.object(wch, 'build_native_text_bitmap', return_value=b'BITMAP\r\n'):
            commands = label_templates.build_native_label(record, label_templates.NATIVE_LABEL_TEMPLATE_WCH)
        self.assertIn(SOURCE_QR.encode(), commands)
        self.assertNotIn(b'ignored by old printing', commands)

    def test_long_fields_and_long_qr_are_rejected_without_truncating(self):
        for template in (label_templates.NATIVE_LABEL_TEMPLATE_GEEHY, label_templates.NATIVE_LABEL_TEMPLATE_BOYA):
            for record, raw in (
                (make_payload(model='W' * 80)['record'], 'short-QR'),
                (make_payload()['record'], 'x' * 193),
            ):
                with self.subTest(template=template['key']), self.assertRaises(ValueError):
                    label_templates.build_native_label(record, template, source_qr=raw)

    def test_actual_arial_width_is_checked_even_within_old_character_limits(self):
        for template, field, value in (
            (label_templates.NATIVE_LABEL_TEMPLATE_GEEHY, 'model', 'W' * 12),
            (label_templates.NATIVE_LABEL_TEMPLATE_GEEHY, 'batch', 'W' * 18),
            (label_templates.NATIVE_LABEL_TEMPLATE_BOYA, 'model', 'W' * 22),
            (label_templates.NATIVE_LABEL_TEMPLATE_BOYA, 'batch', 'W' * 18),
        ):
            with self.subTest(template=template['key'], field=field), self.assertRaisesRegex(ValueError, '文字超出模板宽度：需要.*毫米，可用.*毫米'):
                label_templates.build_native_label(make_payload(**{field: value})['record'], template, source_qr='valid-original-QR')

    def test_apm_never_shrinks_a_barcode_to_hide_field_overflow(self):
        record = make_payload(batch='i' * 18)['record']
        with patch.object(apm, 'build_native_text_bitmap', return_value=b'BITMAP\r\n'):
            with self.assertRaisesRegex(ValueError, '批次条码宽度466点，模板可用316点'):
                label_templates.build_native_label(record, label_templates.NATIVE_LABEL_TEMPLATE_GEEHY, source_qr='valid-original-QR')
            old_commands = label_templates.build_native_label(record, label_templates.NATIVE_LABEL_TEMPLATE_GEEHY)
        self.assertIn(b'BARCODE 30,190,"128",32,0,0,2,2,"' + b'i' * 18 + b'"', old_commands)

    def test_apm_mixed_digit_trace_and_batch_keep_preset_two_dot_modules(self):
        record = make_payload(batch='AB1234567890', trace_no='AB1234567890-2')['record']
        with patch.object(apm, 'build_native_text_bitmap', return_value=b'BITMAP\r\n'):
            commands = label_templates.build_native_label(record, label_templates.NATIVE_LABEL_TEMPLATE_GEEHY, source_qr='SYNTH/250')
        self.assertIn(b'BARCODE 30,190,"128M",32,0,0,2,2,', commands)
        self.assertIn(b'BARCODE 350,276,"128M",32,0,0,2,2,', commands)
        self.assertIn(b'BARCODE 30,108,"128M",32,0,0,1,1,', commands)

    def test_qr_reprint_uses_actual_matrix_near_template_size_with_full_quiet_border(self):
        for length in (17, 54, 78, 80, 106, 134, 154, 190):
            raw = 'x' * length
            for template, module, bounds in (
                (label_templates.NATIVE_LABEL_TEMPLATE_GEEHY, apm, (528, 0, 800, 246)),
                (label_templates.NATIVE_LABEL_TEMPLATE_BOYA, boya, (554, 154, 800, 400)),
            ):
                qr_info = []
                qr_options = []
                def capture(*args, **kwargs):
                    result = build_reprint_qr_image(*args, **kwargs)
                    qr_info.append(result)
                    qr_options.append(kwargs)
                    return result
                with self.subTest(length=length, template=template['key']), patch.object(module, 'build_native_text_bitmap', return_value=b'BITMAP\r\n') as bitmap, patch.object(module, 'build_reprint_qr_image', side_effect=capture):
                    commands = label_templates.build_native_label(make_payload()['record'], template, source_qr=raw)
                [qr] = qr_info
                self.assertGreaterEqual(qr.cell_dots, 3)
                self.assertLessEqual(abs(qr.symbol_size - 198), 54 if module is apm else 33)
                self.assertGreaterEqual(qr.x, bounds[0])
                self.assertGreaterEqual(qr.y, bounds[1])
                self.assertLessEqual(qr.quiet_right, bounds[2])
                self.assertLessEqual(qr.quiet_bottom, bounds[3])
                self.assertEqual(qr.symbol_x - qr.x, 4 * qr.cell_dots)
                self.assertEqual(qr.symbol_y - qr.y, 4 * qr.cell_dots)
                self.assertIn((qr.image, (qr.x, qr.y)), bitmap.call_args.args[1])
                self.assertNotIn(b'QRCODE ', commands)
                if module is apm:
                    self.assertEqual(qr_options[0]['error_correction'], 'H')
                    self.assertTrue(qr_options[0]['keep_symbol_position'])
                    if length <= 154:
                        self.assertEqual(qr.symbol_x, apm.NATIVE_LABEL_QR_X)
                        self.assertEqual(qr.symbol_y, apm.NATIVE_LABEL_QR_Y)

    def test_geehy_and_leadcore_reprint_qr_uses_h_level_without_moving_symbol_origin(self):
        raw = 'X' * 190
        for template in (label_templates.NATIVE_LABEL_TEMPLATE_GEEHY,
                         label_templates.NATIVE_LABEL_TEMPLATE_LEADCORE):
            qr_results = []
            qr_arguments = []
            def capture(*args, **kwargs):
                qr_arguments.append(kwargs)
                result = build_reprint_qr_image(*args, **kwargs)
                qr_results.append(result)
                return result
            with self.subTest(template=template['key']), \
                    patch.object(apm, 'build_native_text_bitmap', return_value=b'BITMAP\r\n'), \
                    patch.object(apm, 'build_reprint_qr_image', side_effect=capture):
                label_templates.build_native_label(make_payload()['record'], template, source_qr=raw)
            self.assertEqual(qr_arguments[0]['error_correction'], 'H')
            self.assertTrue(qr_arguments[0]['keep_symbol_position'])
            [qr] = qr_results
            self.assertLessEqual(qr.quiet_right, 800)
            self.assertLessEqual(qr.quiet_bottom, 246)
            self.assertGreaterEqual(qr.symbol_x, 568)
            self.assertGreaterEqual(qr.symbol_y, 15)

    def test_wch_quantity_from_original_code_is_positive_integral_and_matches_record(self):
        for raw_quantity in ('249', '1.5', '-1', 'NaN', '9007199254740992'):
            raw = SOURCE_QR.replace(',250,', ',' + raw_quantity + ',')
            with self.subTest(quantity=raw_quantity), self.assertRaises(ValueError):
                label_templates.build_native_label(make_payload()['record'], label_templates.NATIVE_LABEL_TEMPLATE_WCH, source_qr=raw)


class ActionableReprintFailureTest(unittest.TestCase):
    def setUp(self):
        self.memory = patch.object(server, 'EPHEMERAL_REPRINT_JOBS', {})
        self.memory.start()
        self.addCleanup(self.memory.stop)

    def test_type_missing_and_length_errors_identify_the_field_without_its_content(self):
        cases = (
            ({'package': {'wrong': 'container'}}, '封装', '类型无效'),
            ({'quantity': True}, '数量', '类型无效'),
            ({'version': ['unexpected']}, '版本号', '类型无效'),
            ({'model': ''}, '型号', '未读到'),
            ({'supplier': None}, '供应商', '未读到'),
            ({'trace_no': 'SENSITIVE' * 126}, '追溯码', '超过1000字符'),
        )
        for changes, field, detail in cases:
            with self.subTest(field=field, detail=detail), patch.object(server, 'send_raw_tspl_to_printer') as send:
                result = server.submit_native_label_reprint(make_payload(**changes))
            self.assertEqual(result['code'], 'INVALID_LABEL_CONTENT')
            self.assertIn(field, result['message'])
            self.assertIn(detail, result['message'])
            self.assertNotIn('SENSITIVE', result['message'])
            send.assert_not_called()

    def test_character_errors_explain_the_field_class_and_position_without_echoing_label(self):
        for changes, field, kind, position in (
            ({'package': 'AB"CD'}, '封装', '双引号', '第3个字符'),
            ({'batch': 'AB\nCD'}, '批次', '换行', '第3个字符'),
            ({'trace_no': 'AB\x00CD'}, '追溯码', '空字符', '第3个字符'),
            ({'version': 'A版本'}, '版本号', '中文、全角或特殊字符', '第2个字符'),
            ({'supplier': '供应商\n'}, '供应商', '换行', '第4个字符'),
        ):
            with self.subTest(field=field), patch.object(server, 'send_raw_tspl_to_printer') as send:
                result = server.submit_native_label_reprint(make_payload(**changes))
            self.assertIn(field, result['message'])
            self.assertIn(kind, result['message'])
            self.assertIn(position, result['message'])
            self.assertNotIn(SOURCE_QR, result['message'])
            self.assertFalse(result['resultUnknown'])
            send.assert_not_called()

    def test_original_qr_missing_type_size_and_unsupported_characters_are_distinct(self):
        for original, detail in (
            (None, '缺少'), ('', '缺少'), ('   ', '为空'), (123, '类型无效'),
            ('x' * 4097, '4097字符'), ('AB"CD', '双引号'),
            ('AB\tCD', '制表'), ('AB中文', '中文、全角或特殊字符'),
        ):
            with self.subTest(detail=detail), patch.object(server, 'send_raw_tspl_to_printer') as send:
                result = server.submit_native_label_reprint(make_payload(source_qr=original))
            self.assertIn('原始二维码', result['message'])
            self.assertIn(detail, result['message'])
            send.assert_not_called()

    def test_invalid_quantity_is_always_identified_as_positive_integer_requirement(self):
        for quantity in ('not-number', '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'):
            with self.subTest(quantity=quantity), patch.object(server, 'send_raw_tspl_to_printer') as send:
                result = server.submit_native_label_reprint(make_payload(quantity=quantity))
            self.assertIn('数量', result['message'])
            self.assertIn('正整数', result['message'])
            send.assert_not_called()

    def test_missing_template_names_binding_and_template_configuration_to_check(self):
        result = server.submit_native_label_reprint(make_payload(supplier='TEST COMPANY'))
        self.assertEqual(result['code'], 'NO_TEMPLATE')
        self.assertIn('供应商', result['message'])
        self.assertIn('物料绑定', result['message'])
        self.assertIn('模板配置', result['message'])

    def test_known_template_dependencies_give_actions_without_paths_or_payload_logs(self):
        cases = (
            (RuntimeError('缺少 Pillow，无法生成 Arial 标签文字'), 'Pillow', '重新安装'),
            (RuntimeError('缺少 qrcode，无法生成补打二维码，请重新安装或重新打包同步助手'), 'qrcode', '重新安装'),
            (RuntimeError('未找到 Windows 字体文件：C:/Windows/Fonts/arial.ttf'), 'Arial', '修复'),
            (RuntimeError('未找到标签图片文件：C:/temporary/assets/boya-logo.png'), '博雅Logo', '资源'),
        )
        for error, detail, action in cases:
            with self.subTest(detail=detail), patch.object(server, 'build_native_label', side_effect=error), patch.object(server, 'send_raw_tspl_to_printer') as send, patch.object(server, 'log', side_effect=AssertionError('no business log')), patch('builtins.open', side_effect=AssertionError('no file writes')):
                result = server.submit_native_label_reprint(make_payload())
            self.assertEqual(result['code'], 'TEMPLATE_FAILED')
            self.assertIn(detail, result['message'])
            self.assertIn(action, result['message'])
            self.assertNotIn('C:/', result['message'])
            self.assertFalse(result['resultUnknown'])
            send.assert_not_called()

    def test_unknown_template_exceptions_never_return_or_retain_original_payload(self):
        for error in (RuntimeError(SOURCE_QR), ValueError(SOURCE_QR), OSError(SOURCE_QR)):
            with self.subTest(type=type(error)), patch.object(server, 'build_native_label', side_effect=error), patch.object(server, 'log', side_effect=AssertionError('no business log')):
                result = server.submit_native_label_reprint(make_payload())
            self.assertFalse(result['success'])
            self.assertNotIn(SOURCE_QR, result['message'])
            self.assertNotIn(SOURCE_QR, repr(server.EPHEMERAL_REPRINT_JOBS))

    def test_template_width_and_qr_capacity_details_survive_safe_response_filter(self):
        for message, details in (
            ('封装文字超出模板宽度：需要53.2毫米，可用48.5毫米；请核对该字段内容和解析规则', ('封装', '53.2毫米', '48.5毫米')),
            ('原始二维码内容过长：当前193个字符，本模板最多支持192个字符，无法完整打印', ('193', '192', '原始二维码')),
        ):
            with self.subTest(message=message), patch.object(server, 'build_native_label', side_effect=ValueError(message)):
                result = server.submit_native_label_reprint(make_payload())
            self.assertEqual(result['code'], 'INVALID_LABEL_CONTENT')
            for detail in details:
                self.assertIn(detail, result['message'])

    def test_printer_setup_errors_are_specific_before_queue_submission(self):
        for error, detail in (
            (ValueError('未配置打印机名称'), '未配置标签打印机名称'),
            (ValueError('未找到打印机“TEST”。当前可用：OTHER'), 'Windows 未找到'),
            (RuntimeError('缺少 pywin32，请重新安装或重新打包同步助手'), 'pywin32'),
            (OSError(5, 'untrusted driver details'), '打印权限'),
            (OSError(1722, 'untrusted driver details'), 'Print Spooler'),
        ):
            with self.subTest(detail=detail), patch.object(server, 'build_native_label', return_value=b'PRINT 1,2'), patch.object(server, 'send_raw_tspl_to_printer', side_effect=error), patch.object(server, 'log', side_effect=AssertionError('no business log')):
                result = server.submit_native_label_reprint(make_payload())
            self.assertEqual(result['code'], 'PRINT_FAILED')
            self.assertIn(detail, result['message'])
            self.assertFalse(result['resultUnknown'])
            self.assertNotIn('untrusted driver details', result['message'])

    def test_queue_submission_error_remains_unknown_and_needs_operator_check(self):
        def spool(_printer, _commands, _job, submission_callback=None):
            submission_callback()
            raise RuntimeError(SOURCE_QR)

        with patch.object(server, 'build_native_label', return_value=b'PRINT 1,2'), patch.object(server, 'send_raw_tspl_to_printer', side_effect=spool) as send, patch.object(server, 'log', side_effect=AssertionError('no business log')):
            result = server.submit_native_label_reprint(make_payload())
            retry = server.submit_native_label_reprint(make_payload())
        self.assertEqual(result['code'], 'PRINT_RESULT_UNKNOWN')
        self.assertTrue(result['resultUnknown'])
        self.assertIn('出纸结果无法确认', result['message'])
        self.assertIn('先核对', result['message'])
        self.assertEqual(retry, result)
        self.assertNotIn(SOURCE_QR, repr(server.EPHEMERAL_REPRINT_JOBS))
        send.assert_called_once()


class ReprintLengthFixTest(unittest.TestCase):
    def test_boya_long_package_and_box_text_fit_without_trace_or_truncation(self):
        package = 'DFN(0405*0.65-1.20)010(E)'
        source_no = 'BOX' + '20261014' + '0000012345'
        record = {
            'model': 'BY25Q064ASWIG(R)', 'package': package, 'quantity': 3000,
            'batch': 'SYNTH01', 'production_date': '2642',
            'source_no': source_no, 'trace_no': '',
        }
        source_qr = (
            f'BOYA MICROELECTRONICS/PART NO.:{record["model"]}/PACKAGE:{package}/'
            f'QUANTITY:3000/LOT ID:SYNTH01/DATE CODE:2642/MSL3/Track ID:{source_no}'
        )
        self.assertEqual(len(package), 25)
        self.assertEqual(len(source_no), 21)
        with patch.object(boya, 'build_native_text_bitmap', return_value=b'BITMAP\r\n') as bitmap, patch.object(boya, 'build_reprint_qr_image', wraps=build_reprint_qr_image) as qr_layer:
            commands = label_templates.build_native_label(record, label_templates.NATIVE_LABEL_TEMPLATE_BOYA, source_qr=source_qr)
        displayed = [item[2] for item in bitmap.call_args.args[0]]
        self.assertIn(package, displayed)
        self.assertIn(source_no, displayed)
        self.assertEqual(qr_layer.call_args.args[0], source_qr)
        self.assertEqual(commands.count(b'PRINT 1,2'), 1)
        for item in bitmap.call_args.args[0]:
            if item[2] in (package, source_no):
                self.assertEqual(item[4:] or (23,), (23,))

    def test_apm_ordinary_model_can_use_the_actual_left_column(self):
        model = 'APM32F103CBT6'
        font = get_native_arial_font()
        self.assertGreater(font.getlength(model), 185)
        self.assertLessEqual(font.getlength(model), 196)
        record = {
            'model': model, 'batch': 'TEST01', 'package': 'LQFP48',
            'version': '811200000001', 'quantity': 5000,
            'production_date': '2642', 'trace_no': 'SYNTH000001-2', 'source_no': 'TESTBOX001',
        }
        source_qr = '/'.join(str(record[key]) for key in (
            'model', 'batch', 'package', 'version', 'quantity', 'production_date', 'trace_no', 'source_no',
        ))
        with patch.object(apm, 'build_native_text_bitmap', return_value=b'BITMAP\r\n') as bitmap, patch.object(apm, 'build_reprint_qr_image', wraps=build_reprint_qr_image) as qr_layer:
            commands = label_templates.build_native_label(record, label_templates.NATIVE_LABEL_TEMPLATE_LEADCORE, source_qr=source_qr)
        displayed = [item[2] for item in bitmap.call_args.args[0]]
        self.assertIn(model, displayed)
        self.assertIn('811200000001', displayed)
        self.assertEqual(qr_layer.call_args.args[0], source_qr)

    def test_reprint_preserves_ascii_spaces_and_punctuation_in_text_and_qr(self):
        record = {
            'model': 'TEST-MODEL', 'quantity': 50, 'batch': ' A  B.1 ',
            'package': 'SOP(8)*-0.5', 'production_date': '2642',
            'source_no': ' BOX  01 ', 'trace_no': ' TRACE  01 ', 'version': ' V  1 ',
        }
        source_qr = ' TEST-MODEL/ A  B.1 /SOP(8)*-0.5/ V  1 /50/2642/ TRACE  01 / BOX  01 '
        with patch.object(apm, 'build_native_text_bitmap', return_value=b'BITMAP\r\n') as bitmap, patch.object(apm, 'build_reprint_qr_image', wraps=build_reprint_qr_image) as qr_layer:
            commands = label_templates.build_native_label(record, label_templates.NATIVE_LABEL_TEMPLATE_LEADCORE, source_qr=source_qr)
        displayed = [item[2] for item in bitmap.call_args.args[0]]
        for key in ('batch', 'package', 'source_no', 'trace_no'):
            self.assertIn(record[key], displayed)
        self.assertIn('VER:  V  1 ', displayed)
        self.assertEqual(qr_layer.call_args.args[0], source_qr)

    def test_unsafe_and_overlarge_fields_identify_the_field_without_echoing_its_value(self):
        for value in ('UNSAFE"VALUE', 'UNSAFE\nVALUE', 'UNSAFE\x00VALUE', 'UNSAFE非ASCII', 'x' * 1001):
            with self.subTest(kind=len(value)), self.assertRaises(ValueError) as raised:
                normalize_tspl_value(value, 18, strict=True, field_name='封装')
            self.assertIn('封装', str(raised.exception))
            self.assertNotIn(value, str(raised.exception))

    def test_true_pixel_overflow_names_field_and_available_width(self):
        for module, template, record in (
            (apm, label_templates.NATIVE_LABEL_TEMPLATE_LEADCORE, {'model': 'W' * 20, 'quantity': 50}),
            (boya, label_templates.NATIVE_LABEL_TEMPLATE_BOYA, {'model': 'TEST', 'package': 'W' * 40, 'quantity': 50}),
        ):
            field_name = '型号' if module is apm else '封装'
            with self.subTest(template=template['key']), self.assertRaises(ValueError) as raised:
                label_templates.build_native_label(record, template, source_qr='TEST/50')
            message = str(raised.exception)
            self.assertIn(field_name, message)
            self.assertRegex(message, '文字超出模板宽度：需要[0-9.]+毫米，可用[0-9.]+毫米')
            self.assertNotIn(record['model'], message)

    def test_only_reprint_removes_legacy_character_limits(self):
        text = 'abcdefghijklmnopqrstuvwxyz'
        self.assertEqual(normalize_tspl_value(text, 18), text[:18])
        self.assertEqual(normalize_tspl_value(text, 18, strict=True), text)
        self.assertEqual(normalize_tspl_value(' A  B ', 18), 'A B')
        self.assertEqual(normalize_tspl_value(' A  B ', 18, strict=True), ' A  B ')

    def test_one_bit_ink_width_overflow_is_not_hidden_by_arial_advance_metrics(self):
        value = 'W' * 12
        font = get_native_arial_font()
        self.assertLessEqual(font.getlength(value), 265)
        self.assertGreater(font.getmask(value, mode='1').getbbox()[2], 265)
        with self.assertRaisesRegex(ValueError, '箱号文字超出模板宽度'):
            label_templates.build_native_label(
                make_payload(source_no=value)['record'],
                label_templates.NATIVE_LABEL_TEMPLATE_LEADCORE, source_qr='SYNTH/250',
            )


class SpoolUncertaintyTest(unittest.TestCase):
    def test_callback_occurs_before_start_doc_and_failures_cannot_go_unnoticed(self):
        for failing_step in ('OpenPrinter', 'StartDocPrinter', 'WritePrinter', 'EndDocPrinter', 'ClosePrinter'):
            printer = Mock()
            printer.EnumPrinters.return_value = [{'pPrinterName': 'Test Printer'}]
            printer.OpenPrinter.return_value = 'HANDLE'
            printer.StartDocPrinter.return_value = 12
            printer.WritePrinter.side_effect = lambda _handle, chunk: len(chunk)
            getattr(printer, failing_step).side_effect = RuntimeError(failing_step)
            printer.PRINTER_ENUM_LOCAL = 2
            printer.PRINTER_ENUM_CONNECTIONS = 4
            callback = Mock()
            with self.subTest(step=failing_step), patch.dict(sys.modules, {'win32print': printer}), self.assertRaises(RuntimeError):
                server.send_raw_tspl_to_printer('Test Printer', b'PRINT 1,2', 'Reprint', callback)
            if failing_step == 'OpenPrinter':
                callback.assert_not_called()
            else:
                callback.assert_called_once()


if __name__ == '__main__':
    unittest.main()
