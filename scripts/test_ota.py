import importlib.util
import io
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


server = load('ota_server', 'ota-server.py')
publisher = load('ota_publisher', 'publish-ota.py')


class OtaTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        server.ROOT = self.root / 'server'
        server.TOKEN = 'test-token'
        for name in ['assets', 'active', 'releases']:
            (server.ROOT / name).mkdir(parents=True)
        export = self.root / 'export'
        export.mkdir()
        (export / 'bundle.hbc').write_bytes(b'compiled bundle')
        (export / 'picture').write_bytes(b'image')
        (export / 'metadata.json').write_text(json.dumps({'fileMetadata': {'android': {'bundle': 'bundle.hbc', 'assets': [{'path': 'picture', 'ext': 'png'}]}}}))
        self.runtime = 'android-' + 'a' * 32
        self.package, self.manifest = publisher.package_export(export, self.runtime, 'Test fix')
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.http.server_port)

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, data=None, auth=True, runtime=None):
        headers = {'expo-platform': 'android', 'expo-runtime-version': runtime or self.runtime, 'expo-protocol-version': '1'}
        if auth:
            headers['Authorization'] = 'Bearer test-token'
        return urllib.request.urlopen(urllib.request.Request(self.url + path, data=data, headers=headers))

    def test_publish_roundtrip_and_runtime_isolation(self):
        self.assertEqual(self.request('/manifest').status, 204)
        result = json.load(self.request('/publish', self.package))
        self.assertEqual(result['id'], self.manifest['id'])
        active = json.load(self.request('/manifest'))
        self.assertEqual(active['id'], self.manifest['id'])
        for asset in [active['launchAsset'], *active['assets']]:
            self.assertTrue((server.ROOT / 'assets' / asset['key']).exists())
        self.assertEqual(self.request('/manifest', runtime='android-' + 'b' * 32).status, 204)

    def test_authenticated_connection_check_does_not_publish(self):
        result = json.load(self.request('/publish/check'))
        self.assertTrue(result['canPublish'])
        self.assertEqual(result['service'], 'warehouse-ota')
        self.assertEqual(list((server.ROOT / 'releases').iterdir()), [])
        self.assertEqual(self.request('/manifest').status, 204)

    def test_connection_check_rejects_missing_credentials(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/publish/check', auth=False)
        self.assertEqual(error.exception.code, 401)

    def test_running_update_returns_no_update(self):
        self.request('/publish', self.package).close()
        headers = {'expo-platform': 'android', 'expo-runtime-version': self.runtime, 'expo-protocol-version': '1', 'Expo-Current-Update-ID': self.manifest['id']}
        with urllib.request.urlopen(urllib.request.Request(self.url + '/manifest', headers=headers)) as response:
            self.assertEqual(response.status, 204)

    def test_metro_identity_reused_while_storage_hash_is_independent(self):
        export = self.root / 'reuse'
        export.mkdir()
        raw = b'unchanged image bytes'
        metro_hash = hashlib.md5(raw).hexdigest()
        (export / metro_hash).write_bytes(raw)
        (export / 'bundle').write_bytes(b'new code')
        (export / 'metadata.json').write_text(json.dumps({'fileMetadata': {'android': {'bundle': 'bundle', 'assets': [{'path': metro_hash, 'ext': 'png'}]}}}))
        package, manifest = publisher.package_export(export, self.runtime, 'reuse')
        self.assertEqual(manifest['assets'][0]['key'], metro_hash)
        key = hashlib.sha256(raw).hexdigest()
        self.assertTrue(manifest['assets'][0]['url'].endswith('/' + key))
        server.validate_package(package)
        self.request('/publish', package).close()
        self.assertEqual((server.ROOT / 'assets' / key).read_bytes(), raw)

    def test_gzip_wire_bytes_decode_to_original_asset(self):
        raw = b'compiled JavaScript bundle' * 4000
        digest = hashlib.sha256(raw).hexdigest()
        (server.ROOT / 'assets' / digest).write_bytes(raw)
        request = urllib.request.Request(self.url + '/assets/' + digest, headers={'Accept-Encoding': 'gzip'})
        with urllib.request.urlopen(request) as response:
            wire = response.read()
            self.assertEqual(response.headers['Content-Encoding'], 'gzip')
            self.assertEqual(int(response.headers['Content-Length']), len(wire))
            self.assertEqual(gzip.decompress(wire), raw)
            self.assertLess(len(wire), len(raw) / 2)
        request = urllib.request.Request(self.url + '/assets/' + digest, headers={'Accept-Encoding': 'gzip;q=0'})
        with urllib.request.urlopen(request) as response:
            self.assertIsNone(response.headers['Content-Encoding'])
            self.assertEqual(response.read(), raw)

    def test_unauthorized_upload_does_not_publish(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/publish', self.package, auth=False)
        self.assertEqual(error.exception.code, 401)
        self.assertEqual(self.request('/manifest').status, 204)

    def test_bad_package_preserves_previous_release(self):
        self.request('/publish', self.package).close()
        with self.assertRaises(urllib.error.HTTPError):
            self.request('/publish', b'incomplete')
        self.assertEqual(json.load(self.request('/manifest'))['id'], self.manifest['id'])

    def test_zip_traversal_rejected(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            archive.writestr('../escape', 'bad')
        with self.assertRaises(ValueError):
            server.validate_package(data.getvalue())

    def test_corrupt_asset_rejected(self):
        source = zipfile.ZipFile(io.BytesIO(self.package))
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for name in source.namelist():
                archive.writestr(name, source.read(name) if name == 'manifest.json' else b'corrupt')
        with self.assertRaises(ValueError):
            server.validate_package(data.getvalue())


if __name__ == '__main__':
    unittest.main()
