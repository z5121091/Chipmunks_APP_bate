"""Keep every runtime's active release; prune only old unreferenced history."""
import argparse
import datetime
import json
from pathlib import Path
import re
import shutil
import time
import uuid
from ota_storage import storage_lock

DAY = 86400


def cleanup(root, now=None, dry_run=False):
    root = Path(root).resolve()
    now = time.time() if now is None else now
    report = {'removedReleases': 0, 'removedAssets': 0, 'freedBytes': 0, 'activeRuntimes': 0, 'dryRun': dry_run}
    with storage_lock(root):
        pinned = set()
        active_manifests = []
        for path in (root / 'active').glob('*.json'):
            manifest = json.loads(path.read_bytes())
            pinned.add(manifest['id'])
            active_manifests.append(manifest)
        report['activeRuntimes'] = len(pinned)
        by_runtime = {}
        for path in (root / 'releases').iterdir():
            if not path.is_dir() or path.is_symlink():
                continue
            try:
                uuid.UUID(path.name)
            except ValueError:
                continue
            manifest_file = path / 'manifest.json'
            if not manifest_file.exists():
                # An interrupted staging directory is kept; orphan assets can be reclaimed separately.
                continue
            manifest = json.loads(manifest_file.read_bytes())
            stamp = datetime.datetime.fromisoformat(manifest['createdAt'].replace('Z', '+00:00')).timestamp()
            by_runtime.setdefault(manifest['runtimeVersion'], []).append((stamp, path, manifest))
        retained = list(active_manifests)
        obsolete = []
        for releases in by_runtime.values():
            for rank, (stamp, path, manifest) in enumerate(sorted(releases, key=lambda item: item[0], reverse=True)):
                if manifest['id'] in pinned or rank < 5 or now - stamp < 30 * DAY:
                    retained.append(manifest)
                else:
                    obsolete.append(path)
        referenced = set()
        # Validate all retained references before deleting anything. Corrupt metadata aborts cleanup.
        for manifest in retained:
            for asset in [manifest['launchAsset'], *manifest['assets']]:
                # Metro cache keys may be MD5; actual server filenames remain SHA256.
                key = asset.get('url', '').rsplit('/assets/', 1)[-1] if asset.get('url') else asset['key']
                if not re.fullmatch(r'[a-f0-9]{64}', key):
                    raise ValueError('Invalid retained asset reference; cleanup stopped')
                referenced.add(key)
        for path in obsolete:
            if path.parent != root / 'releases' or path.is_symlink():
                raise ValueError('Unsafe release directory')
            report['removedReleases'] += 1
            if not dry_run:
                shutil.rmtree(path)
        for path in (root / 'assets').iterdir():
            if path.is_symlink() or not path.is_file() or not re.fullmatch(r'[a-f0-9]{64}(?:\.gz)?(?:\.tmp)?', path.name):
                continue
            if path.name[:64] in referenced or now - path.stat().st_mtime < 7 * DAY:
                continue
            report['freedBytes'] += path.stat().st_size
            report['removedAssets'] += 1
            if not dry_run:
                path.unlink()
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='/var/lib/warehouse-ota')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    print(json.dumps(cleanup(args.root, dry_run=args.dry_run)))
