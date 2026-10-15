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
            'displayName': localized, 'profession': localized,
            'displayDescription': localized, 'defaultInitPrompt': localized,
            'avatar': 'avatars/expert.png', 'categoryId': '02-Engineering',
            'tags': [localized, localized, localized],
            'quickPrompts': [localized, localized, localized],
            'dependencies': {'connectors': connectors},
        }

    def validate(self, connectors):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'agents').mkdir()
            (root / 'agents' / 'test-expert.md').write_text('---\nname: test-expert\ndescription: Test\n---\n', encoding='utf-8')
            result = validate_expert.ValidationResult()
            validate_expert.validate_plugin_json(self.manifest(connectors), root, result)
            return result

    def test_accepts_unique_catalog_connector_ids(self):
        result = self.validate(['github', 'world-bank-data360'])
        self.assertFalse(any('Connector ID' in error for error in result.errors))

    def test_rejects_invalid_or_duplicate_connector_ids(self):
        result = self.validate(['github', 'github', '../outside'])
        self.assertTrue(any('duplicate Connector ID' in error for error in result.errors))
        self.assertTrue(any('invalid Connector ID' in error for error in result.errors))


if __name__ == '__main__':
    unittest.main()
