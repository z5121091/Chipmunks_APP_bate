import datetime
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
import uuid
from ota_cleanup import cleanup, DAY


class RetentionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.now = time.time()
        for name in ['active', 'assets', 'releases']:
            (self.root / name).mkdir()

    def tearDown(self): self.temp.cleanup()

    def release(self, age, runtime='old-apk', pin=False):
        ident = str(uuid.uuid4())
        key = hashlib.sha256(ident.encode()).hexdigest()
        asset = self.root / 'assets' / key
        asset.write_bytes(b'test')
        os.utime(asset, (self.now - age * DAY, self.now - age * DAY))
        manifest = {'id': ident, 'runtimeVersion': runtime, 'createdAt': datetime.datetime.fromtimestamp(self.now - age * DAY, datetime.timezone.utc).isoformat(), 'launchAsset': {'key': key}, 'assets': []}
        directory = self.root / 'releases' / ident
        directory.mkdir()
        (directory / 'manifest.json').write_text(json.dumps(manifest))
        if pin: (self.root / 'active' / (runtime + '.json')).write_text(json.dumps(manifest))
        return directory, asset

    def test_old_apk_active_update_is_kept_forever(self):
        directory, asset = self.release(900, pin=True)
        for day in range(40, 47): self.release(day)
        cleanup(self.root, self.now)
        self.assertTrue(directory.exists()); self.assertTrue(asset.exists())

    def test_latest_five_per_runtime_survive(self):
        kept = [self.release(day) for day in range(40, 45)]
        removed = self.release(60)
        cleanup(self.root, self.now)
        self.assertTrue(all(path.exists() and asset.exists() for path, asset in kept))
        self.assertFalse(removed[0].exists()); self.assertFalse(removed[1].exists())

    def test_recent_history_survives_even_when_more_than_five(self):
        releases = [self.release(day) for day in range(10)]
        cleanup(self.root, self.now)
        self.assertTrue(all(path.exists() for path, _ in releases))

    def test_other_runtime_active_release_survives(self):
        old = self.release(900, 'older-apk', True)
        for day in range(50): self.release(day, 'new-apk', day == 0)
        cleanup(self.root, self.now)
        self.assertTrue(old[0].exists()); self.assertTrue(old[1].exists())

    def test_orphan_assets_have_seven_day_grace(self):
        fresh = self.root / 'assets' / ('a' * 64); fresh.write_bytes(b'new')
        old = self.root / 'assets' / ('b' * 64); old.write_bytes(b'old')
        os.utime(old, (self.now - 8 * DAY, self.now - 8 * DAY))
        cleanup(self.root, self.now)
        self.assertTrue(fresh.exists()); self.assertFalse(old.exists())

    def test_dry_run_does_not_remove_files(self):
        releases = [self.release(day) for day in range(40, 47)]
        report = cleanup(self.root, self.now, dry_run=True)
        self.assertEqual(report['removedReleases'], 2)
        self.assertTrue(all(path.exists() for path, _ in releases))

    def test_metro_key_retains_sha_storage_and_compressed_variant(self):
        path, asset = self.release(90, pin=True)
        manifest_file = path / 'manifest.json'
        manifest = json.loads(manifest_file.read_bytes())
        manifest['launchAsset']['url'] = 'https://erp.chipmunks.fun/app-updates/assets/' + asset.name
        manifest['launchAsset']['key'] = 'a' * 32
        manifest_file.write_text(json.dumps(manifest))
        (self.root / 'active/old-apk.json').write_text(json.dumps(manifest))
        zipped = asset.with_suffix('.gz'); zipped.write_bytes(b'compressed')
        os.utime(zipped, (self.now - 90 * DAY, self.now - 90 * DAY))
        cleanup(self.root, self.now)
        self.assertTrue(asset.exists()); self.assertTrue(zipped.exists())


if __name__ == '__main__': unittest.main()
