"""Isolated, stdlib-only update service. No ERP imports or credentials."""
import hashlib
import gzip
import hmac
import io
import json
import os
import re
import threading
import time
import uuid
import zipfile
from urllib.parse import urlsplit, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from ota_storage import storage_lock

ROOT = Path(os.environ.get('OTA_DATA', '/var/lib/warehouse-ota'))
TOKEN = os.environ.get('OTA_PUBLISH_TOKEN', '')
BASE = 'https://erp.chipmunks.fun/app-updates'
LOCK = threading.Lock()
RATE_LOCK = threading.Lock()
NEXT_SEND = 0.0


def storage_key(asset):
    value = asset['url'].removeprefix(BASE + '/assets/')
    if not re.fullmatch(r'[a-f0-9]{64}', value) or asset['url'] != BASE + '/assets/' + value:
        raise ValueError('Invalid asset URL')
    return value


def accepts_gzip(header):
    values = {}
    for part in header.lower().split(','):
        fields = part.strip().split(';')
        quality = 1.0
        for field in fields[1:]:
            if field.strip().startswith('q='):
                try: quality = float(field.strip()[2:])
                except ValueError: quality = 0
        values[fields[0].strip()] = quality
    return values.get('gzip', values.get('*', 0)) > 0


def compressed_asset(asset):
    target = asset.with_suffix('.gz')
    with LOCK:
        if not target.exists():
            raw = asset.read_bytes()
            packed = gzip.compress(raw, compresslevel=6, mtime=0)
            if len(packed) >= len(raw):
                return asset
            temp = target.with_suffix('.gz.tmp')
            temp.write_bytes(packed)
            temp.replace(target)
    return target


def validate_package(data):
    archive = zipfile.ZipFile(io.BytesIO(data))
    if len(archive.infolist()) > 10000 or sum(x.file_size for x in archive.infolist()) > 150 * 1024 * 1024:
        raise ValueError('Package too large')
    for entry in archive.infolist():
        if not re.fullmatch(r'(manifest\.json|assets/[a-f0-9]{64})', entry.filename):
            raise ValueError('Invalid package entry')
    names = archive.namelist()
    if len(names) != len(set(names)):
        raise ValueError('Duplicate entries')
    manifest = json.loads(archive.read('manifest.json'))
    uuid.UUID(manifest['id'])
    if not re.fullmatch(r'android-[a-f0-9]{32}', manifest['runtimeVersion']):
        raise ValueError('Invalid runtime')
    from datetime import datetime
    datetime.fromisoformat(manifest['createdAt'].replace('Z', '+00:00'))
    for asset in [manifest['launchAsset'], *manifest['assets']]:
        key = asset['key']
        if not re.fullmatch(r'(?:[a-f0-9]{32}|[a-f0-9]{64})', key):
            raise ValueError('Invalid asset key')
        digest_key = storage_key(asset)
        raw = archive.read('assets/' + digest_key)
        digest = hashlib.sha256(raw).digest()
        import base64
        if digest.hex() != digest_key or base64.urlsafe_b64encode(digest).decode().rstrip('=') != asset['hash']:
            raise ValueError('Asset checksum mismatch')
        if key != (hashlib.md5(raw).hexdigest() if len(key) == 32 else digest.hex()):
            raise ValueError('Asset cache identity mismatch')
    return archive, manifest


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data=b'', mime='application/json'):
        self.send_response(status)
        if status != 204:
            self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'private, max-age=0')
        self.send_header('expo-protocol-version', '1')
        self.send_header('expo-sfv-version', '0')
        self.send_header('expo-manifest-filters', '')
        self.send_header('expo-server-defined-headers', '')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        global NEXT_SEND
        parsed = urlsplit(self.path)
        if parsed.path == '/publish/check':
            if not TOKEN or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN):
                return self.reply(401)
            return self.reply(200, b'{"ok":true,"service":"warehouse-ota","canPublish":true}')
        if parsed.path == '/status':
            runtime = parse_qs(parsed.query).get('runtime', [''])[0]
            if not re.fullmatch(r'android-[a-f0-9]{32}', runtime):
                return self.reply(400)
            supported = (ROOT / 'active' / (runtime + '.json')).exists()
            installed_version = parse_qs(parsed.query).get('apkVersion', [''])[0]
            def version(value):
                if not re.fullmatch(r'\d+\.\d+\.\d+', str(value)):
                    return (0, 0, 0)
                return tuple(int(part) for part in value.split('.'))
            newer_apk = False
            for entry in (ROOT / 'active').glob('*.json'):
                release = json.loads(entry.read_bytes())
                apk_version = release.get('extra', {}).get('expoClient', {}).get('version', '')
                if version(apk_version) > version(installed_version) and installed_version:
                    newer_apk = True
            return self.reply(200, json.dumps({'requiresApk': newer_apk and not supported}).encode())
        if self.path == '/health':
            return self.reply(200, b'{"ok":true,"service":"warehouse-ota"}')
        if re.fullmatch(r'/assets/[a-f0-9]{64}', self.path):
            asset = ROOT / self.path.lstrip('/')
            if not asset.is_file():
                return self.reply(404)
            selected = compressed_asset(asset) if accepts_gzip(self.headers.get('Accept-Encoding', '')) else asset
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(selected.stat().st_size))
            self.send_header('Vary', 'Accept-Encoding')
            if selected != asset:
                self.send_header('Content-Encoding', 'gzip')
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
            self.end_headers()
            try:
                with selected.open('rb') as stream:
                    while chunk := stream.read(8192):
                        with RATE_LOCK:
                            now = time.monotonic()
                            scheduled = max(now, NEXT_SEND)
                            NEXT_SEND = scheduled + len(chunk) / 160000
                        time.sleep(max(0, scheduled - time.monotonic()))
                        self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        if self.path != '/manifest':
            return self.reply(404)
        runtime = self.headers.get('expo-runtime-version', '')
        if self.headers.get('expo-platform') != 'android' or not re.fullmatch(r'android-[a-f0-9]{32}', runtime):
            return self.reply(400)
        if self.headers.get('expo-protocol-version') != '1':
            return self.reply(406)
        pointer = ROOT / 'active' / (runtime + '.json')
        if not pointer.exists():
            return self.reply(204)
        raw = pointer.read_bytes()
        if self.headers.get('expo-current-update-id', '').lower() == json.loads(raw)['id'].lower():
            return self.reply(204)
        self.reply(200, raw, 'application/expo+json')

    def do_POST(self):
        if self.path != '/publish':
            return self.reply(404)
        if not TOKEN or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN):
            return self.reply(401)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 80 * 1024 * 1024:
                return self.reply(413)
            self.connection.settimeout(120)
            data = self.rfile.read(length)
            archive, manifest = validate_package(data)
            with LOCK, storage_lock(ROOT):
                target = ROOT / 'releases' / manifest['id']
                if target.exists():
                    raise ValueError('Release already exists')
                target.mkdir(parents=True)
                for asset in [manifest['launchAsset'], *manifest['assets']]:
                    digest_key = storage_key(asset)
                    dest = ROOT / 'assets' / digest_key
                    if not dest.exists():
                        temp = dest.with_suffix('.tmp')
                        temp.write_bytes(archive.read('assets/' + digest_key))
                        temp.replace(dest)
                raw = json.dumps(manifest, separators=(',', ':')).encode()
                (target / 'manifest.json').write_bytes(raw)
                active = ROOT / 'active' / (manifest['runtimeVersion'] + '.json')
                temp = active.with_suffix('.tmp')
                temp.write_bytes(raw)
                temp.replace(active)  # Publish only after every asset is complete.
            self.reply(200, json.dumps({'ok': True, 'id': manifest['id']}).encode())
        except (ValueError, KeyError, zipfile.BadZipFile, OSError):
            self.reply(400, b'{"error":"Invalid or incomplete update package"}')

    def log_message(self, fmt, *args):
        # Authorization and package contents are never logged.
        print(self.command, self.path, flush=True)


if __name__ == '__main__':
    for name in ['assets', 'active', 'releases']:
        (ROOT / name).mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer(('127.0.0.1', 18321), Handler).serve_forever()
