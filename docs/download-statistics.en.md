# Download statistics

[中文](download-statistics.md)

Nginx serves installers directly. A Python 3.9+ standard-library collector reads dedicated JSON logs, updates SQLite and generates an internal report every minute. Clients, download URLs, manifests and resumption behavior stay unchanged. Dates use Asia/Shanghai time.

## Definitions

Only `/releases/dsh/<version>/ClawClaw-<version>-universal.dmg` and `ClawClaw-<version>-x64-Setup.exe` are counted.

| Metric | Definition |
| --- | --- |
| Valid requests | GET 200 / 206 |
| Estimated sessions | Same installer, IP and User-Agent; a new session starts after over 30 minutes since the last active valid request ended |
| Complete file sends | Normally completed 200 with body bytes equal to a positive Content-Length |
| Resume requests | GET 206; no completion inferred |
| Failures | GET 4xx / 5xx |
| Interrupted | GET 200 / 206 that did not finish normally |
| Traffic | Actual response body bytes for all GET requests to selected installers, including errors |

Sessions can cross midnight and belong to their start date; other facts use each request's start date. Overlapping requests use the latest end time for inactivity. HEAD, manifests, health checks, metadata and nonformal paths are excluded. Sessions are not people; complete sends are not installations or client-side verification. Shared IPs may merge users, changed IPs may split them, and unrecognized bots can be counted. Missing Content-Length conservatively prevents counting a complete send.

Publication verification adds `User-Agent: ClawClaw-Release-Verify/1` and `X-ClawClaw-Download-Purpose: deployment-verification`. These requests are recorded separately and excluded from user metrics. Markers are spoofable classification hints. Other traffic is unknown; website, shared links and client updates are not distinguished.

## Installation and access

Run from the local repository to upload, back up and verify automatically:

```sh
# Full collector, dashboard, Nginx and timer deployment/update
corepack pnpm deploy:stats
# Dashboard assets only
corepack pnpm deploy:stats --page-only
# Show target and file list without connecting
corepack pnpm deploy:stats --dry-run
```

Defaults to `root@192.168.103.220:22` using existing local SSH configuration/keys. It does not reuse the restricted `UPDATE_USER`, release key or release account known_hosts file. Optional ignored `.env.server.local` settings: `STATS_DEPLOY_HOST`, `STATS_DEPLOY_USER`, `STATS_DEPLOY_PORT`, `STATS_DEPLOY_SSH_KEY_FILE`, `STATS_DEPLOY_SSH_KNOWN_HOSTS_FILE`. Non-root administrators require passwordless sudo. Strict host-key verification remains enabled; manually verify unfamiliar host fingerprints first.

Full deployment first runs collector regression tests, dashboard JS and installer syntax checks, then verifies administrative access, uploads and installs. Page-only mode does not restart services. Both modes back up existing managed files to the printed server path `/etc/clawclaw/stats-deploy-backup.*/files.tgz`, verify page resources and JSON, and remove temporary uploads. Credentials are not uploaded; the private database and key are preserved. Failures exit nonzero; the installer automatically restores only Nginx configuration, while other files can be recovered from the backup if needed. Installer releases still use the separate `deploy:run` command.

The following is the direct server-side installer workflow, normally unnecessary.

Requirements: Linux, Python 3.9+ with sqlite3, Nginx, systemd and logrotate. SELinux also requires semanage. Run on the server from a source bundle containing the repository's `scripts/` and `deploy/`:

```sh
sudo bash deploy/download-stats/install.sh
```

The installer targets `/etc/nginx/conf.d/clawclaw.conf`, adds conditional logging while preserving ordinary access logs, and installs the log format, report listener, collector, timer and separate rotation retaining 30 daily rotations. Aggregation and `nginx -t` run before reload. Reinstallation preserves the database and key. The backup path is printed. On failure Nginx configuration is restored; programs and state remain for diagnosis.

Other environments using `deploy/clawclaw*.nginx.conf` must first install `deploy/download-stats/nginx-log.conf` in the http context and create the log directory. The report listens on the server LAN address `192.168.103.220:9529` and loopback `127.0.0.1:9529`, allowing only loopback and the company `192.168.0.0/16` network. Open [download statistics](http://192.168.103.220:9529/) from the company network without a local SSH tunnel. This is an internal HTTP aggregate report without login; do not map port 9529 to the public Internet. Update `nginx-report.conf` when changing server addresses or company networks. If a host firewall is enabled, allow port 9529 only from the actual company source networks.

The simplified Chinese dashboard shows estimated downloads, complete file sends, traffic and version/platform breakdowns, with today, last 7/30 days, custom dates, version/platform filters and CSV export. Detailed request metrics and deployment classifications remain in the underlying statistics without being expanded on the page. Loading failures and data over 5 minutes old are indicated. Zeroes do not establish collection health. The server aggregates every minute; the page polls every 30 seconds and refreshes when visible again. Results usually appear about 1–2 minutes after a download ends. Nginx logs requests when they end, so active transfers are not displayed yet.

## Storage and recovery

- `/var/log/clawclaw-downloads/downloads.jsonl*`: raw IP/User-Agent logs, accessible only to administrators, retained for 30 daily rotations. Ordinary Nginx logs retain their existing policy.
- `/var/lib/clawclaw-download-stats/private/`: mode 0700, SQLite request facts and cursors retained long term. IP/User-Agent are persisted only as a keyed HMAC of the combination, without raw values or query strings. This is de-identification, not anonymous user counting. Back up and restore the database with `ip-hmac.key`; an existing database with a missing key prevents regeneration.
- `/var/lib/clawclaw-download-stats/report/`: aggregates by day/version/platform/source and dashboard assets only.
- Events and offsets commit together. Nginx request IDs deduplicate repeated imports, rename rotation and gzip. Do not use copytruncate. Partial final lines wait until the next run; malformed complete lines are skipped and counted in the latest report and service output.
- Each run sorts facts chronologically and recalculates sessions, supporting late logs. This fits the current single server; larger scale requires partitioned aggregation. De-identified facts are retained long term; retention changes must account for deduplication and historical recalculation.
- Unimported logs beyond retention cannot be recovered. Existing ordinary access logs lack completion, IDs and source and are not mixed with this definition or used to invent historical totals. Collection start and first download day are shown. Cached downloads, offline copies and other servers cannot be observed.

```sh
systemctl status clawclaw-download-stats.timer
journalctl -u clawclaw-download-stats.service
systemctl start clawclaw-download-stats.service
curl --fail http://127.0.0.1:9529/stats.json
```

To disable, stop and disable the timer, restore backed-up `clawclaw.conf`, restore or remove the two added Nginx includes according to the backup, then run `nginx -t && systemctl reload nginx`. Keep logs and state until they are no longer needed.

Checks: `corepack pnpm test:download-stats` and `node --test scripts/wait-for-update.test.mjs`. Coverage includes complete sends, interruption, resumption, failures, verification exclusion, midnight, concurrency, late logs, rotation, repeated imports, partial lines and de-identified storage.
