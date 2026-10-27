"""Accounting regression tests; no server, third-party packages or GUI required."""
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('stats', Path(__file__).with_name('download-stats.py'))
stats = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stats)


def record(number, **changes):
    return dict(id='%032x' % number, time='2026-10-27T00:00:00+08:00', duration='0',
                ip='192.0.2.1', ua='Browser', method='GET',
                uri='/releases/dsh/0.2.15/ClawClaw-0.2.15-universal.dmg',
                status='200', bytes='100', length='100', completion='OK', **changes)


class Accounting(unittest.TestCase):
    def test_accounting_import_without_posix_file_locking(self):
        isolated = importlib.util.module_from_spec(spec)
        # Match Windows, where importing fcntl raises ModuleNotFoundError.
        with mock.patch.dict('sys.modules', {'fcntl': None}):
            spec.loader.exec_module(isolated)
            db = isolated.connect(':memory:')
            try:
                self.assertEqual(isolated.report(db)['rows'], [])
            finally:
                db.close()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.log = self.root / 'downloads.jsonl'
        self.db = stats.connect(self.root / 'db')
        self.secret = b'k' * 32

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def ingest(self, records):
        with self.log.open('a') as stream:
            for value in records:
                stream.write(json.dumps(value) + '\n')
        return stats.ingest(self.db, [self.log], self.secret)

    def totals(self, source='unknown'):
        result = dict.fromkeys(stats.METRICS, 0)
        for row in stats.report(self.db)['rows']:
            if row['source'] == source:
                for key in result:
                    result[key] += row[key]
        return result

    def test_complete_abort_resume_and_failures(self):
        values = [record(1), record(2), record(3), record(4)]
        values[1].update(bytes='20', completion='')
        values[2].update(status='206', bytes='80', length='80')
        values[3].update(status='404', bytes='12')
        self.ingest(values)
        self.assertEqual(self.totals(), dict(requests=3, sessions=1, complete=1, resumed=1, failed=1, interrupted=1, bytes=212))

    def test_head_metadata_trial_and_verification(self):
        values = [record(i) for i in range(1, 7)]
        values[0]['method'] = 'HEAD'
        values[1]['uri'] = '/updates/dsh/stable/release.json'
        values[2]['uri'] = '/releases/dsh/trials/42/test.dmg'
        values[3]['purpose'] = 'deployment-verification'
        values[4]['ua'] = 'ClawClaw-Release-Verify/1'
        values[5]['uri'] = '/releases/dsh/0.2.15/ClawClaw-0.2.14-universal.dmg'
        self.ingest(values)
        self.assertEqual(self.totals()['requests'], 0)
        self.assertEqual(self.totals('deployment')['requests'], 2)

    def test_cross_midnight_late_logs_and_30_minute_inactivity(self):
        first, second, third = record(1), record(2), record(3)
        first['time'] = '2026-10-26T23:50:00+08:00'
        second['time'] = '2026-10-27T00:10:00+08:00'
        third['time'] = '2026-10-27T00:41:00+08:00'
        self.ingest([third, second, first])
        self.assertEqual(self.totals()['sessions'], 2)
        self.assertEqual([row['sessions'] for row in stats.report(self.db)['rows']], [1, 1])

    def test_long_running_and_overlapping_requests(self):
        first, second, third = record(1), record(2), record(3)
        first.update(time='2026-10-27T01:00:00+08:00', duration='3600')
        second.update(time='2026-10-27T00:10:00+08:00')
        third.update(time='2026-10-27T01:29:00+08:00')
        self.ingest([first, second, third])
        self.assertEqual(self.totals()['sessions'], 1)

    def test_rotation_compression_reimport_and_partial_line(self):
        self.ingest([record(1)])
        rotated = self.root / 'downloads.jsonl.1'
        self.log.rename(rotated)
        self.ingest([record(2)])
        with gzip.open(self.root / 'downloads.jsonl.2.gz', 'wb') as stream:
            stream.write(rotated.read_bytes())
        rotated.unlink()
        paths = sorted(self.root.glob('downloads.jsonl*'))
        self.assertEqual(stats.ingest(self.db, paths, self.secret)['inserted'], 0)
        with self.log.open('ab') as stream:
            stream.write(json.dumps(record(3)).encode())
        self.assertEqual(stats.ingest(self.db, paths, self.secret)['inserted'], 0)
        with self.log.open('ab') as stream:
            stream.write(b'\n')
        self.assertEqual(stats.ingest(self.db, paths, self.secret)['inserted'], 1)
        self.assertEqual(self.totals()['requests'], 3)

    def test_malformed_skipped_and_ip_and_ua_not_persisted(self):
        self.log.write_text('{bad}\n' + json.dumps(record(1)) + '\n')
        self.assertEqual(stats.ingest(self.db, [self.log], self.secret)['invalid'], 1)
        self.assertEqual(self.totals()['requests'], 1)
        self.db.commit()
        data = (self.root / 'db').read_bytes()
        self.assertNotIn(b'192.0.2.1', data)
        self.assertNotIn(b'Browser', data)

    def test_http2_without_declared_length_is_not_claimed_complete(self):
        value = record(1)
        value['length'] = ''
        self.ingest([value])
        self.assertEqual(self.totals()['complete'], 0)

    def test_different_visitors_files_and_sources_are_separate(self):
        values = [record(i) for i in range(1, 6)]
        values[1]['ip'] = '192.0.2.2'
        values[2]['ua'] = 'Other browser'
        values[3]['uri'] = '/releases/dsh/0.2.15/ClawClaw-0.2.15-x64-Setup.exe'
        values[4]['purpose'] = 'deployment-verification'
        self.ingest(values)
        self.assertEqual(self.totals()['sessions'], 4)
        self.assertEqual(self.totals('deployment')['sessions'], 1)

    def test_incomplete_first_line_and_copy_truncate_do_not_lose_data(self):
        self.log.write_text(json.dumps(record(1)))
        self.assertEqual(stats.ingest(self.db, [self.log], self.secret)['inserted'], 0)
        with self.log.open('a') as stream:
            stream.write('\n')
        self.assertEqual(stats.ingest(self.db, [self.log], self.secret)['inserted'], 1)
        self.log.write_text(json.dumps(record(2)) + '\n')
        self.assertEqual(stats.ingest(self.db, [self.log], self.secret)['inserted'], 1)

    def test_no_premature_complete_send_for_wrong_length_and_nan_rejected(self):
        values = [record(1), record(2), record(3)]
        values[0]['length'] = '101'
        values[1]['duration'] = 'nan'
        values[2]['duration'] = '-1'
        self.assertEqual(self.ingest(values)['invalid'], 2)
        self.assertEqual(self.totals()['complete'], 0)


if __name__ == '__main__':
    unittest.main()
