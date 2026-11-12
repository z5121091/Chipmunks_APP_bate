"""Publishing workflow tests use only local fixtures and mocked HTTP calls."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock
import urllib.error
import uuid
import zipfile


spec = importlib.util.spec_from_file_location('ota_publish_workflow', Path(__file__).with_name('publish-ota.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def response(value=None, status=200):
    result = io.BytesIO(json.dumps(value).encode('utf-8') if value is not None else b'')
    result.status = status
    return result


class OtaPublishingWorkflowTest(unittest.TestCase):
    def test_publication_lease_refuses_concurrent_task_and_releases(self):
        with publisher.publication_lock():
            with self.assertRaises(publisher.PublicationError):
                with publisher.publication_lock():
                    self.fail('concurrent publication lease was accepted')
        with publisher.publication_lock():
            self.assertTrue((self.root / 'logs/ota-publish/publish.lock').exists())

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runtime = 'android-' + 'a' * 32
        self.version = '1.0.0'
        (self.root / 'client').mkdir()
        (self.root / 'client/version.json').write_text(json.dumps({'version': self.version}))
        (self.root / 'dist/apk').mkdir(parents=True)
        (self.root / 'dist/apk/ota-baseline.json').write_text(json.dumps({
            'runtimeVersion': self.runtime, 'version': self.version,
        }))
        self.export = self.root / 'dist/ota/2026-11-11_10-00'
        self.export.mkdir(parents=True)
        (self.export / 'bundle.hbc').write_bytes(b'compiled bundle')
        (self.export / 'picture').write_bytes(b'image')
        (self.export / 'metadata.json').write_text(json.dumps({'fileMetadata': {'android': {
            'bundle': 'bundle.hbc', 'assets': [{'path': 'picture', 'ext': 'png'}],
        }}}))
        self.data, self.manifest = publisher.package_export(
            self.export, self.runtime, 'Test fix', {'version': self.version})
        self.package = self.export / 'update.zip'
        self.package.write_bytes(self.data)
        self.notes = self.root / 'notes.txt'
        self.notes.write_text('Test update', encoding='utf-8')
        self.root_patch = mock.patch.object(publisher, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def invoke_main(self, args, **patches):
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch('sys.argv', ['publish-ota.py', *args]))
            stack.enter_context(mock.patch.dict(os.environ, {'WAREHOUSE_OTA_TOKEN': 'fake-test-token'}))
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(mock.patch.object(publisher.subprocess, 'check_output', return_value=self.runtime))
            for name, value in patches.items():
                stack.enter_context(mock.patch.object(publisher, name, value))
            publisher.main()
            return output.getvalue()

    def altered_archive(self, alter_manifest=None, alter_entry=None, extra=None):
        result = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(self.data)) as source, zipfile.ZipFile(result, 'w') as target:
            for name in source.namelist():
                raw = source.read(name)
                if name == 'manifest.json' and alter_manifest:
                    manifest = json.loads(raw)
                    alter_manifest(manifest)
                    raw = json.dumps(manifest).encode('utf-8')
                elif alter_entry:
                    raw = alter_entry(name, raw)
                target.writestr(name, raw)
            if extra:
                target.writestr(*extra)
        return result.getvalue()

    def test_preflight_is_authenticated_and_read_only(self):
        with mock.patch.object(publisher, 'open_request', return_value=response({
            'ok': True, 'canPublish': True, 'service': 'warehouse-ota',
        })) as opener:
            publisher.check_publish_connection('fake-test-token')
        request, timeout = opener.call_args.args
        self.assertEqual(request.full_url, publisher.BASE + '/publish/check')
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(request.get_header('Authorization'), 'Bearer fake-test-token')
        self.assertEqual(timeout, 15)

    def test_preflight_rejects_missing_credentials_without_http(self):
        with mock.patch.object(publisher, 'open_request') as opener:
            with self.assertRaises(publisher.PublicationError):
                publisher.check_publish_connection(' ')
        opener.assert_not_called()

    def test_preflight_rejects_wrong_credentials_and_invalid_service(self):
        failures = [
            urllib.error.HTTPError('test', 401, 'Unauthorized', {}, None),
            response({'ok': True, 'canPublish': True, 'service': 'different'}),
            response([]),
        ]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                settings = {'side_effect': failure} if isinstance(failure, Exception) else {'return_value': failure}
                with mock.patch.object(publisher, 'open_request', **settings):
                    with self.assertRaises(publisher.PublicationError):
                        publisher.check_publish_connection('fake-test-token')

    def test_failed_preflight_stops_before_export_or_directory_creation(self):
        with mock.patch.object(publisher.subprocess, 'run') as exporter, \
                mock.patch.object(publisher, 'create_export_folder') as create:
            with self.assertRaises(publisher.PublicationError):
                self.invoke_main(['--notes-file', str(self.notes)], check_publish_connection=mock.Mock(
                    side_effect=publisher.PublicationError('offline')))
        exporter.assert_not_called()
        create.assert_not_called()

    def test_notes_file_flow_exports_after_preflight_and_records_saved_artifact(self):
        nas = self.root / 'private-nas.json'
        nas.write_text(json.dumps({'defaultServer': 'https://private-nas.invalid'}))
        (self.root / 'android-build.local').write_text(json.dumps({'updateServerFile': str(nas)}))
        events = []

        def command_output(command, **kwargs):
            if 'ota-runtime.cjs' in command[1]:
                return self.runtime
            if command[1] == '-p':
                return 'fake-expo-cli'
            return json.dumps({'version': self.version})

        def export_command(command, **kwargs):
            events.append('export')
            folder = Path(command[command.index('--output-dir') + 1])
            for name in ['metadata.json', 'bundle.hbc', 'picture']:
                shutil.copyfile(self.export / name, folder / name)

        upload = mock.Mock(side_effect=lambda *args: events.append('upload'))
        with mock.patch.object(publisher.subprocess, 'check_output', side_effect=command_output), \
                mock.patch.object(publisher.subprocess, 'run', side_effect=export_command), \
                mock.patch.object(publisher, 'ROOT', self.root), \
                mock.patch.object(publisher, 'check_publish_connection', side_effect=lambda token: events.append('preflight')), \
                mock.patch.object(publisher, 'upload_package', upload), \
                mock.patch('sys.argv', ['publish-ota.py', '--notes-file', str(self.notes)]), \
                mock.patch.dict(os.environ, {'WAREHOUSE_OTA_TOKEN': 'fake-test-token'}), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            publisher.main()
        self.assertEqual(events, ['preflight', 'export', 'upload'])
        raw, manifest, token = upload.call_args.args
        self.assertEqual(publisher.validate_saved_package(raw), manifest)
        self.assertEqual(manifest['extra']['warehouseUpdate']['notes'], 'Test update')
        marker = next(line for line in output.getvalue().splitlines() if line.startswith('OTA-ARTIFACT: '))
        artifact = Path(marker.removeprefix('OTA-ARTIFACT: '))
        self.assertTrue(artifact.is_relative_to(self.root / 'dist/ota'))
        self.assertEqual(artifact.read_bytes(), raw)
        self.assertIn('PUBLISHED: ' + manifest['id'], output.getvalue())

    def test_saved_retry_preserves_archive_and_id_without_export(self):
        upload = mock.Mock()
        with mock.patch.object(publisher.subprocess, 'run') as exporter:
            output = self.invoke_main(['--package-file', str(self.package)],
                                      check_publish_connection=mock.Mock(), upload_package=upload)
        exporter.assert_not_called()
        upload.assert_called_once_with(self.data, self.manifest, 'fake-test-token', retry=True)
        self.assertEqual(self.package.read_bytes(), self.data)
        for marker in ['OTA-ARTIFACT: ' + str(self.package.resolve()), 'OTA-ID: ' + self.manifest['id'],
                       'OTA-SIZE: ' + str(len(self.data)), 'OTA-RUNTIME: ' + self.runtime,
                       'PUBLISHED: ' + self.manifest['id']]:
            self.assertIn(marker, output)

    def test_saved_retry_rejects_external_path_and_changed_native_runtime_or_version(self):
        external = self.root / 'update.zip'
        external.write_bytes(self.data)
        variants = [(external, self.data), (self.package, self.altered_archive(
            lambda value: value.update(runtimeVersion='android-' + 'b' * 32))),
            (self.package, self.altered_archive(
                lambda value: value['extra']['expoClient'].update(version='2.0.0')))]
        for path, raw in variants:
            path.write_bytes(raw)
            upload = mock.Mock()
            with self.subTest(path=str(path), raw=len(raw)), self.assertRaises(publisher.PublicationError):
                self.invoke_main(['--package-file', str(path)],
                                 check_publish_connection=mock.Mock(), upload_package=upload)
            upload.assert_not_called()

    def test_current_native_baseline_mismatch_stops_before_network(self):
        (self.root / 'dist/apk/ota-baseline.json').write_text(json.dumps({
            'runtimeVersion': 'android-' + 'b' * 32, 'version': self.version,
        }))
        preflight = mock.Mock()
        with self.assertRaisesRegex(ValueError, 'APK'):
            self.invoke_main(['--package-file', str(self.package)], check_publish_connection=preflight)
        preflight.assert_not_called()

    def test_valid_saved_archive_passes_and_corrupt_or_traversal_archive_fails(self):
        self.assertEqual(publisher.validate_saved_package(self.data), self.manifest)
        bad_packages = [b'bad zip', self.altered_archive(extra=('../escape', 'bad')),
                        self.altered_archive(extra=('assets/' + 'f' * 64, 'unreferenced')),
                        self.altered_archive(alter_entry=lambda name, raw: b'corrupt'),
                        self.altered_archive(lambda value: value['launchAsset'].update(url='https://elsewhere/asset')),
                        self.altered_archive(lambda value: value.update(id='not-a-uuid'))]
        for raw in bad_packages:
            with self.subTest(raw=len(raw)), self.assertRaises(publisher.PublicationError):
                publisher.validate_saved_package(raw)

    def test_manifest_lookup_uses_runtime_headers(self):
        with mock.patch.object(publisher, 'open_request', return_value=response(self.manifest)) as opener:
            self.assertEqual(publisher.read_active_manifest(self.runtime), self.manifest)
        request, timeout = opener.call_args.args
        self.assertEqual(request.full_url, publisher.BASE + '/manifest')
        self.assertEqual(request.get_header('Expo-runtime-version'), self.runtime)
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(timeout, 15)

    def test_retry_already_active_confirms_without_post(self):
        with mock.patch.object(publisher, 'read_active_manifest', return_value=self.manifest), \
                mock.patch.object(publisher, 'open_request') as opener:
            publisher.upload_package(self.data, self.manifest, 'fake-test-token', retry=True)
        opener.assert_not_called()

    def test_retry_does_not_overwrite_a_newer_release(self):
        newer = copy.deepcopy(self.manifest)
        newer.update(id=str(uuid.uuid4()), createdAt='2099-01-01T00:00:00+00:00')
        with mock.patch.object(publisher, 'read_active_manifest', return_value=newer), \
                mock.patch.object(publisher, 'open_request') as opener:
            with self.assertRaisesRegex(publisher.PublicationError, '更晚'):
                publisher.upload_package(self.data, self.manifest, 'fake-test-token', retry=True)
        opener.assert_not_called()

    def test_retry_status_unavailable_or_conflicting_same_id_stops_without_post(self):
        conflicting = copy.deepcopy(self.manifest)
        conflicting['metadata']['different'] = True
        for value in [OSError('offline'), conflicting]:
            settings = {'side_effect': value} if isinstance(value, Exception) else {'return_value': value}
            with self.subTest(value=type(value).__name__), \
                    mock.patch.object(publisher, 'read_active_manifest', **settings), \
                    mock.patch.object(publisher, 'open_request') as opener:
                with self.assertRaises(publisher.PublicationError):
                    publisher.upload_package(self.data, self.manifest, 'fake-test-token', retry=True)
                opener.assert_not_called()

    def test_retry_posts_exact_bytes_once_when_no_active_release(self):
        with mock.patch.object(publisher, 'read_active_manifest', return_value=None), \
                mock.patch.object(publisher, 'open_request', return_value=response({
                    'ok': True, 'id': self.manifest['id'],
                })) as opener:
            publisher.upload_package(self.data, self.manifest, 'fake-test-token', retry=True)
        opener.assert_called_once()
        request, timeout = opener.call_args.args
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(request.data, self.data)
        self.assertEqual(timeout, 240)

    def test_lost_upload_response_reconciles_active_id_without_reposting(self):
        with mock.patch.object(publisher, 'open_request', side_effect=TimeoutError('lost response')) as opener, \
                mock.patch.object(publisher, 'read_active_manifest', return_value=self.manifest):
            publisher.upload_package(self.data, self.manifest, 'fake-test-token')
        opener.assert_called_once()

    def test_unknown_upload_result_is_explicit_and_never_automatically_reposted(self):
        with mock.patch.object(publisher, 'open_request', side_effect=OSError('lost response')) as opener, \
                mock.patch.object(publisher, 'read_active_manifest', return_value=None), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaisesRegex(publisher.PublicationError, '未能确认'):
                publisher.upload_package(self.data, self.manifest, 'fake-test-token')
        opener.assert_called_once()
        self.assertIn('OTA-PUBLISH-STATE: unknown', output.getvalue())


if __name__ == '__main__':
    unittest.main()
