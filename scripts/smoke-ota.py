"""Verify the live HTTPS upload/manifest/download flow with an isolated runtime."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.error
import urllib.request
import uuid
import paramiko

ROOT = Path(__file__).resolve().parents[1]


def main():
    spec = importlib.util.spec_from_file_location('publisher', ROOT / 'scripts/publish-ota.py')
    publisher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(publisher)
    script = "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Security'); $b=[IO.File]::ReadAllBytes($env:OTA_TOKEN_FILE); [Console]::Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))"
    token = subprocess.check_output(['powershell.exe', '-NoProfile', '-Command', script], text=True,
                                   env=dict(os.environ, OTA_TOKEN_FILE=str(Path(os.environ['LOCALAPPDATA']) / 'ChipmunksBuildTools/ota/publish-token.bin')))
    with urllib.request.urlopen(urllib.request.Request(publisher.BASE + '/publish/check', headers={'Authorization': 'Bearer ' + token}), timeout=20) as response:
        assert json.load(response).get('canPublish') is True
    cfg = json.loads(Path('D:/Chipmunks_wx/.local/ssh.json').read_text(encoding='utf-8-sig'))
    ssh = paramiko.SSHClient(); ssh.load_system_host_keys(); ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    ssh.connect(cfg['host'], port=cfg.get('port', 22), username=cfg['username'], password=cfg.get('password') or None,
                key_filename=cfg.get('keyFile') or None, look_for_keys=False, allow_agent=False, timeout=15)
    sftp = ssh.open_sftp()
    runtime = 'android-' + '0' * 32
    try:
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            (folder / 'bundle').write_bytes(('OTA live smoke ' + str(uuid.uuid4())).encode())
            (folder / 'metadata.json').write_text(json.dumps({'fileMetadata': {'android': {'bundle': 'bundle', 'assets': []}}}))
            data, manifest = publisher.package_export(folder, runtime, 'Isolated transport test')
            try:
                urllib.request.urlopen(urllib.request.Request(publisher.BASE + '/publish', data=data), timeout=20)
                raise AssertionError('Unauthenticated upload accepted')
            except urllib.error.HTTPError as error:
                assert error.code == 401
            try:
                req = urllib.request.Request(publisher.BASE + '/publish', data=data, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/zip'})
                with urllib.request.urlopen(req, timeout=30) as response:
                    assert json.load(response)['id'] == manifest['id']
                headers = {'expo-platform': 'android', 'expo-runtime-version': runtime, 'expo-protocol-version': '1', 'accept': 'application/expo+json'}
                with urllib.request.urlopen(urllib.request.Request(publisher.BASE + '/manifest', headers=headers), timeout=20) as response:
                    assert response.headers['expo-protocol-version'] == '1'
                    assert json.load(response)['id'] == manifest['id']
                with urllib.request.urlopen(manifest['launchAsset']['url'], timeout=20) as response:
                    assert hashlib.sha256(response.read()).hexdigest() == manifest['launchAsset']['key']
            finally:
                # Exact synthetic objects only; no recursive cleanup or real releases.
                for item in [f'active/{runtime}.json', f'releases/{manifest["id"]}/manifest.json', f'assets/{manifest["launchAsset"]["key"]}']:
                    try: sftp.remove('/var/lib/warehouse-ota/' + item)
                    except FileNotFoundError: pass
                try: sftp.rmdir('/var/lib/warehouse-ota/releases/' + manifest['id'])
                except FileNotFoundError: pass
        report = {'httpsUpload': True, 'unauthorizedRejected': True, 'manifestRead': True, 'assetHashVerified': True, 'syntheticReleaseRemoved': True}
        (ROOT / 'output/ota-smoke.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    finally:
        sftp.close(); ssh.close()


if __name__ == '__main__': main()
