"""Business-to-notification wiring, using temporary files and no real spooling."""

import io
import errno
import json
import os
import sys
import tempfile
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import Mock, patch

from openpyxl import Workbook, load_workbook

from scripts import label_sync_server as server


SAFE_FAILURE_REASONS = {
    'file_access', 'disk_full', 'invalid_content', 'printer_error', 'service_error',
}


def workbook_bytes(*, multiple_sheets=False):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append([
        '型号', '标签数量', '追溯码', '批次', '生产日期', '封装',
        '存货编码', '箱号', '版本号', '标签类型', '供应商',
    ])
    sheet.append([
        'private-model', 250, 'private-trace', 'private-batch', '20261019',
        'private-package', 'private-product', 'private-box', 'V1', '剩余标签',
        '珠海极海半导体有限公司',
    ])
    if multiple_sheets:
        other = workbook.create_sheet('其他仓库')
        other.append(['型号', '数量'])
        other.append(['private-second-model', 10])
        other.append(['private-third-model', 20])
    buffer = io.BytesIO()
    workbook.save(buffer)
    workbook.close()
    return buffer.getvalue()


def native_print_result(**overrides):
    result = {
        'printed_count': 2,
        'skipped_count': 0,
        'skipped_suppliers': [],
        'template_names': ['极海'],
        'job_id': 'private-print-job',
        'duplicate': False,
        'spool_job_id': 17,
        'time_label_count': 1,
        'physical_label_count': 5,
    }
    result.update(overrides)
    return result


class BusinessNotificationWiringTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = directory.name
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.dispatcher = Mock()
        stack.enter_context(patch.object(server, 'BUSINESS_NOTIFICATIONS', self.dispatcher))
        stack.enter_context(patch.object(server, 'DATA_ROOT', self.directory))
        stack.enter_context(patch.object(server, 'enable_cors'))
        stack.enter_context(patch.object(server, 'log'))
        stack.enter_context(patch.object(server, 'read_sync_pairing_key', return_value=''))
        self.request = SimpleNamespace(headers={})
        self.response = SimpleNamespace(status=200, headers={})
        stack.enter_context(patch.object(server.cherrypy, 'request', self.request))
        stack.enter_context(patch.object(server.cherrypy, 'response', self.response))
        self.body = stack.enter_context(patch.object(
            server, 'read_excel_request_body', return_value=workbook_bytes(),
        ))
        self.send_to_printer = stack.enter_context(patch.object(
            server, 'send_raw_tspl_to_printer', side_effect=AssertionError('real printer called'),
        ))
        self.native_mode = sorted(server.SUPPORTED_NATIVE_LABEL_PRINT_MODES)[0]

    def post(self, endpoint, **kwargs):
        return json.loads(endpoint.POST(**kwargs))

    def events(self):
        return [
            (call.args[0], call.args[1], call.kwargs)
            for call in self.dispatcher.publish.call_args_list
        ]

    def assert_safe_failure(self, category, outcome='failure'):
        self.assertEqual(len(self.events()), 1)
        actual_category, actual_outcome, details = self.events()[0]
        self.assertEqual((actual_category, actual_outcome), (category, outcome))
        self.assertIn(details['reason'], SAFE_FAILURE_REASONS)
        serialized = repr(self.events())
        for secret in ('private-model', 'private-trace', 'private-batch', 'private-error', self.directory):
            self.assertNotIn(secret, serialized)
        self.assertLessEqual(set(details), {'count', 'file_name', 'label_count', 'reason'})

    def test_inbound_and_outbound_notify_after_atomic_save_with_actual_row_total(self):
        self.body.return_value = workbook_bytes(multiple_sheets=True)
        for endpoint_type, category in ((server.Inbound, 'inbound'), (server.Outbound, 'outbound')):
            with self.subTest(category=category):
                self.dispatcher.reset_mock()
                filename = f'{category}-records.xlsx'

                def check_saved_file(*_args, **_kwargs):
                    path = os.path.join(self.directory, filename)
                    self.assertTrue(os.path.isfile(path), 'notification preceded committed file')
                    saved = load_workbook(path)
                    self.assertEqual(len(saved.sheetnames), 2)
                    saved.close()

                self.dispatcher.publish.side_effect = check_saved_file
                result = self.post(endpoint_type(), file_name=filename)
                self.assertTrue(result['success'])
                self.assertEqual(result['count'], 3)
                self.assertEqual(len(self.events()), 1)
                actual_category, outcome, details = self.events()[0]
                self.assertEqual((actual_category, outcome), (category, 'success'))
                self.assertEqual(details['count'], 3)
                self.assertEqual(details['file_name'], filename)
                self.assertNotIn('private-', repr(self.events()))

    def test_save_failure_publishes_only_safe_reason_and_no_success(self):
        for endpoint_type, category in ((server.Inbound, 'inbound'), (server.Outbound, 'outbound')):
            with self.subTest(category=category):
                self.dispatcher.reset_mock()
                with patch.object(server, 'save_workbook_atomically', side_effect=PermissionError(
                    f'private-error private-trace {self.directory}',
                )):
                    result = self.post(endpoint_type(), file_name='records')
                self.assertFalse(result['success'])
                self.assert_safe_failure(category)
                self.assertEqual(self.events()[0][2]['reason'], 'file_access')
                self.assertEqual(os.listdir(self.directory), [])

    def test_invalid_workbook_publishes_no_source_content(self):
        self.body.return_value = b'private-error private-model invalid-xlsx'
        for endpoint_type, category in ((server.Inbound, 'inbound'), (server.Outbound, 'outbound')):
            with self.subTest(category=category):
                self.dispatcher.reset_mock()
                result = self.post(endpoint_type())
                self.assertFalse(result['success'])
                self.assert_safe_failure(category)

    def test_dispatcher_failure_does_not_change_successful_saved_response(self):
        self.dispatcher.publish.side_effect = RuntimeError('private-error toast failed')
        for endpoint_type in (server.Inbound, server.Outbound):
            with self.subTest(endpoint=endpoint_type.__name__):
                result = self.post(endpoint_type(), file_name=endpoint_type.__name__)
                self.assertTrue(result['success'])
                self.assertTrue(os.path.isfile(result['path']))

    def test_new_unpack_job_uses_physical_labels_including_time_label(self):
        with patch.object(server, 'submit_native_unpack_labels', return_value=native_print_result()) as submit:
            result = self.post(server.Labels(), print_mode=self.native_mode, print_job_id='job-1')
        self.assertTrue(result['success'])
        self.assertTrue(result['nativePrint'])
        self.assertEqual(result['nativePrintPhysicalLabelCount'], 5)
        self.assertEqual(len(self.events()), 1)
        category, outcome, details = self.events()[0]
        self.assertEqual((category, outcome), ('unpack', 'submitted'))
        self.assertEqual(details['label_count'], 5)
        self.assertNotIn('private-', repr(self.events()))
        submit.assert_called_once()
        self.send_to_printer.assert_not_called()

    def test_mixed_unpack_result_uses_one_notice_with_physical_labels_and_skipped_count(self):
        mixed = native_print_result(skipped_count=1, skipped_suppliers=['private-supplier'])
        with patch.object(server, 'submit_native_unpack_labels', return_value=mixed):
            result = self.post(server.Labels(), print_mode=self.native_mode)
        self.assertTrue(result['success'])
        self.assertEqual([(event[0], event[1]) for event in self.events()], [('unpack', 'submitted')])
        self.assertEqual(self.events()[0][2]['label_count'], 5)
        self.assertEqual(self.events()[0][2]['count'], 1)
        self.assertNotIn('private-', repr(self.events()))

    def test_all_unsupported_suppliers_report_saved_not_printed(self):
        skipped = native_print_result(
            printed_count=0, skipped_count=2, skipped_suppliers=['private-supplier'],
            physical_label_count=0, time_label_count=0, spool_job_id=None,
        )
        with patch.object(server, 'submit_native_unpack_labels', return_value=skipped):
            result = self.post(server.Labels(), print_mode=self.native_mode)
        self.assertTrue(result['success'])
        self.assertFalse(result['nativePrint'])
        self.assertTrue(result['nativePrintSkipped'])
        self.assertEqual(len(self.events()), 1)
        category, outcome, details = self.events()[0]
        self.assertEqual((category, outcome), ('unpack', 'skipped'))
        self.assertEqual(details['count'], 2)

    def test_duplicate_unpack_job_emits_no_repeated_submitted_or_skipped_notice(self):
        duplicate = native_print_result(
            duplicate=True, skipped_count=1, skipped_suppliers=['private-supplier'],
        )
        with patch.object(server, 'submit_native_unpack_labels', return_value=duplicate):
            result = self.post(server.Labels(), print_mode=self.native_mode)
        self.assertTrue(result['success'])
        self.assertTrue(result['nativePrintDuplicate'])
        self.dispatcher.publish.assert_not_called()

    def test_unknown_print_result_gets_unknown_notice_and_retains_unknown_response(self):
        error = server.UnpackPrintOutcomeUnknownError('private-error private-trace')
        with patch.object(server, 'submit_native_unpack_labels', side_effect=error):
            result = self.post(server.Labels(), print_mode=self.native_mode)
        self.assertFalse(result['success'])
        self.assertEqual(result['code'], 'PRINT_RESULT_UNKNOWN')
        self.assertTrue(result['resultUnknown'])
        self.assert_safe_failure('unpack', 'unknown')

    def test_native_validation_failure_does_not_claim_submission(self):
        with patch.object(server, 'get_native_label_records', side_effect=ValueError('private-error private-model')), \
                patch.object(server, 'submit_native_unpack_labels') as submit:
            result = self.post(server.Labels(), print_mode=self.native_mode)
        self.assertFalse(result['success'])
        self.assert_safe_failure('unpack')
        submit.assert_not_called()

    def test_native_print_failure_is_not_reported_as_success(self):
        with patch.object(server, 'submit_native_unpack_labels', side_effect=RuntimeError('private-error printer')):
            result = self.post(server.Labels(), print_mode=self.native_mode)
        self.assertFalse(result['success'])
        self.assert_safe_failure('unpack')
        self.assertEqual(self.events()[0][2]['reason'], 'printer_error')

    def test_wrapped_print_state_save_errors_preserve_safe_disk_or_permission_reason(self):
        for cause, reason in ((OSError(errno.ENOSPC, 'private-error'), 'disk_full'),
                              (PermissionError('private-error'), 'file_access')):
            with self.subTest(reason=reason):
                self.dispatcher.reset_mock()
                wrapped = RuntimeError('private-error private-trace state save')
                wrapped.__cause__ = cause
                with patch.object(server, 'submit_native_unpack_labels', side_effect=wrapped):
                    result = self.post(server.Labels(), print_mode=self.native_mode)
                self.assertFalse(result['success'])
                self.assert_safe_failure('unpack')
                self.assertEqual(self.events()[0][2]['reason'], reason)

    def test_failure_classification_bounds_cyclic_causes(self):
        first = RuntimeError('private-error first')
        second = RuntimeError('private-error second')
        first.__cause__ = second
        second.__cause__ = first
        self.assertEqual(server.get_notification_failure_reason(first, printing=True), 'printer_error')

    def test_notification_failure_does_not_change_accepted_unpack_result(self):
        self.dispatcher.publish.side_effect = RuntimeError('private-error toast failed')
        with patch.object(server, 'submit_native_unpack_labels', return_value=native_print_result()):
            result = self.post(server.Labels(), print_mode=self.native_mode)
        self.assertTrue(result['success'])
        self.assertEqual(result['nativePrintPhysicalLabelCount'], 5)

    def test_notification_failure_preserves_unknown_print_response(self):
        self.dispatcher.publish.side_effect = RuntimeError('private-error toast failed')
        with patch.object(server, 'submit_native_unpack_labels', side_effect=server.UnpackPrintOutcomeUnknownError(
            'private-error original unknown result',
        )):
            result = self.post(server.Labels(), print_mode=self.native_mode)
        self.assertFalse(result['success'])
        self.assertEqual(result['code'], 'PRINT_RESULT_UNKNOWN')
        self.assertTrue(result['resultUnknown'])

    def test_ordinary_label_export_does_not_publish_unpack_notifications(self):
        with patch.object(server, 'submit_native_unpack_labels') as submit:
            result = self.post(server.Labels())
        self.assertTrue(result['success'])
        self.assertEqual(self.events(), [('order_labels', 'success', {'count': 1, 'file_name': '标签打印.xlsx'})])
        submit.assert_not_called()

    def test_ordinary_label_export_failure_does_not_publish_unpack_notifications(self):
        self.body.side_effect = ValueError('private-error export')
        result = self.post(server.Labels())
        self.assertFalse(result['success'])
        self.assert_safe_failure('order_labels')

    def test_pairing_denial_never_publishes_or_processes_business(self):
        for endpoint_type in (server.Inbound, server.Outbound, server.Labels, server.LabelReprint):
            for candidate in ('', 'wrong-key'):
                with self.subTest(endpoint=endpoint_type.__name__, candidate=candidate), \
                        patch.object(server, 'read_sync_pairing_key', return_value='private-pairing-key'):
                    self.request.headers = {server.SYNC_PAIRING_HEADER: candidate}
                    result = self.post(endpoint_type())
                    self.assertFalse(result['success'])
                    self.assertEqual(result['code'], 'SYNC_PAIRING_REQUIRED')
                    self.assertEqual(self.response.status, 401)
        self.body.assert_not_called()
        self.dispatcher.publish.assert_not_called()

    def test_bad_pairing_configuration_never_publishes_business_notifications(self):
        with patch.object(server, 'read_sync_pairing_key', side_effect=ValueError('bad configuration')):
            for endpoint_type in (server.Inbound, server.Outbound, server.Labels):
                with self.subTest(endpoint=endpoint_type.__name__):
                    result = self.post(endpoint_type())
                    self.assertEqual(result['code'], 'SYNC_PAIRING_CONFIG_ERROR')
        self.body.assert_not_called()
        self.dispatcher.publish.assert_not_called()

    def test_matching_pairing_key_keeps_business_notifications_enabled(self):
        self.request.headers = {server.SYNC_PAIRING_HEADER: 'private-pairing-key'}
        with patch.object(server, 'read_sync_pairing_key', return_value='private-pairing-key'):
            for endpoint_type, category in ((server.Inbound, 'inbound'), (server.Outbound, 'outbound')):
                with self.subTest(category=category):
                    self.dispatcher.reset_mock()
                    result = self.post(endpoint_type(), file_name=category)
                    self.assertTrue(result['success'])
                    self.assertEqual([(event[0], event[1]) for event in self.events()], [(category, 'success')])
            self.dispatcher.reset_mock()
            with patch.object(server, 'submit_native_unpack_labels', return_value=native_print_result()):
                result = self.post(server.Labels(), print_mode=self.native_mode)
            self.assertTrue(result['success'])
            self.assertEqual([(event[0], event[1]) for event in self.events()], [('unpack', 'submitted')])
        self.assertNotIn('private-pairing-key', repr(self.events()))

    def test_temporary_reprint_notifies_without_business_storage(self):
        self.request.headers = {'Content-Type': 'application/json', 'Content-Length': '2'}
        self.request.rfile = io.BytesIO(b'{}')
        with patch.object(server, 'submit_native_label_reprint', return_value={
            'success': True, 'state': 'submitted', 'copies': 2, 'duplicate': False,
        }) as reprint, patch.object(server, 'log', side_effect=AssertionError('reprint logged')):
            result = self.post(server.LabelReprint())
        self.assertTrue(result['success'])
        reprint.assert_called_once_with({})
        self.assertEqual(self.events(), [('reprint', 'submitted', {'label_count': 2})])
        self.assertEqual(os.listdir(self.directory), [])

    def test_tray_binds_business_sender_and_stops_it_on_normal_or_failed_exit(self):
        for run_error in (None, RuntimeError('test tray failure')):
            with self.subTest(run_error=run_error):
                self.dispatcher.reset_mock()
                tray = object.__new__(server.TrayIcon)
                tray.running = True
                tray.address_monitor = Mock()
                tray.create_icon_image = Mock(return_value='test-icon-image')
                icon = Mock()
                fake_pystray = SimpleNamespace(
                    Menu=Mock(), MenuItem=Mock(), Icon=Mock(return_value=icon),
                )

                def run_tray():
                    self.dispatcher.start.assert_called_once_with(tray.notify, ephemeral_sender=tray.notify_ephemeral)
                    tray.address_monitor.start.assert_called_once_with(tray.refresh_network_address)
                    if run_error is not None:
                        raise run_error

                icon.run.side_effect = run_tray
                with patch.dict(sys.modules, {'pystray': fake_pystray}):
                    if run_error is None:
                        tray.run()
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'test tray failure'):
                            tray.run()
                self.dispatcher.stop.assert_called_once_with()
                tray.address_monitor.stop.assert_called_once_with()

    def test_quit_stops_business_notifications_before_the_tray_and_http_service(self):
        tray = object.__new__(server.TrayIcon)
        tray.running = True
        tray.address_monitor = Mock()
        tray.pairing_window = Mock()
        tray.icon = Mock()
        order = []
        self.dispatcher.stop.side_effect = lambda: order.append('notifications')
        tray.icon.stop.side_effect = lambda: order.append('tray')
        with patch.object(server.cherrypy.engine, 'exit', side_effect=lambda: order.append('http')):
            tray.quit_app()
        self.assertEqual(order, ['notifications', 'tray', 'http'])
        self.assertFalse(tray.running)


if __name__ == '__main__':
    unittest.main()
