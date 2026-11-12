"""Exercise warehouse folder creation and workbook uploads through CherryPy."""

import io
import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode
from wsgiref.util import setup_testing_defaults

from openpyxl import Workbook, load_workbook

from scripts import label_sync_server as server
from scripts.sync_export_folders import DOCUMENT_FOLDERS, ensure_warehouse_folders


class WarehouseArchiveTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(server, 'DATA_ROOT', str(self.root)))
        stack.enter_context(patch.object(server, 'read_sync_pairing_key', return_value='test-key'))
        stack.enter_context(patch.object(server, 'log'))
        stack.enter_context(patch.object(server, 'get_lan_ipv4_addresses', return_value=[]))
        self.notifications = stack.enter_context(patch.object(server, 'publish_business_notification'))

    def request(self, endpoint, *, method='POST', params=None, body=b'', content_type='application/json', key='test-key'):
        path = {
            server.Health: '/health', server.Warehouses: '/warehouses', server.Inbound: '/inbound',
            server.Outbound: '/outbound', server.Inventory: '/inventory',
        }[type(endpoint)]
        config = {
            'request.dispatch': server.cherrypy.dispatch.MethodDispatcher(),
            'tools.cors.on': True,
        }
        if isinstance(endpoint, server.Warehouses):
            config['request.process_request_body'] = False
        tree = type(server.cherrypy.tree)()
        app = tree.mount(endpoint, path, {'/': config})
        environ = {}
        setup_testing_defaults(environ)
        environ.update({
            'REQUEST_METHOD': method,
            'PATH_INFO': path,
            'QUERY_STRING': urlencode(params or {}),
            'CONTENT_TYPE': content_type,
            'CONTENT_LENGTH': str(len(body)),
            'HTTP_X_SYNC_PAIRING_KEY': key,
            'wsgi.input': io.BytesIO(body),
        })
        response = {}

        def start_response(status, headers, _exc_info=None):
            response['status'] = int(status.split(' ', 1)[0])

        with patch.object(app.log, 'access'):
            data = b''.join(tree(environ, start_response))
        return response['status'], json.loads(data) if data else None

    def sync_roster(self, *items, key='test-key'):
        body = json.dumps({'warehouses': list(items)}, ensure_ascii=False).encode('utf-8')
        return self.request(server.Warehouses(), body=body, key=key)

    def upload(self, endpoint, *, quantity=4, **params):
        workbook = Workbook()
        workbook.active.append(['数量'])
        workbook.active.append([quantity])
        stream = io.BytesIO()
        workbook.save(stream)
        status, result = self.request(
            endpoint, params=params, body=stream.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        self.assertEqual(status, 200)
        self.assertTrue(result['success'], result)
        return result

    def test_capability_and_pairing(self):
        status, health = self.request(server.Health(), method='GET')
        self.assertEqual(status, 200)
        self.assertEqual(health['warehouseArchiveApiVersion'], 1)
        status, result = self.sync_roster({'id': 'w1', 'name': '主仓'}, key='wrong-key')
        self.assertEqual(status, 401)
        self.assertEqual(result['code'], 'SYNC_PAIRING_REQUIRED')
        self.assertEqual(list(self.root.iterdir()), [])

    def test_roster_precreates_missing_folders_and_keeps_removed_or_renamed_ones(self):
        status, result = self.sync_roster({'id': 'w1', 'name': '主仓'}, {'id': 'w2', 'name': '备仓'})
        self.assertEqual((status, result), (200, {'success': True, 'count': 2}))
        old_file = self.root / '主仓' / DOCUMENT_FOLDERS['outbound'] / '历史文件.xlsx'
        old_file.write_bytes(b'history')
        status, result = self.sync_roster({'id': 'w1', 'name': '新主仓'})
        self.assertEqual((status, result), (200, {'success': True, 'count': 1}))
        for name in ('主仓', '备仓', '新主仓'):
            for folder in DOCUMENT_FOLDERS.values():
                self.assertTrue((self.root / name / folder).is_dir())
        self.assertEqual(old_file.read_bytes(), b'history')

    def test_uploads_archive_all_types_and_share_the_name_across_pda_and_erp_ids(self):
        for endpoint, category, warehouse_id in (
            (server.Outbound(), 'outbound', 'w1'),
            (server.Inbound(), 'inbound', 'w1'),
            (server.Inventory(), 'inventory', 'erp-account:one'),
        ):
            with self.subTest(category=category):
                args = dict(
                    warehouse_id=warehouse_id, warehouse_name='主仓', erp_account_key='one',
                    file_name='原有文件名_2026-11-09.xlsx',
                )
                result = self.upload(endpoint, **args)
                self.assertEqual(result['fileName'], args['file_name'])
                expected = self.root / '主仓' / DOCUMENT_FOLDERS[category] / args['file_name']
                self.assertEqual(Path(result['path']), expected)
                self.assertTrue(expected.is_file())
                # Re-sync the same document into its original path and filename.
                result = self.upload(endpoint, quantity=7, **args)
                self.assertEqual(Path(result['path']), expected)
                workbook = load_workbook(expected)
                try:
                    self.assertEqual(workbook.active['A2'].value, 7)
                    self.assertTrue(workbook.active['A1'].font.bold)
                finally:
                    workbook.close()
                self.assertEqual(list(expected.parent.iterdir()), [expected])
                self.notifications.assert_called_with(category, 'success', count=1, file_name=args['file_name'])
        self.assertEqual([path.name for path in self.root.iterdir() if path.is_dir()], ['主仓'])

    def test_legacy_uploads_and_unpack_label_export_use_original_root(self):
        for endpoint in (server.Inbound(), server.Outbound(), server.Inventory()):
            result = self.upload(endpoint, file_name='旧版文件.xlsx')
            self.assertEqual(Path(result['path']), self.root / '旧版文件.xlsx')
        result = self.upload(server.Inventory(), name_suffix='拆包标签', warehouse_name='主仓')
        self.assertEqual(Path(result['path']), self.root / '拆包标签.xlsx')
        self.assertFalse((self.root / '主仓').exists())
        self.notifications.assert_called_with('order_labels', 'success', count=1, file_name='拆包标签.xlsx')

    def test_same_workbook_name_in_different_warehouses_keeps_both_files(self):
        first = self.upload(server.Outbound(), file_name='同名.xlsx', warehouse_name='主仓')
        first_path = Path(first['path'])
        first_content = first_path.read_bytes()
        second = self.upload(server.Outbound(), file_name='同名.xlsx', warehouse_name='备仓', quantity=7)
        self.assertEqual(Path(second['path']), self.root / '备仓' / DOCUMENT_FOLDERS['outbound'] / '同名.xlsx')
        self.assertEqual(first_path.read_bytes(), first_content)

    def test_folder_names_are_safe_distinct_and_stable_across_retries(self):
        names = ['A', 'a', 'A/B', 'A_B', 'A\\B', 'NUL.txt', '仓库.', '..\\外部']
        folders = ensure_warehouse_folders(self.root, names)
        self.assertEqual(folders['A'], self.root / 'A')
        self.assertEqual(folders['A_B'], self.root / 'A_B')
        self.assertEqual(len({path.name.casefold() for path in folders.values()}), len(names))
        self.assertEqual(ensure_warehouse_folders(self.root, reversed(names)), folders)
        for folder in folders.values():
            self.assertEqual(folder.parent, self.root)
            self.assertEqual(folder.resolve(), folder)
            self.assertTrue(folder.is_dir())
            self.assertNotIn('/', folder.name)
            self.assertNotIn('\\', folder.name)
            self.assertFalse(folder.name.endswith('.'))
        self.assertNotEqual(folders['NUL.txt'].name, 'NUL.txt')

    def test_invalid_roster_has_no_partial_side_effect(self):
        status, result = self.sync_roster({'id': 'w1', 'name': '主仓'}, {'id': 'w2'})
        self.assertEqual(status, 400)
        self.assertFalse(result['success'])
        self.assertEqual(list(self.root.iterdir()), [])

    def test_concurrent_requests_share_the_same_archive_folders(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            folders = list(pool.map(lambda _: ensure_warehouse_folders(self.root, ['主仓', 'A/B']), range(8)))
        self.assertTrue(all(value == folders[0] for value in folders))
        self.assertEqual(len([path for path in self.root.iterdir() if path.is_dir()]), 2)

    def test_existing_unregistered_path_is_left_in_place(self):
        old_folder = self.root / '主仓'
        old_folder.mkdir()
        old_file = old_folder / '其他文件.txt'
        old_file.write_text('existing', encoding='utf-8')
        folder = ensure_warehouse_folders(self.root, ['主仓'])['主仓']
        self.assertNotEqual(old_folder, folder)
        self.assertEqual(old_file.read_text(encoding='utf-8'), 'existing')
        self.assertEqual(ensure_warehouse_folders(self.root, ['主仓'])['主仓'], folder)

    def test_archive_rejects_a_managed_subfolder_replaced_by_an_external_link(self):
        folder = ensure_warehouse_folders(self.root, ['主仓'])['主仓']
        category = folder / DOCUMENT_FOLDERS['outbound']
        category.rmdir()
        with tempfile.TemporaryDirectory() as outside:
            if os.name == 'nt':
                from _winapi import CreateJunction

                CreateJunction(outside, str(category))
                remove_link = category.rmdir
            else:
                category.symlink_to(outside, target_is_directory=True)
                remove_link = category.unlink
            try:
                with self.assertRaises(OSError):
                    ensure_warehouse_folders(self.root, ['主仓'])
                self.assertEqual(list(Path(outside).iterdir()), [])
            finally:
                remove_link()


if __name__ == '__main__':
    unittest.main()
