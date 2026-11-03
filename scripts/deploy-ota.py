"""Deploy only the independent OTA service and an isolated nginx location."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import paramiko

ROOT = Path(__file__).resolve().parents[1]


def main():
    # Reuse existing operator SSH profile without copying credentials into repo.
    profile = Path.home() / 'AppData/Local/ChipmunksBuildTools/ota/ssh.json'
    if not profile.exists():
        profile = Path('D:/Chipmunks_wx/.local/ssh.json')
    cfg = json.loads(profile.read_text(encoding='utf-8-sig'))
    if cfg['host'] != '47.116.37.183':
        raise ValueError('Unexpected server; refusing deployment')
    ssh = paramiko.SSHClient()
    ssh.load_system_host_keys()
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    ssh.connect(cfg['host'], port=cfg.get('port', 22), username=cfg['username'], password=cfg.get('password') or None,
                key_filename=cfg.get('keyFile') or None, look_for_keys=False, allow_agent=False, timeout=15)
    sftp = ssh.open_sftp()

    def command(cmd):
        _, out, err = ssh.exec_command(cmd, timeout=35)
        result = out.read().decode()
        error = err.read().decode()
        if out.channel.recv_exit_status():
            raise RuntimeError('Remote check failed: ' + error[:200])
        return result

    def put(path, value, mode=0o644):
        with sftp.open(path, 'w') as stream:
            stream.write(value)
        sftp.chmod(path, mode)

    units = ['palm-warehouse-server', 'palm-warehouse-erp@wuxi-duneng', 'palm-warehouse-erp@shanghai-chipmunk', 'chipmunks-wx']
    def snapshot():
        return {unit: command('systemctl show ' + unit + ' -p MainPID -p ActiveState').strip() for unit in units}
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    nginx = sftp.normalize('/etc/nginx/sites-enabled/palm-warehouse.conf')
    original = sftp.open(nginx).read().decode()
    before = snapshot()
    env_hash = command('sha256sum /etc/palm-warehouse/erp/*.env')
    modified_nginx = False
    try:
        command('install -d -m 700 /var/backups/warehouse-ota/' + stamp)
        command('cp -a ' + shlex.quote(nginx) + ' /var/backups/warehouse-ota/' + stamp + '/nginx.conf')
        command('id -u warehouseota >/dev/null 2>&1 || useradd --system --home-dir /var/lib/warehouse-ota --shell /usr/sbin/nologin warehouseota')
        command('install -d -m 755 /opt/warehouse-ota; install -d -m 750 -o warehouseota -g warehouseota /var/lib/warehouse-ota')
        token = secrets.token_urlsafe(48)
        try:
            old_env = sftp.open('/etc/warehouse-ota.env').read().decode()
            token = re.search(r'^OTA_PUBLISH_TOKEN=(\S+)', old_env, re.M)[1]
        except FileNotFoundError:
            put('/etc/warehouse-ota.env', 'OTA_PUBLISH_TOKEN=' + token + '\nOTA_DATA=/var/lib/warehouse-ota\n', 0o600)
        for filename in ['ota-server.py', 'ota_storage.py', 'ota_cleanup.py']:
            put('/opt/warehouse-ota/' + filename, (ROOT / 'scripts' / filename).read_text())
        command('python3 -m py_compile /opt/warehouse-ota/ota-server.py')
        put('/etc/systemd/system/warehouse-ota.service', '''[Unit]
Description=Independent Warehouse APP Updates
After=network.target
[Service]
User=warehouseota
Group=warehouseota
EnvironmentFile=/etc/warehouse-ota.env
ExecStart=/usr/bin/python3 /opt/warehouse-ota/ota-server.py
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/warehouse-ota
MemoryMax=256M
[Install]
WantedBy=multi-user.target
''')
        put('/etc/systemd/system/warehouse-ota-cleanup.service', '''[Unit]
Description=Warehouse APP update retention
[Service]
Type=oneshot
User=warehouseota
Group=warehouseota
ExecStart=/usr/bin/python3 /opt/warehouse-ota/ota_cleanup.py
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/warehouse-ota
''')
        put('/etc/systemd/system/warehouse-ota-cleanup.timer', '''[Unit]
Description=Daily warehouse update retention
[Timer]
OnCalendar=*-*-* 03:40:00 Asia/Shanghai
Persistent=true
Unit=warehouse-ota-cleanup.service
[Install]
WantedBy=timers.target
''')
        command('systemctl daemon-reload; systemctl enable warehouse-ota; systemctl restart warehouse-ota')
        command('systemctl enable --now warehouse-ota-cleanup.timer')
        command('curl -fsS --retry 6 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:18321/health')
        include = 'include /etc/nginx/warehouse-ota-location.conf;'
        if include not in original:
            insert = None
            for match in re.finditer(r'\bserver\s*\{', original):
                at = match.end(); depth = 1
                while at < len(original) and depth:
                    if original[at] == '{': depth += 1
                    elif original[at] == '}': depth -= 1
                    at += 1
                block = original[match.start():at]
                if re.search(r'server_name\s+erp\.chipmunks\.fun\s*;', block) and re.search(r'listen[^;\n]*\b443\b', block):
                    insert = match.end(); break
            if insert is None:
                raise ValueError('Cannot identify ERP HTTPS server block')
            put(nginx, original[:insert] + '\n    ' + include + '\n' + original[insert:])
            modified_nginx = True
        put('/etc/nginx/warehouse-ota-location.conf', '''location ^~ /app-updates/ {
    client_max_body_size 80m;
    client_body_timeout 240s;
    proxy_read_timeout 240s;
    proxy_send_timeout 240s;
    proxy_pass http://127.0.0.1:18321/;
    proxy_set_header Host $host;
}
''')
        command('nginx -t')
        command('systemctl reload nginx')
        health = command("curl --resolve erp.chipmunks.fun:443:127.0.0.1 -fsS --retry 5 --retry-all-errors --retry-delay 1 --max-time 10 https://erp.chipmunks.fun/app-updates/health")
        after = snapshot()
        if before != after or command('sha256sum /etc/palm-warehouse/erp/*.env') != env_hash:
            raise ValueError('Existing ERP service/configuration changed unexpectedly')
        legacy_health = command("curl --resolve erp.chipmunks.fun:443:127.0.0.1 -fsS --max-time 10 -o /dev/null -w '%{http_code}' https://erp.chipmunks.fun/health")
        local = Path(os.environ['LOCALAPPDATA']) / 'ChipmunksBuildTools/ota'
        local.mkdir(parents=True, exist_ok=True)
        script = "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Security'); $v=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd().Trim()); $b=[Security.Cryptography.ProtectedData]::Protect($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [IO.File]::WriteAllBytes($env:OTA_TOKEN_FILE,$b)"
        subprocess.run(['powershell.exe', '-NoProfile', '-Command', script], input=token, text=True, check=True,
                       env=dict(os.environ, OTA_TOKEN_FILE=str(local / 'publish-token.bin')), capture_output=True)
        report = {'deployedAt': stamp, 'service': 'warehouse-ota', 'health': json.loads(health), 'legacyHealth': legacy_health,
                  'existingServicesBefore': before, 'existingServicesAfter': after, 'accountConfigurationsUnchanged': True,
                  'backup': '/var/backups/warehouse-ota/' + stamp, 'downloadBytesPerSecondTotal': 160000}
        report['retention'] = json.loads(command('runuser -u warehouseota -- python3 /opt/warehouse-ota/ota_cleanup.py --dry-run'))
        report['cleanupTimer'] = command('systemctl is-active warehouse-ota-cleanup.timer').strip()
        output = ROOT / 'output/ota-deployment.json'
        output.parent.mkdir(exist_ok=True)
        output.write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
    except Exception:
        if modified_nginx:
            put(nginx, original)
            command('nginx -t && systemctl reload nginx')
        raise
    finally:
        sftp.close(); ssh.close()


if __name__ == '__main__':
    main()
