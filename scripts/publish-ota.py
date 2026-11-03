"""Export and publish a complete Android update; never upload source or secrets."""
import argparse
import base64
import datetime
import hashlib
import io
import json
import mimetypes
import os
import re
from pathlib import Path
import subprocess
import urllib.request
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://erp.chipmunks.fun/app-updates'


def create_export_folder(parent, now=None):
    """Reserve a readable local build directory without overwriting earlier jobs."""
    parent.mkdir(parents=True, exist_ok=True)
    stamp = (now or datetime.datetime.now()).strftime('%Y-%m-%d_%H-%M')
    sequence = 1
    while True:
        folder = parent / (stamp if sequence == 1 else f'{stamp}_{sequence:02d}')
        try:
            folder.mkdir()
            return folder
        except FileExistsError:
            sequence += 1


def package_export(folder, runtime, notes, expo_config=None):
    meta = json.loads((folder / 'metadata.json').read_text(encoding='utf-8-sig'))['fileMetadata']['android']
    objects = {}

    def asset(relative, extension, reusable=False):
        source = (folder / relative).resolve()
        if not source.is_relative_to(folder.resolve()):
            raise ValueError('Invalid export path')
        raw = source.read_bytes()
        digest = hashlib.sha256(raw).digest()
        storage_key = digest.hex()
        # Native APKs index bundled resources by Metro's packager hash. Keep
        # that identity while using SHA256 independently for storage/integrity.
        metro_key = source.name
        key = metro_key if reusable and re.fullmatch(r'[a-f0-9]{32}', metro_key) and hashlib.md5(raw).hexdigest() == metro_key else storage_key
        objects[storage_key] = raw
        return {'key': key, 'hash': base64.urlsafe_b64encode(digest).decode().rstrip('='),
                'fileExtension': '.' + extension.lstrip('.'),
                'contentType': mimetypes.guess_type('asset.' + extension.lstrip('.'))[0] or 'application/octet-stream',
                'url': BASE + '/assets/' + storage_key}

    manifest = {'id': str(uuid.uuid4()), 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'runtimeVersion': runtime, 'launchAsset': asset(meta['bundle'], 'bundle'),
                'assets': [asset(a['path'], a['ext'], reusable=True) for a in meta['assets']],
                'metadata': {}, 'extra': {'expoClient': expo_config or {}, 'warehouseUpdate': {'notes': notes}}}
    manifest['launchAsset']['contentType'] = 'application/javascript'
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', json.dumps(manifest))
        for key, raw in objects.items():
            archive.writestr('assets/' + key, raw)
    return output.getvalue(), manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--notes-file', required=True)
    args = parser.parse_args()
    notes = Path(args.notes_file).read_text(encoding='utf-8-sig').strip()
    if not notes or len(notes) > 2000:
        raise ValueError('Enter update notes (1-2000 characters).')
    print('[1/5] Checking APK compatibility...', flush=True)
    baseline_file = ROOT / 'dist/apk/ota-baseline.json'
    if not baseline_file.exists():
        raise ValueError('请先通过构建工具成功构建并安装启用热更新的新 APK，然后再发布热更新。')
    baseline = json.loads(baseline_file.read_text(encoding='utf-8-sig'))
    runtime = subprocess.check_output(['node', str(ROOT / 'scripts/ota-runtime.cjs')], cwd=ROOT, text=True).strip()
    version = json.loads((ROOT / 'client/version.json').read_text(encoding='utf-8-sig'))
    if baseline['runtimeVersion'] != runtime or baseline['version'] != version['version']:
        raise ValueError('原生配置或 APK 版本发生变化，请先构建并安装新版 APK。')
    env = dict(os.environ, NODE_ENV='production', EXPO_NO_DOTENV='1', CI='1')
    config = json.loads((ROOT / 'android-build.local').read_text(encoding='utf-8-sig'))
    nas = json.loads(Path(config['updateServerFile']).read_text(encoding='utf-8-sig'))
    # Same private NAS source as APK build, only passed in process environment.
    if isinstance(nas, dict):
        url = nas.get('defaultServer') or nas.get('url') or nas.get('serverUrl')
        if not url:
            raise ValueError('Cannot resolve private NAS configuration.')
        env['UPDATE_SERVER_URL'] = url
    folder = create_export_folder(ROOT / 'dist/ota')
    print('热更新产物目录：' + str(folder), flush=True)
    cli = subprocess.check_output(['node', '-p', "require.resolve('expo/bin/cli')"], cwd=ROOT / 'client', text=True).strip()
    print('[2/5] Exporting Android update...', flush=True)
    subprocess.run(['node', cli, 'export', '--platform', 'android', '--output-dir', str(folder)], cwd=ROOT / 'client', env=env, check=True)
    # Refuse publishing when native inputs changed during export.
    if subprocess.check_output(['node', str(ROOT / 'scripts/ota-runtime.cjs')], cwd=ROOT, text=True).strip() != runtime:
        raise ValueError('Native source changed during export; retry after building APK.')
    print('[3/5] Verifying update assets...', flush=True)
    public_config = json.loads(subprocess.check_output(['node', cli, 'config', '--type', 'public', '--json'], cwd=ROOT / 'client', env=env, text=True, encoding='utf-8'))
    data, manifest = package_export(folder, runtime, notes, public_config)
    (folder / 'update.zip').write_bytes(data)
    print('热更新包：' + str(folder / 'update.zip'), flush=True)
    token = os.environ.get('WAREHOUSE_OTA_TOKEN', '')
    if not token:
        raise ValueError('Publish credentials missing. Configure this computer first.')
    print('[4/5] Uploading verified package: %.2f MB' % (len(data) / 1000000), flush=True)
    request = urllib.request.Request(BASE + '/publish', data=data, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/zip'}, method='POST')
    with urllib.request.urlopen(request, timeout=240) as response:
        result = json.load(response)
    if result.get('id') != manifest['id'] or not result.get('ok'):
        raise ValueError('Server publication confirmation mismatch')
    print('[5/5] Server publication confirmed.', flush=True)
    print('PUBLISHED: ' + manifest['id'], flush=True)


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        phase = '导出前端更新包' if 'export' in error.cmd else '读取应用配置' if 'config' in error.cmd else '检查构建环境'
        print('Publication failed: %s失败，退出码 %s。请查看上方日志。' % (phase, error.returncode), flush=True)
        raise SystemExit(1)
    except Exception as error:
        # Exceptions from commands and URLs must not expose private NAS values.
        print('Publication failed: ' + (str(error) if isinstance(error, (ValueError, FileNotFoundError)) else type(error).__name__), flush=True)
        raise SystemExit(1)
