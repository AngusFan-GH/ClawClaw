#!/usr/bin/env bash
# Deploy only from a bundle rendered by deploy:stats, not raw repository templates.
set -euo pipefail
test "$(id -u)" = 0
source_root=$(cd "$(dirname "$0")/../.." && pwd)
source "$source_root/runtime.env"
config=${STATS_NGINX_CONFIG:?}
test -f "$config"
python3 -c 'import sqlite3, fcntl'
mkdir -p "$STATS_BACKUP_DIR"
backup=$(mktemp -d "$STATS_BACKUP_DIR/download-stats-backup.XXXXXXXX")
cp -a "$config" "$backup/download-vhost.conf"
for name in 00-clawclaw-download-log.conf clawclaw-download-report.conf; do
    if test -f "$STATS_NGINX_DIR/$name"; then cp -a "$STATS_NGINX_DIR/$name" "$backup/$name"; fi
done
rollback() {
    cp -a "$backup/download-vhost.conf" "$config"
    for name in 00-clawclaw-download-log.conf clawclaw-download-report.conf; do
        if test -f "$backup/$name"; then cp -a "$backup/$name" "$STATS_NGINX_DIR/$name"; else rm -f "$STATS_NGINX_DIR/$name"; fi
    done
    nginx -t && systemctl reload nginx
}
trap rollback ERR
install -d -m 755 "$STATS_PROGRAM_DIR" "$STATS_DATA_DIR" "$STATS_REPORT_DIR"
install -d -m 700 "$STATS_PRIVATE_DIR"
install -d -m 750 "$STATS_LOG_DIR"
install -m 644 "$source_root/scripts/download-stats.py" "$STATS_PROGRAM_DIR/"
for name in index.html dashboard.css dashboard.js; do install -m 644 "$source_root/deploy/download-stats/$name" "$STATS_REPORT_DIR/"; done
install -m 644 "$source_root/deploy/download-stats/nginx-log.conf" "$STATS_NGINX_DIR/00-clawclaw-download-log.conf"
install -m 644 "$source_root/deploy/download-stats/nginx-report.conf" "$STATS_NGINX_DIR/clawclaw-download-report.conf"
install -m 644 "$source_root/deploy/download-stats/logrotate.conf" /etc/logrotate.d/clawclaw-downloads
for name in service timer; do install -m 644 "$source_root/deploy/download-stats/clawclaw-download-stats.$name" /etc/systemd/system/; done
python3 - "$config" <<'PY'
import os, re, sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text()
# Remove the managed conditional directive before inserting the configured path.
text = re.sub(r'^\s*access_log [^\n;]+ clawclaw_download if=\$clawclaw_log_download;\n', '', text, flags=re.M)
markers = list(re.finditer(r'^\s*ssl_certificate_key\s+[^;]+;', text, flags=re.M))
if len(markers) != 1:
    raise RuntimeError('Expected one TLS download server; refusing to guess the server block')
marker = markers[0]
normal = '    access_log ' + os.environ['STATS_ACCESS_LOG'] + ' main;'
lines = '' if normal.strip() in text else '\n' + normal
lines += '\n    access_log ' + os.environ['STATS_LOG_DIR'] + '/downloads.jsonl clawclaw_download if=$clawclaw_log_download;'
text = text[:marker.end()] + lines + text[marker.end():]
path.write_text(text)
PY
if command -v selinuxenabled >/dev/null && selinuxenabled; then
    command -v semanage >/dev/null
    semanage fcontext -a -t httpd_sys_content_t "$STATS_REPORT_DIR(/.*)?" 2>/dev/null || semanage fcontext -m -t httpd_sys_content_t "$STATS_REPORT_DIR(/.*)?"
    semanage fcontext -a -t httpd_log_t "$STATS_LOG_DIR(/.*)?" 2>/dev/null || semanage fcontext -m -t httpd_log_t "$STATS_LOG_DIR(/.*)?"
    semanage port -a -t http_port_t -p tcp "$STATS_HTTP_PORT" 2>/dev/null || semanage port -m -t http_port_t -p tcp "$STATS_HTTP_PORT"
    restorecon -R "$STATS_REPORT_DIR" "$STATS_LOG_DIR"
fi
nginx -t
systemctl daemon-reload
systemctl start clawclaw-download-stats.service
systemctl reload nginx
systemctl enable --now clawclaw-download-stats.timer
systemctl restart clawclaw-download-stats.timer
trap - ERR
printf 'Installed. Nginx rollback configuration: %s\n' "$backup"
