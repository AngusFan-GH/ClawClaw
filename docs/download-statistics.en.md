# Download statistics

[中文](download-statistics.md)

Nginx serves formal installers directly. A Python 3.9+ standard-library collector incrementally reads JSON logs, updates SQLite and generates reports every minute. The page polls every 30 seconds and refreshes when visible again; results usually appear about 1–2 minutes after transfer ends. Dates use Asia/Shanghai. Clients, download URLs and resumption remain unchanged.

## Local configuration and deployment

Copy `.env.server.example` to ignored `.env.server.local` and fill in the actual settings. Existing deployments must retain their data directory to avoid appearing to lose history by accidentally using a new one. Existing local settings can continue to be used.

| Local setting | Purpose |
| --- | --- |
| `STATS_DEPLOY_HOST`, `STATS_DEPLOY_USER`, `STATS_DEPLOY_PORT` | SSH target, administrator and port |
| `STATS_DEPLOY_SSH_KEY_FILE`, `STATS_DEPLOY_SSH_KNOWN_HOSTS_FILE` | Optional local SSH paths; existing SSH configuration and agent also work |
| `STATS_PROGRAM_DIR` | Remote collector program directory |
| `STATS_DATA_DIR` | Data root: private database/key in `private/`, aggregate reports in `report/` |
| `STATS_LOG_DIR`, `STATS_BACKUP_DIR` | Raw log and deployment backup directories |
| `STATS_NGINX_CONFIG`, `STATS_ACCESS_LOG` | Existing download vhost and ordinary access log |
| `STATS_BIND_ADDRESS`, `STATS_HTTP_PORT` | Private IPv4 listener and report port |
| `STATS_ALLOWED_CIDRS` | Allowed company IPv4 CIDRs, comma separated |

There are no actual host, administrator or deployment-directory defaults. Missing settings fail before connecting; release-account settings are not used as fallbacks. Administrative privileges are required; non-root administrators need passwordless sudo. Strict SSH host-key verification remains enabled.

```sh
# Full deployment/update
corepack pnpm deploy:stats
# Dashboard assets only
corepack pnpm deploy:stats --page-only
# Preview without connecting
corepack pnpm deploy:stats --dry-run
```

Full deployment runs regression and syntax checks before administrative preflight. Nginx, systemd and logrotate files are templates containing `@@VARIABLE@@`; the script renders them in a temporary directory before upload. Do not copy raw templates directly to the server. Generated `runtime.env` contains only runtime deployment paths and listener settings, without SSH private keys or the complete local environment, and is removed after deployment.

Both modes upload a fixed file allowlist, back up managed files to `$STATS_BACKUP_DIR/stats-deploy-backup.*/files.tgz`, and verify assets and JSON without overwriting the private database or key. Full installation checks `nginx -t`, reloads gracefully and updates the timer. Failures exit nonzero; the installer automatically restores Nginx configuration, while other files can be restored from backups. Page-only mode does not restart services. Installer publication remains the separate `deploy:run` workflow.

Standalone `deploy/clawclaw*.nginx.conf` templates also use local `UPDATE_REMOTE_ROOT`, `UPDATE_TLS_CERT`, `UPDATE_TLS_KEY` and logging settings. Full statistics deployment only adjusts logging in the existing download vhost, preserving its certificates and installer directory. Release publication now requires an explicit `UPDATE_REMOTE_ROOT`.

## Access and diagnosis

From the company network open `http://<STATS_BIND_ADDRESS>:<STATS_HTTP_PORT>/` without an SSH tunnel. The report binds only to the configured private IPv4 and loopback, with a local CIDR allowlist. Do not forward the port publicly. This is an internal HTTP aggregate report without login. If a host firewall is enabled, allow only actual company source networks.

The dashboard shows estimated downloads, complete sends, traffic and version/platform breakdowns, with date/version/platform filters and CSV export. Verification traffic and detailed facts remain in underlying data. Reports over five minutes old are flagged; zeroes do not establish collection health.

```sh
# On the server
systemctl status clawclaw-download-stats.timer
journalctl -u clawclaw-download-stats.service
systemctl start clawclaw-download-stats.service
# Replace <report-port> using local configuration.
curl --fail http://127.0.0.1:<report-port>/stats.json
```

## Definitions and storage

Only `/releases/dsh/<version>/ClawClaw-<version>-universal.dmg` and `ClawClaw-<version>-x64-Setup.exe` are counted.

| Metric | Definition |
| --- | --- |
| Valid requests | GET 200 / 206 |
| Estimated sessions | Same file, IP and User-Agent; a new session after over 30 minutes of inactivity, using the latest overlapping end time |
| Complete sends | Normally completed 200 with body bytes equal to a positive Content-Length; no completion inferred from resumption |
| Resume, failure, interruption | GET 206, GET 4xx/5xx, and abnormally ended GET 200/206 respectively |
| Traffic | Actual body bytes of all GET responses for formal installers, including errors |

Sessions can cross midnight and use their start date; other facts use request start dates. Nginx logs when requests end; active transfers do not appear yet. HEAD, manifests, health checks, metadata and nonformal paths are excluded. Complete sends are not installations or client-side SHA-512 success; sessions are not people. Shared IPs, changed networks and unrecognized bots affect estimates. Cached downloads, offline copies and other servers cannot be observed.

Publication verification uses `User-Agent: ClawClaw-Release-Verify/1` and `X-ClawClaw-Download-Purpose: deployment-verification` and is excluded from user metrics. These are spoofable classification hints; other sources are unknown.

Raw IP/User-Agent logs in `$STATS_LOG_DIR/downloads.jsonl*` are administrator-only and retained for 30 daily rotations. Database/key in `$STATS_DATA_DIR/private/` (0700) retain de-identified request facts, keyed IP/User-Agent HMACs and cursors long term, without raw IPs, user agents or query strings. Restore the database with `ip-hmac.key`; an existing database without its key prevents regeneration. Aggregates live in `$STATS_DATA_DIR/report/`.

Events and cursors commit together; request IDs deduplicate imports. Rename rotation, gzip, late logs and midnight are supported. Do not use copytruncate. Partial final lines wait; invalid complete lines are skipped and counted. Sessions are recalculated each run for the current single-server scale; larger scale needs partitioning. Unimported logs beyond retention cannot be recovered; old ordinary logs are not backfilled. Stable HMAC facts persist long term; retention changes must account for deduplication and recalculation.

To disable, disable the timer, restore the backed-up vhost and Nginx includes using the printed backup location, then run `nginx -t && systemctl reload nginx`. Keep logs/state until they are no longer needed.

Checks: `corepack pnpm test:download-stats`, `corepack pnpm test:upload-update`, `corepack pnpm test:github-release`.
