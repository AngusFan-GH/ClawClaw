#!/usr/bin/env bash
# Run as root from an unpacked repository source bundle on the download server.
set -euo pipefail
test "$(id -u)" = 0
source_root=$(cd "$(dirname "$0")/../.." && pwd)
config=/etc/nginx/conf.d/clawclaw.conf
test -f "$config"
python3 -c 'import sqlite3, fcntl'
backup=$(mktemp -d /etc/clawclaw/download-stats-backup.XXXXXXXX)
cp -a "$config" "$backup/clawclaw.conf"
for name in 00-clawclaw-download-log.conf clawclaw-download-report.conf; do
    if test -f "/etc/nginx/conf.d/$name"; then cp -a "/etc/nginx/conf.d/$name" "$backup/$name"; fi
done
rollback() {
    cp -a "$backup/clawclaw.conf" "$config"
    for name in 00-clawclaw-download-log.conf clawclaw-download-report.conf; do
        if test -f "$backup/$name"; then cp -a "$backup/$name" "/etc/nginx/conf.d/$name"; else rm -f "/etc/nginx/conf.d/$name"; fi
    done
    nginx -t && systemctl reload nginx
}
trap rollback ERR
install -d -m 755 /opt/clawclaw-download-stats /var/lib/clawclaw-download-stats /var/lib/clawclaw-download-stats/report
install -d -m 700 /var/lib/clawclaw-download-stats/private
install -d -m 750 /var/log/clawclaw-downloads
install -m 644 "$source_root/scripts/download-stats.py" /opt/clawclaw-download-stats/
for name in index.html dashboard.css dashboard.js; do install -m 644 "$source_root/deploy/download-stats/$name" /var/lib/clawclaw-download-stats/report/; done
install -m 644 "$source_root/deploy/download-stats/nginx-log.conf" /etc/nginx/conf.d/00-clawclaw-download-log.conf
install -m 644 "$source_root/deploy/download-stats/nginx-report.conf" /etc/nginx/conf.d/clawclaw-download-report.conf
install -m 644 "$source_root/deploy/download-stats/logrotate.conf" /etc/logrotate.d/clawclaw-downloads
for name in service timer; do install -m 644 "$source_root/deploy/download-stats/clawclaw-download-stats.$name" /etc/systemd/system/; done
python3 - "$config" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text()
line = '    access_log /var/log/clawclaw-downloads/downloads.jsonl clawclaw_download if=$clawclaw_log_download;'
if line not in text:
    marker = '    ssl_certificate_key /etc/clawclaw/tls/xzinfra.com.key;'
    if text.count(marker) != 1:
        raise RuntimeError('Unrecognized ClawClaw config; refusing to guess the server block')
    text = text.replace(marker, marker + '\n    access_log /var/log/nginx/access.log main;\n' + line)
    path.write_text(text)
PY
if command -v selinuxenabled >/dev/null && selinuxenabled; then
    # Persist file labels so report regeneration and restorecon remain compatible.
    command -v semanage >/dev/null
    semanage fcontext -a -t httpd_sys_content_t '/var/lib/clawclaw-download-stats/report(/.*)?' 2>/dev/null || semanage fcontext -m -t httpd_sys_content_t '/var/lib/clawclaw-download-stats/report(/.*)?'
    semanage fcontext -a -t httpd_log_t '/var/log/clawclaw-downloads(/.*)?' 2>/dev/null || semanage fcontext -m -t httpd_log_t '/var/log/clawclaw-downloads(/.*)?'
    semanage port -a -t http_port_t -p tcp 9529 2>/dev/null || semanage port -m -t http_port_t -p tcp 9529
    restorecon -R /var/lib/clawclaw-download-stats/report /var/log/clawclaw-downloads
fi
nginx -t
systemctl daemon-reload
systemctl start clawclaw-download-stats.service
systemctl reload nginx
systemctl enable --now clawclaw-download-stats.timer
systemctl restart clawclaw-download-stats.timer
trap - ERR
printf 'Installed. Nginx rollback configuration: %s\n' "$backup"
