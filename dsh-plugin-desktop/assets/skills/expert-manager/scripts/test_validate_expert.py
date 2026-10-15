#!/usr/bin/env python3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import validate_expert


class ValidateExpertConnectorTest(unittest.TestCase):
    @staticmethod
    def manifest(connectors):
        localized = {'en': 'Value', 'zh': '值'}
        return {
            'name': 'test-expert', 'version': '1.0.0', 'description': 'Test',
            'expertType': 'agent', 'agentName': 'test-expert',
            'agents': ['./agents/test-expert.md'],
            'profession': localized,
            'displayDescription': localized, 'defaultInitPrompt': localized,
            'avatar': 0, 'categoryId': '02-Engineering',
            'tags': [localized, localized, localized],
            'quickPrompts': [localized, localized, localized],
            'dependencies': {'connectors': connectors},
        }

    def validate(self, connectors, mutate=None):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'agents').mkdir()
            (root / 'agents' / 'test-expert.md').write_text('---\nname: test-expert\ndescription: Test\n---\n', encoding='utf-8')
            result = validate_expert.ValidationResult()
            manifest = self.manifest(connectors)
            if mutate is not None:
                mutate(manifest)
            validate_expert.validate_plugin_json(manifest, root, result)
            return result

    def test_accepts_unique_catalog_connector_ids(self):
        result = self.validate(['github', 'world-bank-data360'])
        self.assertFalse(any('Connector ID' in error for error in result.errors))

    def test_rejects_invalid_or_duplicate_connector_ids(self):
        result = self.validate(['github', 'github', '../outside'])
        self.assertTrue(any('duplicate Connector ID' in error for error in result.errors))
        self.assertTrue(any('invalid Connector ID' in error for error in result.errors))

    def test_accepts_preset_avatar_index(self):
        result = self.validate([], lambda manifest: manifest.update(avatar=35))
        self.assertFalse(any("'avatar'" in error for error in result.errors))

    def test_rejects_avatar_path_and_out_of_range_index(self):
        for avatar in ('avatars/expert.png', -1, 36, True):
            with self.subTest(avatar=avatar):
                result = self.validate([], lambda manifest, avatar=avatar: manifest.update(avatar=avatar))
                self.assertTrue(any("'avatar' must be an integer from 0 to 35" in error for error in result.errors))

    def test_rejects_missing_or_invalid_team_member_avatar(self):
        def make_team(manifest):
            manifest.update({
                'expertType': 'team',
                'members': [
                    {'id': 'test-expert', 'profession': {'zh': '负责人'}, 'role': 'lead', 'avatar': 4},
                    {'id': 'member', 'profession': {'zh': '成员'}, 'role': 'member'},
                    {'id': 'member-two', 'profession': {'zh': '成员二'}, 'role': 'member', 'avatar': 40},
                ],
            })

        result = self.validate([], make_team)
        self.assertTrue(any('members[1].avatar must be an integer from 0 to 35' in error for error in result.errors))
        self.assertTrue(any('members[2].avatar must be an integer from 0 to 35' in error for error in result.errors))


if __name__ == '__main__':
    unittest.main()
