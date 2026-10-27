#!/usr/bin/env python3
"""Incremental, headless Nginx download accounting. Python 3.9+, stdlib only."""
import argparse
import collections
import datetime as dt
import fcntl
import gzip
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import tempfile

ZONE = dt.timezone(dt.timedelta(hours=8))
ARTIFACT = re.compile(r'^/releases/dsh/(?P<version>\d+\.\d+\.\d+)/ClawClaw-(?P=version)-(?P<platform>universal\.dmg|x64-Setup\.exe)$')
METRICS = ('requests', 'sessions', 'complete', 'resumed', 'failed', 'interrupted', 'bytes')


def connect(path):
    db = sqlite3.connect(str(path))
    db.executescript('''
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY, start REAL NOT NULL, end REAL NOT NULL,
          day TEXT NOT NULL, version TEXT NOT NULL, platform TEXT NOT NULL,
          source TEXT NOT NULL, visitor TEXT NOT NULL, status INTEGER NOT NULL,
          bytes INTEGER NOT NULL, complete INTEGER NOT NULL, interrupted INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cursors (identity TEXT PRIMARY KEY, offset INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS event_session ON events(version, platform, source, visitor, start);
    ''')
    with db:
        db.execute('INSERT OR IGNORE INTO metadata VALUES (?,?)', ('collectionStartedAt', dt.datetime.now(ZONE).isoformat(timespec='seconds')))
    return db


def event(record, secret):
    """Return normalized facts only; never persist raw IP, user agent or query strings."""
    match = ARTIFACT.fullmatch(record.get('uri', ''))
    if not match or record.get('method') != 'GET':
        return None
    request_id = record['id']
    if not re.fullmatch(r'[a-f0-9]{32}', request_id):
        raise ValueError('invalid request id')
    end = dt.datetime.fromisoformat(record['time']).timestamp()
    duration = float(record['duration'])
    size, status = int(record['bytes']), int(record['status'])
    if not math.isfinite(duration) or not math.isfinite(end) or duration < 0 or size < 0 or not 100 <= status <= 599:
        raise ValueError('invalid request facts')
    start = end - duration
    day = dt.datetime.fromtimestamp(start, ZONE).date().isoformat()
    source = 'deployment' if record.get('purpose') == 'deployment-verification' or record.get('ua', '').startswith('ClawClaw-Release-Verify/') else 'unknown'
    visitor = hmac.new(secret, (record['ip'] + '\0' + record.get('ua', '')).encode(), hashlib.sha256).hexdigest()
    length = str(record.get('length', ''))
    complete = int(status == 200 and record.get('completion') == 'OK' and length.isdigit() and int(length) > 0 and size == int(length))
    interrupted = int(status in (200, 206) and record.get('completion') != 'OK')
    return (request_id, start, end, day, match['version'], 'macOS' if match['platform'] == 'universal.dmg' else 'Windows', source, visitor, status, size, complete, interrupted)


def ingest(db, paths, secret):
    """Commit events and offsets together. Request IDs also deduplicate compressed rotations."""
    inserted = invalid = 0
    for path in paths:
        opener = gzip.open if path.suffix == '.gz' else open
        with opener(path, 'rb') as stream:
            stat = path.stat()
            first = stream.readline()
            if not first.endswith(b'\n'):
                continue
            # First complete line disambiguates inode reuse and copy/truncate rotations.
            identity = '%s:%s:%s:%s' % (stat.st_dev, stat.st_ino, path.suffix == '.gz', hashlib.sha256(first).hexdigest())
            cursor = db.execute('SELECT offset FROM cursors WHERE identity=?', (identity,)).fetchone()
            offset = cursor[0] if cursor else 0
            if offset == -1:
                continue
            if path.suffix != '.gz' and offset > stat.st_size:
                offset = 0
            stream.seek(offset)
            with db:
                while True:
                    position = stream.tell()
                    line = stream.readline()
                    if not line or not line.endswith(b'\n'):
                        offset = -1 if not line and path.suffix == '.gz' else position
                        break
                    offset = stream.tell()
                    try:
                        facts = event(json.loads(line), secret)
                        if facts:
                            result = db.execute('INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', facts)
                            inserted += result.rowcount
                    except (ValueError, KeyError, TypeError, OverflowError, AttributeError):
                        invalid += 1
                db.execute('INSERT OR REPLACE INTO cursors VALUES (?,?)', (identity, offset))
    return {'inserted': inserted, 'invalid': invalid}


def report(db):
    rows = collections.defaultdict(lambda: dict.fromkeys(METRICS, 0))
    session = None
    last_end = 0
    earliest = None
    # Rebuild session boundaries from chronological facts, including late/rotated logs.
    query = 'SELECT start,end,day,version,platform,source,visitor,status,bytes,complete,interrupted FROM events ORDER BY version,platform,source,visitor,start,id'
    for start, end, day, version, platform, source, visitor, status, size, complete, interrupted in db.execute(query):
        earliest = day if earliest is None else min(earliest, day)
        item = rows[(day, version, platform, source)]
        item['bytes'] += size
        item['complete'] += complete
        item['interrupted'] += interrupted
        item['failed'] += int(status >= 400)
        if status not in (200, 206):
            continue
        item['requests'] += 1
        item['resumed'] += int(status == 206)
        key = (version, platform, source, visitor)
        if key != session or start - last_end > 1800:
            item['sessions'] += 1
            session, last_end = key, end
        else:
            last_end = max(last_end, end)
    return {
        'schema': 1, 'timezone': 'Asia/Shanghai',
        'generatedAt': dt.datetime.now(ZONE).isoformat(timespec='seconds'),
        'firstEventDay': earliest,
        'collectionStartedAt': db.execute('SELECT value FROM metadata WHERE name=?', ('collectionStartedAt',)).fetchone()[0],
        'rows': [dict(day=key[0], version=key[1], platform=key[2], source=key[3], **value) for key, value in sorted(rows.items())],
    }


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.stats-')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, allow_nan=False)
            stream.write('\n')
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--logs', type=Path, required=True)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    args.state.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.state / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        secret_path = args.state / 'ip-hmac.key'
        database_path = args.state / 'downloads.sqlite'
        if not secret_path.exists():
            if database_path.exists():
                raise RuntimeError('HMAC key missing; restore it with the database instead of changing visitor identities')
            secret_path.write_bytes(os.urandom(32))
        secret = secret_path.read_bytes()
        if len(secret) != 32:
            raise RuntimeError('invalid HMAC key')
        db = connect(database_path)
        try:
            paths = sorted(p for p in args.logs.glob('downloads.jsonl*') if p.is_file())
            summary = ingest(db, paths, secret)
            data = report(db)
            data['lastImport'] = summary
            atomic_json(args.output / 'stats.json', data)
            print(json.dumps(dict(summary, groups=len(data['rows']))))
        finally:
            db.close()


if __name__ == '__main__':
    main()
