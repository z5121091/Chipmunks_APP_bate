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
import urllib.error
import urllib.request
import uuid
import zipfile
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://erp.chipmunks.fun/app-updates'
MAX_PACKAGE_BYTES = 80 * 1024 * 1024
MAX_UNPACKED_BYTES = 150 * 1024 * 1024


class PublicationError(ValueError):
    """A user-readable failure that contains no remote response or credentials."""


@contextmanager
def publication_lock():
    """Share an exclusive file lease with the desktop storage manager."""
    directory = ROOT / 'logs/ota-publish'
    directory.mkdir(parents=True, exist_ok=True)
    try:
        stream = (directory / 'publish.lock').open('a+b')
    except OSError as error:
        raise PublicationError('发布或存储清理正在进行，或无法访问任务锁，请稍后重试。') from error
    try:
        if os.name == 'nt':
            import msvcrt
            try:
                if os.fstat(stream.fileno()).st_size == 0:
                    stream.write(b'0')
                    stream.flush()
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise PublicationError('已有发布或存储清理任务正在进行，请稍后重试。') from error
        else:
            import fcntl
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                raise PublicationError('已有发布任务正在进行，请稍后重试。') from error
        yield
    finally:
        stream.close()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def open_request(request, timeout):
    # A redirect must not send the publishing credential to another endpoint.
    return urllib.request.build_opener(NoRedirect).open(request, timeout=timeout)


def check_publish_connection(token):
    if not token.strip():
        raise PublicationError('尚未配置热更新发布凭据，请到设置中恢复或配置发布连接。')
    request = urllib.request.Request(BASE + '/publish/check',
                                     headers={'Authorization': 'Bearer ' + token.strip(), 'Accept': 'application/json'})
    try:
        with open_request(request, 15) as response:
            result = json.load(response)
        if (not isinstance(result, dict) or result.get('ok') is not True or
                result.get('canPublish') is not True or result.get('service') != 'warehouse-ota'):
            raise PublicationError('发布连接检查返回了无效响应，请在设置中测试发布连接。')
    except urllib.error.HTTPError as error:
        if error.code == 401:
            raise PublicationError('发布凭据不正确或已失效，请在设置中核对发布连接。') from None
        if error.code == 403:
            raise PublicationError('服务器或网络代理拒绝发布权限检查（HTTP 403）。') from None
        if error.code == 404:
            raise PublicationError('服务器未提供发布权限检查接口，请核对服务配置。') from None
        raise PublicationError(f'发布连接检查失败（HTTP {error.code}），请稍后重试。') from None
    except (OSError, TimeoutError, ValueError):
        raise PublicationError('无法确认服务器发布权限，请检查网络或在设置中测试发布连接。') from None


def validate_saved_package(data):
    """Check a local retry archive before any upload, including every referenced asset."""
    if not 0 < len(data) <= MAX_PACKAGE_BYTES:
        raise PublicationError('热更新包大小无效或超过 80 MB，请重新生成。')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if (len(entries) > 10000 or len(names) != len(set(names)) or
                    sum(entry.file_size for entry in entries) > MAX_UNPACKED_BYTES or
                    any(not re.fullmatch(r'(manifest\.json|assets/[a-f0-9]{64})', name) for name in names)):
                raise ValueError('Invalid package entries')
            manifest = json.loads(archive.read('manifest.json'))
            if str(uuid.UUID(manifest['id'])) != manifest['id']:
                raise ValueError('Invalid package ID')
            if not re.fullmatch(r'android-[a-f0-9]{32}', manifest['runtimeVersion']):
                raise ValueError('Invalid runtime')
            parsed_date = datetime.datetime.fromisoformat(manifest['createdAt'].replace('Z', '+00:00'))
            if parsed_date.tzinfo is None:
                raise ValueError('Missing creation timezone')
            required = {'manifest.json'}
            for asset in [manifest['launchAsset'], *manifest['assets']]:
                digest = base64.urlsafe_b64decode(asset['hash'] + '=' * (-len(asset['hash']) % 4))
                if len(digest) != 32:
                    raise ValueError('Invalid asset digest')
                storage_key = digest.hex()
                asset_name = 'assets/' + storage_key
                raw = archive.read(asset_name)
                key = asset['key']
                if (hashlib.sha256(raw).digest() != digest or
                        key != (hashlib.md5(raw).hexdigest() if re.fullmatch(r'[a-f0-9]{32}', key) else storage_key) or
                        asset['url'] != BASE + '/assets/' + storage_key):
                    raise ValueError('Invalid asset integrity or URL')
                required.add(asset_name)
            if set(names) != required:
                raise ValueError('Unreferenced package entry')
            return manifest
    except (KeyError, TypeError, ValueError, zipfile.BadZipFile, OSError, OverflowError):
        raise PublicationError('本地热更新包内容不完整或校验失败，请重新生成。') from None


def read_active_manifest(runtime):
    request = urllib.request.Request(BASE + '/manifest', headers={
        'expo-platform': 'android', 'expo-runtime-version': runtime, 'expo-protocol-version': '1',
        'Accept': 'application/expo+json',
    })
    with open_request(request, 15) as response:
        if response.status == 204:
            return None
        value = json.load(response)
    if not isinstance(value, dict) or value.get('runtimeVersion') != runtime:
        raise PublicationError('无法核对服务器上的当前更新，请稍后重试。')
    return value


def active_matches(manifest, active):
    if active is None or active.get('id') != manifest['id']:
        return False
    if active != manifest:
        raise PublicationError('服务器上相同编号的更新内容与本地包不一致，请核对发布记录。')
    return True


def upload_package(data, manifest, token, retry=False):
    if retry:
        try:
            active = read_active_manifest(manifest['runtimeVersion'])
        except (OSError, TimeoutError, ValueError):
            raise PublicationError('暂时无法核对服务器更新状态，本次未重传，请检查网络后重试。') from None
        if active_matches(manifest, active):
            print('服务器已存在本次更新，已恢复发布确认。', flush=True)
            return
        if active is not None:
            try:
                active_date = datetime.datetime.fromisoformat(active['createdAt'].replace('Z', '+00:00'))
                package_date = datetime.datetime.fromisoformat(manifest['createdAt'].replace('Z', '+00:00'))
                if active_date.tzinfo is None:
                    raise ValueError('Missing timezone')
            except (KeyError, AttributeError, TypeError, ValueError):
                raise PublicationError('无法核对服务器更新日期，本次未重传。') from None
            if active_date >= package_date:
                raise PublicationError('服务器已有更晚的更新，本次未重传旧包。请核对历史记录或重新生成更新。')
    request = urllib.request.Request(BASE + '/publish', data=data, headers={
        'Authorization': 'Bearer ' + token.strip(), 'Content-Type': 'application/zip',
    }, method='POST')
    try:
        with open_request(request, 240) as response:
            result = json.load(response)
        if not isinstance(result, dict) or result.get('id') != manifest['id'] or result.get('ok') is not True:
            raise PublicationError('服务器返回的发布确认与本次更新不一致。')
    except (OSError, TimeoutError, ValueError):
        # Read after an uncertain POST; never repeat the upload automatically.
        try:
            active = read_active_manifest(manifest['runtimeVersion'])
            if active_matches(manifest, active):
                print('已从服务器核对本次更新，发布完成。', flush=True)
                return
        except (OSError, TimeoutError, ValueError):
            pass
        print('OTA-PUBLISH-STATE: unknown', flush=True)
        raise PublicationError('未能确认上传结果。请保留本次更新包，检查网络后使用“重新上传本次更新”核对并恢复。') from None


def print_package_result(path, data, manifest):
    print('OTA-ARTIFACT: ' + str(path.resolve()), flush=True)
    print('OTA-ID: ' + manifest['id'], flush=True)
    print('OTA-SIZE: ' + str(len(data)), flush=True)
    print('OTA-RUNTIME: ' + manifest['runtimeVersion'], flush=True)


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
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--notes-file')
    source.add_argument('--package-file')
    args = parser.parse_args()
    with publication_lock():
        publish(args)


def publish(args):
    print('[1/5] Checking APK compatibility...', flush=True)
    baseline_file = ROOT / 'dist/apk/ota-baseline.json'
    if not baseline_file.exists():
        raise ValueError('请先通过构建工具成功构建并安装启用热更新的新 APK，然后再发布热更新。')
    baseline = json.loads(baseline_file.read_text(encoding='utf-8-sig'))
    runtime = subprocess.check_output(['node', str(ROOT / 'scripts/ota-runtime.cjs')], cwd=ROOT, text=True).strip()
    version = json.loads((ROOT / 'client/version.json').read_text(encoding='utf-8-sig'))
    if baseline['runtimeVersion'] != runtime or baseline['version'] != version['version']:
        raise ValueError('原生配置或 APK 版本发生变化，请先构建并安装新版 APK。')
    token = os.environ.get('WAREHOUSE_OTA_TOKEN', '')
    print('正在检查发布连接和发布权限…', flush=True)
    check_publish_connection(token)
    if args.package_file:
        package_path = Path(args.package_file).resolve()
        if package_path.name != 'update.zip' or not package_path.is_relative_to((ROOT / 'dist/ota').resolve()):
            raise PublicationError('仅支持重新上传当前项目 dist/ota 中保存的 update.zip。')
        if package_path.stat().st_size > MAX_PACKAGE_BYTES:
            raise PublicationError('热更新包超过 80 MB，请重新生成。')
        data = package_path.read_bytes()
        manifest = validate_saved_package(data)
        if (manifest['runtimeVersion'] != runtime or
                manifest.get('extra', {}).get('expoClient', {}).get('version') != version['version']):
            raise PublicationError('此更新包与当前 APK 原生配置或版本不兼容，请重新生成。')
        print_package_result(package_path, data, manifest)
        print('[4/5] 正在核对并重新上传保存的更新包…', flush=True)
        upload_package(data, manifest, token, retry=True)
        print('[5/5] Server publication confirmed.', flush=True)
        print('PUBLISHED: ' + manifest['id'], flush=True)
        return
    notes = Path(args.notes_file).read_text(encoding='utf-8-sig').strip()
    if not notes or len(notes) > 2000:
        raise ValueError('Enter update notes (1-2000 characters).')
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
    validate_saved_package(data)
    package_path = folder / 'update.zip'
    package_path.write_bytes(data)
    print('热更新包：' + str(package_path), flush=True)
    print_package_result(package_path, data, manifest)
    print('[4/5] Uploading verified package: %.2f MB' % (len(data) / 1000000), flush=True)
    upload_package(data, manifest, token)
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
