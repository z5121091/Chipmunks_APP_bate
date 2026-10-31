"""Extra desktop notification wiring; no real tray, printer, or business data."""

import io
import json
import os
import tempfile
import threading
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import Mock, patch

from openpyxl import load_workbook

from scripts import label_sync_server as server
from scripts.sync_notifications import BusinessNotificationDispatcher
from scripts.test_label_reprint import make_payload
from scripts.test_sync_business_notifications import workbook_bytes, native_print_result


class ExtraNotificationWiringTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = directory.name
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.dispatcher = Mock()
        stack.enter_context(patch.object(server, 'BUSINESS_NOTIFICATIONS', self.dispatcher))
        stack.enter_context(patch.object(server, 'DATA_ROOT', self.directory))
        stack.enter_context(patch.object(server, 'EPHEMERAL_REPRINT_JOBS', {}))
        stack.enter_context(patch.object(server, 'enable_cors'))
        self.log = stack.enter_context(patch.object(server, 'log'))
        stack.enter_context(patch.object(server, 'read_sync_pairing_key', return_value=''))
        self.request = SimpleNamespace(headers={})
        self.response = SimpleNamespace(status=200, headers={})
        stack.enter_context(patch.object(server.cherrypy, 'request', self.request))
        stack.enter_context(patch.object(server.cherrypy, 'response', self.response))
        self.body = stack.enter_context(patch.object(
            server, 'read_excel_request_body', return_value=workbook_bytes(),
        ))
        self.spool = stack.enter_context(patch.object(
            server, 'send_raw_tspl_to_printer', side_effect=AssertionError('real printer called'),
        ))
        self.build = stack.enter_context(patch.object(
            server, 'build_native_label', return_value=b'PRINT 1,2',
        ))

    def post(self, endpoint, **kwargs):
        return json.loads(endpoint.POST(**kwargs))

    def reprint(self, payload=None, *, raw=None, content_type='application/json', length=None):
        if raw is None:
            raw = json.dumps(make_payload() if payload is None else payload).encode('utf-8')
        self.request.headers = {
            'Content-Type': content_type,
            'Content-Length': str(len(raw) if length is None else length),
        }
        self.request.rfile = io.BytesIO(raw)
        return self.post(server.LabelReprint())

    def events(self):
        return [(call.args[0], call.args[1], call.kwargs)
                for call in self.dispatcher.publish.call_args_list]

    def assert_event(self, category, outcome, **details):
        self.assertEqual(self.events(), [(category, outcome, details)])
        serialized = repr(self.events())
        for private in ('CH334U', 'W52609160004006-1', 'private-', self.directory):
            self.assertNotIn(private, serialized)

    def test_inventory_notification_follows_real_atomic_save_and_counts_all_sheets(self):
        self.body.return_value = workbook_bytes(multiple_sheets=True)

        def verify_committed_file(*_args, **_kwargs):
            path = os.path.join(self.directory, 'checked.xlsx')
            self.assertTrue(os.path.isfile(path))
            saved = load_workbook(path)
            self.assertEqual(len(saved.sheetnames), 2)
            saved.close()
            self.assertEqual(os.listdir(self.directory), ['checked.xlsx'])

        self.dispatcher.publish.side_effect = verify_committed_file
        result = self.post(server.Inventory(), file_name='checked.xlsx')
        self.assertTrue(result['success'])
        self.assertEqual(result['count'], 3)
        self.assert_event('inventory', 'success', count=3, file_name='checked.xlsx')
        self.spool.assert_not_called()

    def test_inventory_legacy_label_export_is_reported_as_labels_and_never_prints(self):
        with patch.object(server, 'submit_native_unpack_labels') as submit:
            result = self.post(server.Inventory(), name_suffix='拆包标签')
        self.assertTrue(result['success'])
        self.assert_event('order_labels', 'success', count=1, file_name='拆包标签.xlsx')
        submit.assert_not_called()
        self.spool.assert_not_called()

    def test_inventory_invalid_workbook_reports_safe_failure(self):
        self.body.return_value = b'private-model private-trace not-excel'
        result = self.post(server.Inventory())
        self.assertFalse(result['success'])
        self.assert_event('inventory', 'failure', reason='invalid_content')
        self.assertEqual(os.listdir(self.directory), [])

    def test_inventory_permission_failure_cleans_temp_and_reports_safe_reason(self):
        with patch.object(server, 'save_workbook_atomically', side_effect=PermissionError('private-error')):
            result = self.post(server.Inventory())
        self.assertFalse(result['success'])
        self.assert_event('inventory', 'failure', reason='file_access')
        self.assertEqual(os.listdir(self.directory), [])

    def test_inventory_legacy_label_failure_uses_same_label_category(self):
        with patch.object(server, 'save_workbook_atomically', side_effect=PermissionError('private-error')):
            result = self.post(server.Inventory(), name_suffix='拆包标签')
        self.assertFalse(result['success'])
        self.assert_event('order_labels', 'failure', reason='file_access')

    def test_ordinary_order_label_export_saves_and_notifies_without_native_printing(self):
        def verify_saved(*_args, **_kwargs):
            path = os.path.join(self.directory, '标签打印.xlsx')
            saved = load_workbook(path)
            self.assertEqual(saved.active.cell(2, 1).value, 'private-model')
            saved.close()

        self.dispatcher.publish.side_effect = verify_saved
        with patch.object(server, 'submit_native_unpack_labels') as submit:
            result = self.post(server.Labels())
        self.assertTrue(result['success'])
        self.assert_event('order_labels', 'success', count=1, file_name='标签打印.xlsx')
        submit.assert_not_called()
        self.spool.assert_not_called()

    def test_order_label_export_failure_is_reported_with_no_model_or_error_details(self):
        self.body.side_effect = ValueError('private-error private-model private-trace')
        result = self.post(server.Labels())
        self.assertFalse(result['success'])
        self.assert_event('order_labels', 'failure', reason='invalid_content')
        self.assertEqual(os.listdir(self.directory), [])

    def test_unpack_mode_does_not_emit_a_second_order_export_notification(self):
        mode = sorted(server.SUPPORTED_NATIVE_LABEL_PRINT_MODES)[0]
        with patch.object(server, 'submit_native_unpack_labels', return_value=native_print_result()):
            result = self.post(server.Labels(), print_mode=mode)
        self.assertTrue(result['success'])
        self.assert_event('unpack', 'submitted', count=0, label_count=5)

    def test_notifications_cannot_turn_saved_files_into_failures(self):
        self.dispatcher.publish.side_effect = RuntimeError('private-error notification unavailable')
        for endpoint in (server.Inventory(), server.Labels()):
            with self.subTest(endpoint=type(endpoint).__name__):
                result = self.post(endpoint)
                self.assertTrue(result['success'])
                self.assertTrue(os.path.isfile(result['path']))

    def test_reprint_real_submission_notifies_two_copies_once_and_writes_no_files_or_logs(self):
        self.spool.side_effect = None
        self.spool.return_value = 42
        with ExitStack() as stack:
            forbidden = [stack.enter_context(patch.object(server, name, side_effect=AssertionError(name)))
                         for name in ('load_native_print_history', 'save_native_print_history',
                                      'save_workbook_atomically', 'build_native_unpack_time_label', 'load_workbook')]
            opened = stack.enter_context(patch('builtins.open', side_effect=AssertionError('file access')))
            database = stack.enter_context(patch.object(server.sqlite3, 'connect', side_effect=AssertionError('database write')))
            first = self.reprint()
            second = self.reprint()
        self.assertTrue(first['success'])
        self.assertEqual(first['state'], 'submitted')
        self.assertEqual(first['copies'], 2)
        self.assertTrue(second['duplicate'])
        self.assert_event('reprint', 'submitted', label_count=2)
        self.spool.assert_called_once()
        self.log.assert_not_called()
        opened.assert_not_called()
        database.assert_not_called()
        for method in forbidden:
            method.assert_not_called()
        self.assertEqual(os.listdir(self.directory), [])

    def test_reprint_no_template_is_failure_even_when_retry_is_not_allowed(self):
        result = self.reprint(make_payload(supplier='private-unknown-supplier'))
        self.assertFalse(result['success'])
        self.assertFalse(result['retryAllowed'])
        self.assertEqual(result['code'], 'NO_TEMPLATE')
        self.assert_event('reprint', 'failure', reason='invalid_content')
        self.spool.assert_not_called()
        self.log.assert_not_called()

    def test_reprint_invalid_field_is_failure_without_publishing_source(self):
        result = self.reprint(make_payload(quantity='-1'))
        self.assertEqual(result['code'], 'INVALID_LABEL_CONTENT')
        self.assert_event('reprint', 'failure', reason='invalid_content')
        self.spool.assert_not_called()
        self.log.assert_not_called()

    def test_reprint_job_conflict_is_failure_and_does_not_resubmit(self):
        self.spool.side_effect = None
        self.spool.return_value = 42
        self.assertTrue(self.reprint()['success'])
        self.dispatcher.reset_mock()
        result = self.reprint(make_payload(quantity='251'))
        self.assertEqual(result['code'], 'JOB_CONFLICT')
        self.assert_event('reprint', 'failure', reason='invalid_content')
        self.spool.assert_called_once()
        self.log.assert_not_called()

    def test_reprint_failure_before_submission_reports_printer_failure(self):
        self.spool.side_effect = RuntimeError('private-error printer missing')
        result = self.reprint()
        self.assertEqual(result['code'], 'PRINT_FAILED')
        self.assertFalse(result['resultUnknown'])
        self.assert_event('reprint', 'failure', reason='printer_error')
        self.log.assert_not_called()

    def test_reprint_failure_after_submission_reports_unknown_not_success(self):
        def spool(_printer, _commands, _title, submission_callback=None):
            submission_callback()
            raise RuntimeError('private-error partial spool')

        self.spool.side_effect = spool
        result = self.reprint()
        self.assertEqual(result['code'], 'PRINT_RESULT_UNKNOWN')
        self.assertTrue(result['resultUnknown'])
        self.assertEqual([(category, outcome) for category, outcome, _ in self.events()], [('reprint', 'unknown')])
        self.assertLessEqual(set(self.events()[0][2]), {'reason'})
        self.assertNotIn('private-', repr(self.events()))
        self.log.assert_not_called()

    def test_reprint_old_session_reports_unknown_without_calling_printer(self):
        result = self.reprint(dict(make_payload(), reprint_session_id='private-old-session'))
        self.assertEqual(result['code'], 'SESSION_CHANGED')
        self.assertTrue(result['resultUnknown'])
        self.assertEqual([(category, outcome) for category, outcome, _ in self.events()], [('reprint', 'unknown')])
        self.spool.assert_not_called()
        self.log.assert_not_called()

    def test_reprint_request_validation_failures_notify_only_generic_invalid_content(self):
        cases = (
            dict(raw=b'{private-invalid-json'),
            dict(raw=b'{}', content_type='text/plain'),
            dict(raw=b'{}', length=3),
            dict(raw=b''),
            dict(raw=b'{}', length=server.MAX_LABEL_REPRINT_BYTES + 1),
        )
        for kwargs in cases:
            with self.subTest(kwargs=kwargs):
                self.dispatcher.reset_mock()
                result = self.reprint(**kwargs)
                self.assertFalse(result['success'])
                self.assertEqual(result['code'], 'INVALID_REQUEST')
                self.assert_event('reprint', 'failure', reason='invalid_content')
        self.spool.assert_not_called()
        self.log.assert_not_called()

    def test_reprint_unexpected_submit_error_reports_unknown_and_does_not_log(self):
        with patch.object(server, 'submit_native_label_reprint', side_effect=RuntimeError('private-model private-trace')):
            result = self.reprint()
        self.assertFalse(result['success'])
        self.assertTrue(result['resultUnknown'])
        self.assertEqual([(category, outcome) for category, outcome, _ in self.events()], [('reprint', 'unknown')])
        self.assertNotIn('private-', repr(self.events()))
        self.log.assert_not_called()

    def test_reprint_notification_exception_preserves_accepted_response(self):
        self.dispatcher.publish.side_effect = RuntimeError('private-error notification failed')
        self.spool.side_effect = None
        self.spool.return_value = 42
        result = self.reprint()
        self.assertTrue(result['success'])
        self.assertEqual(result['state'], 'submitted')
        self.assertEqual(result['copies'], 2)
        self.log.assert_not_called()

    def test_all_three_categories_are_silent_on_pairing_denial(self):
        with patch.object(server, 'read_sync_pairing_key', return_value='private-key'), \
                patch.object(server, 'submit_native_label_reprint') as submit:
            for endpoint in (server.Inventory(), server.Labels(), server.LabelReprint()):
                with self.subTest(endpoint=type(endpoint).__name__):
                    self.request.headers = {server.SYNC_PAIRING_HEADER: 'wrong-key'}
                    result = self.post(endpoint)
                    self.assertEqual(result['code'], 'SYNC_PAIRING_REQUIRED')
                    self.assertEqual(self.response.status, 401)
        self.dispatcher.publish.assert_not_called()
        self.body.assert_not_called()
        self.spool.assert_not_called()
        submit.assert_not_called()

    def test_real_dispatcher_routes_reprint_to_ephemeral_tray_without_log_or_file_writes(self):
        tray = object.__new__(server.TrayIcon)
        delivered = threading.Event()
        messages = []

        def desktop_notice(message, title):
            messages.append((title, message))
            delivered.set()

        tray.icon = SimpleNamespace(notify=desktop_notice)
        dispatcher = BusinessNotificationDispatcher(merge_window_seconds=0)
        self.addCleanup(dispatcher.stop)
        with patch.object(server, 'BUSINESS_NOTIFICATIONS', dispatcher), \
                patch.object(tray, 'notify', side_effect=AssertionError('regular logging sender called')), \
                patch('builtins.open', side_effect=AssertionError('file access')) as opened, \
                patch.object(server.sqlite3, 'connect', side_effect=AssertionError('database write')) as database:
            dispatcher.start(tray.notify, ephemeral_sender=tray.notify_ephemeral)
            self.spool.side_effect = None
            self.spool.return_value = 42
            result = self.reprint()
            self.assertTrue(result['success'])
            self.assertTrue(delivered.wait(2), 'reprint notification was not delivered')
            dispatcher.stop()
        self.assertEqual(len(messages), 1)
        self.assertIn('补打标签', messages[0][0])
        self.assertIn('2 张', messages[0][1])
        for private in ('CH334U', 'W52609160004006-1', 'REPRINT-1'):
            self.assertNotIn(private, repr(messages))
        self.log.assert_not_called()
        opened.assert_not_called()
        database.assert_not_called()
        self.assertEqual(os.listdir(self.directory), [])

    def test_ephemeral_tray_notification_failure_does_not_fall_back_to_logging(self):
        tray = object.__new__(server.TrayIcon)
        tray.icon = Mock()
        tray.icon.notify.side_effect = RuntimeError('private-error Windows toast')
        with patch('builtins.open', side_effect=AssertionError('file access')) as opened:
            tray.notify_ephemeral('补打标签已提交打印', '已提交 2 张标签至打印队列。')
        self.log.assert_not_called()
        opened.assert_not_called()


if __name__ == '__main__':
    unittest.main()
