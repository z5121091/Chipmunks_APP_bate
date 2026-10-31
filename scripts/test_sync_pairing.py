"""Local pairing tests; temporary settings, real CherryPy dispatch, mocked spooling."""

import io
import json
import os
import tempfile
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch
from wsgiref.util import setup_testing_defaults

from scripts import label_sync_server as server
from scripts.sync_pairing_settings import save_pairing_settings
from scripts.test_label_reprint import make_payload


class SyncPairingTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = directory.name
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(server, 'SYNC_CONFIG_FILE', os.path.join(directory.name, 'settings.json')))
        stack.enter_context(patch.dict(os.environ, {}, clear=False))
        os.environ.pop(server.SYNC_PAIRING_ENV, None)

    def write_config(self, config):
        with open(server.SYNC_CONFIG_FILE, 'w', encoding='utf-8') as output:
            json.dump(config, output)

    def request(self, endpoint, method='POST', key=None, payload=b'not parsed'):
        app = server.cherrypy.Application(endpoint, config={
            '/': {
                'request.dispatch': server.cherrypy.dispatch.MethodDispatcher(),
                'request.process_request_body': False,
                'tools.cors.on': True,
            },
        })
        environ = {}
        setup_testing_defaults(environ)
        environ.update({
            'REQUEST_METHOD': method, 'PATH_INFO': '/', 'CONTENT_TYPE': 'application/json',
            'CONTENT_LENGTH': str(len(payload)), 'wsgi.input': io.BytesIO(payload),
        })
        if key is not None:
            environ['HTTP_X_SYNC_PAIRING_KEY'] = key
        captured = {}

        def start_response(status, headers, _exc_info=None):
            captured.update(status=status, headers=dict(headers))

        with patch.object(app.log, 'access'):
            body = b''.join(app(environ, start_response))
        return captured, json.loads(body) if body else None

    def test_missing_configuration_keeps_legacy_compatibility_without_creating_file(self):
        self.assertEqual(server.read_sync_pairing_key(), '')
        self.assertEqual(os.listdir(self.directory), [])
        with patch.object(server, 'read_excel_request_body', side_effect=ValueError('reached upload parser')), \
                patch.object(server, 'log'):
            captured, result = self.request(server.Inbound())
        self.assertEqual(captured['status'], '200 OK')
        self.assertEqual(result['message'], 'reached upload parser')

    def test_environment_overrides_file_and_explicit_empty_value_disables_pairing(self):
        self.write_config({'pairingKey': 'file-key'})
        self.assertEqual(server.read_sync_pairing_key(), 'file-key')
        with patch.dict(os.environ, {server.SYNC_PAIRING_ENV: ' env-key '}):
            self.assertEqual(server.read_sync_pairing_key(), 'env-key')
        with patch.dict(os.environ, {server.SYNC_PAIRING_ENV: ''}):
            self.assertEqual(server.read_sync_pairing_key(), '')

    def test_all_mutation_routes_reject_missing_or_wrong_key_before_any_side_effect(self):
        self.write_config({'pairingKey': 'pair-SECRET'})
        for endpoint in (server.Inbound, server.Outbound, server.Inventory, server.Labels, server.Materials, server.LabelReprint):
            for key in (None, 'wrong-key'):
                with self.subTest(endpoint=endpoint.__name__, key=key), \
                        patch.object(server, 'read_excel_request_body', side_effect=AssertionError('body read')), \
                        patch.object(server, 'submit_native_label_reprint', side_effect=AssertionError('reprint')), \
                        patch.object(server, 'log', side_effect=AssertionError('log')):
                    captured, result = self.request(endpoint(), key=key)
                self.assertEqual(captured['status'], '401 Unauthorized')
                self.assertEqual(result['code'], 'SYNC_PAIRING_REQUIRED')
                self.assertNotIn('pair-SECRET', repr(result))

    def test_matching_key_allows_excel_and_reprint_handlers(self):
        self.write_config({'pairingKey': 'pair-SECRET'})
        with patch.object(server, 'read_excel_request_body', side_effect=ValueError('accepted upload')), \
                patch.object(server, 'log'):
            captured, result = self.request(server.Inbound(), key='pair-SECRET')
        self.assertEqual(captured['status'], '200 OK')
        self.assertEqual(result['message'], 'accepted upload')
        with patch.object(server, 'submit_native_label_reprint', return_value={'success': True}) as reprint:
            captured, result = self.request(server.LabelReprint(), key='pair-SECRET', payload=b'{}')
        self.assertEqual(captured['status'], '200 OK')
        self.assertTrue(result['success'])
        reprint.assert_called_once_with({})

    def test_health_discloses_pairing_status_and_verifies_key_without_echoing_it(self):
        self.write_config({'pairingKey': 'pair-SECRET'})
        with patch.object(server, 'get_lan_ipv4_addresses', return_value=[]):
            for key, authenticated in ((None, False), ('wrong-key', False), ('pair-SECRET', True)):
                captured, result = self.request(server.Health(), method='GET', key=key)
                self.assertEqual(captured['status'], '200 OK')
                self.assertTrue(result['pairingRequired'])
                self.assertEqual(result['pairingAuthenticated'], authenticated)
                self.assertEqual(result['pairingHeader'], 'X-Sync-Pairing-Key')
                self.assertNotIn('pair-SECRET', repr(result))

    def test_invalid_config_fails_closed_for_health_and_mutations(self):
        for config in ({'pairingKey': 123}, {'pairingKey': 'a b'}, {'pairingKey': '中'}, {'pairingKey': 'x' * 129}, []):
            self.write_config(config)
            for endpoint, method in ((server.Health(), 'GET'), (server.LabelReprint(), 'POST')):
                with self.subTest(config=config, method=method), \
                        patch.object(server, 'send_raw_tspl_to_printer') as send:
                    captured, result = self.request(endpoint, method=method)
                    self.assertEqual(captured['status'], '503 Service Unavailable')
                    self.assertEqual(result['code'], 'SYNC_PAIRING_CONFIG_ERROR')
                    send.assert_not_called()
        with open(server.SYNC_CONFIG_FILE, 'w', encoding='utf-8') as output:
            output.write('{broken')
        captured, result = self.request(server.Inbound())
        self.assertEqual(captured['status'], '503 Service Unavailable')

    def test_preflight_permits_pairing_header_without_requiring_a_secret(self):
        self.write_config({'pairingKey': 'pair-SECRET'})
        captured, result = self.request(server.LabelReprint(), method='OPTIONS')
        self.assertEqual(captured['status'], '200 OK')
        self.assertIsNone(result)
        self.assertIn('X-Sync-Pairing-Key', captured['headers']['Access-Control-Allow-Headers'])

    def test_key_comparison_uses_constant_time_primitive(self):
        self.write_config({'pairingKey': 'pair-SECRET'})
        request = SimpleNamespace(headers={server.SYNC_PAIRING_HEADER: 'pair-SECRET'})
        with patch.object(server.cherrypy, 'request', request), \
                patch.object(server.hmac, 'compare_digest', wraps=server.hmac.compare_digest) as compare:
            self.assertIsNone(server.require_sync_pairing())
        compare.assert_called_once_with(b'pair-SECRET', b'pair-SECRET')

    def test_settings_edit_is_seen_without_helper_restart(self):
        self.write_config({'pairingKey': 'first-key'})
        captured, _result = self.request(server.LabelReprint(), key='second-key')
        self.assertEqual(captured['status'], '401 Unauthorized')
        self.write_config({'pairingKey': 'second-key'})
        with patch.object(server, 'submit_native_label_reprint', return_value={'success': True}):
            captured, result = self.request(server.LabelReprint(), key='second-key', payload=b'{}')
        self.assertTrue(result['success'])

    def test_pairing_menu_opens_window_without_creating_file_or_opening_an_editor(self):
        tray = object.__new__(server.TrayIcon)
        tray.pairing_window = unittest.mock.Mock()
        with patch.object(server.os, 'startfile', create=True) as open_file:
            tray.open_pairing_settings()
            tray.pairing_window.show.assert_called_once_with()
            open_file.assert_not_called()
        self.assertEqual(os.listdir(self.directory), [])

    def test_window_save_enables_changes_and_disables_authentication_without_restart(self):
        save_pairing_settings(server.SYNC_CONFIG_FILE, True, 'first-key')
        captured, _ = self.request(server.LabelReprint(), key='second-key')
        self.assertEqual(captured['status'], '401 Unauthorized')
        save_pairing_settings(server.SYNC_CONFIG_FILE, True, 'second-key')
        with patch.object(server, 'submit_native_label_reprint', return_value={'success': True}):
            captured, result = self.request(server.LabelReprint(), key='second-key', payload=b'{}')
        self.assertTrue(result['success'])
        save_pairing_settings(server.SYNC_CONFIG_FILE, False, '')
        for key in (None, '', 'first-key', 'second-key'):
            with self.subTest(key=key), patch.object(server, 'get_lan_ipv4_addresses', return_value=[]):
                captured, result = self.request(server.Health(), method='GET', key=key)
            self.assertFalse(result['pairingRequired'])
            self.assertTrue(result['pairingAuthenticated'])
            with patch.object(server, 'read_excel_request_body', side_effect=ValueError('parser reached')), patch.object(server, 'log'):
                captured, result = self.request(server.Inbound(), key=key)
            self.assertEqual(result['message'], 'parser reached')

    def test_saved_setting_refreshes_tray_without_secret_in_notice(self):
        tray = object.__new__(server.TrayIcon)
        tray.icon = unittest.mock.Mock()
        tray.notify = unittest.mock.Mock()
        tray.on_pairing_saved(True)
        tray.icon.update_menu.assert_called_once_with()
        self.assertIn('已开启', tray.notify.call_args.args[1])
        tray.on_pairing_saved(False)
        self.assertIn('已关闭', tray.notify.call_args.args[1])

    def test_quit_closes_settings_window_and_service(self):
        tray = object.__new__(server.TrayIcon)
        tray.icon = unittest.mock.Mock()
        tray.address_monitor = unittest.mock.Mock()
        tray.pairing_window = unittest.mock.Mock()
        with patch.object(server.cherrypy.engine, 'exit') as exit_service:
            tray.quit_app()
        self.assertFalse(tray.running)
        tray.pairing_window.close.assert_called_once_with()
        exit_service.assert_called_once_with()

    def test_authenticated_reprint_never_creates_a_persistent_print_ledger(self):
        self.write_config({'pairingKey': 'pair-SECRET'})
        with patch.object(server, 'EPHEMERAL_REPRINT_JOBS', {}), \
                patch.object(server, 'load_native_print_job', side_effect=AssertionError('ledger read')), \
                patch.object(server, 'save_native_print_history', side_effect=AssertionError('ledger write')), \
                patch.object(server, 'build_native_label', return_value=b'PRINT 1,2'), \
                patch.object(server, 'send_raw_tspl_to_printer', return_value=42), \
                patch.object(server, 'log', side_effect=AssertionError('label logging')):
            captured, result = self.request(server.LabelReprint(), key='pair-SECRET', payload=json.dumps(make_payload()).encode())
        self.assertTrue(result['success'])
        self.assertEqual(os.listdir(self.directory), ['settings.json'])


if __name__ == '__main__':
    unittest.main()
