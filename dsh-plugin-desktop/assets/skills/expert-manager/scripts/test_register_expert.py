#!/usr/bin/env python3
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import register_expert


class RegisterExpertTest(unittest.TestCase):
    def setUp(self):
        self.original_session_env = os.environ.get(register_expert.SESSION_ID_ENV_VAR)
        self.original_runtime_session_env = os.environ.get(register_expert.RUNTIME_SESSION_ID_ENV_VAR)
        os.environ.pop(register_expert.SESSION_ID_ENV_VAR, None)
        os.environ.pop(register_expert.RUNTIME_SESSION_ID_ENV_VAR, None)

    def tearDown(self):
        if self.original_session_env is None:
            os.environ.pop(register_expert.SESSION_ID_ENV_VAR, None)
        else:
            os.environ[register_expert.SESSION_ID_ENV_VAR] = self.original_session_env
        if self.original_runtime_session_env is None:
            os.environ.pop(register_expert.RUNTIME_SESSION_ID_ENV_VAR, None)
        else:
            os.environ[register_expert.RUNTIME_SESSION_ID_ENV_VAR] = self.original_runtime_session_env

    @staticmethod
    def create_expert_dir(root: Path, name: str = 'test-designer') -> Path:
        expert_dir = root / 'plugins' / name
        (expert_dir / '.clawclaw-plugin').mkdir(parents=True)
        (expert_dir / 'agents').mkdir()
        (expert_dir / '.clawclaw-plugin' / 'plugin.json').write_text(json.dumps({
            'name': name,
            'description': 'Test designer expert',
            'expertType': 'agent',
            'profession': {'zh': '测试专家', 'en': 'Test Designer'},
            'avatar': 0,
        }), encoding='utf-8')
        (expert_dir / 'agents' / f'{name}.md').write_text('You are a test designer.', encoding='utf-8')
        return expert_dir

    def test_register_uses_clawclaw_session_id_env_when_arg_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            marketplace_dir = Path(tmp)
            expert_dir = self.create_expert_dir(marketplace_dir)

            self.assertTrue(register_expert.register_expert(
                expert_dir,
                marketplace_dir,
                register_expert.get_session_id(None),
            ))
            self.assertFalse((expert_dir / '.created-by-session').exists())

            os.environ['CLAWCLAW_SESSION_ID'] = 'session-from-env'

            self.assertTrue(register_expert.register_expert(
                expert_dir,
                marketplace_dir,
                register_expert.get_session_id(None),
            ))
            self.assertEqual((expert_dir / '.created-by-session').read_text(encoding='utf-8'), 'session-from-env')

    def test_explicit_session_id_overrides_env(self):
        os.environ['CLAWCLAW_SESSION_ID'] = 'session-from-env'

        self.assertEqual(register_expert.get_session_id(' explicit-session '), 'explicit-session')

    def test_uses_dsh_runtime_session_id(self):
        os.environ[register_expert.RUNTIME_SESSION_ID_ENV_VAR] = 'runtime-session'

        self.assertEqual(register_expert.get_session_id(None), 'runtime-session')

    def test_clawclaw_session_id_overrides_runtime_fallback(self):
        os.environ[register_expert.SESSION_ID_ENV_VAR] = 'clawclaw-session'
        os.environ[register_expert.RUNTIME_SESSION_ID_ENV_VAR] = 'runtime-session'

        self.assertEqual(register_expert.get_session_id(None), 'clawclaw-session')

    def test_unexpanded_session_id_falls_back_to_env(self):
        os.environ['CLAWCLAW_SESSION_ID'] = 'session-from-env'

        self.assertEqual(register_expert.get_session_id('${CLAWCLAW_SESSION_ID}'), 'session-from-env')
        self.assertEqual(register_expert.get_session_id('$CLAWCLAW_SESSION_ID'), 'session-from-env')

    def test_blank_session_id_falls_back_to_env(self):
        os.environ['CLAWCLAW_SESSION_ID'] = 'session-from-env'

        self.assertEqual(register_expert.get_session_id('   '), 'session-from-env')

    def test_completeness_accepts_preset_avatar(self):
        with tempfile.TemporaryDirectory() as tmp:
            expert_dir = self.create_expert_dir(Path(tmp))
            valid, errors = register_expert.validate_expert_completeness(expert_dir)

            self.assertTrue(valid, errors)

    def test_completeness_rejects_path_and_out_of_range_avatar(self):
        for avatar in ('avatars/expert.png', 36, -1, True):
            with self.subTest(avatar=avatar), tempfile.TemporaryDirectory() as tmp:
                expert_dir = self.create_expert_dir(Path(tmp))
                manifest_path = expert_dir / '.clawclaw-plugin' / 'plugin.json'
                manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
                manifest['avatar'] = avatar
                manifest_path.write_text(json.dumps(manifest), encoding='utf-8')

                valid, errors = register_expert.validate_expert_completeness(expert_dir)

                self.assertFalse(valid)
                self.assertIn('avatar must be an integer from 0 to 35', errors)

    def test_completeness_validates_team_member_names_and_avatars(self):
        with tempfile.TemporaryDirectory() as tmp:
            expert_dir = self.create_expert_dir(Path(tmp))
            manifest_path = expert_dir / '.clawclaw-plugin' / 'plugin.json'
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            manifest.update({
                'expertType': 'team',
                'members': [
                    {'id': 'lead', 'profession': {'zh': '负责人'}, 'avatar': 7},
                    {'id': 'member', 'profession': {}, 'avatar': 'avatars/member.png'},
                ],
            })
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')

            valid, errors = register_expert.validate_expert_completeness(expert_dir)

            self.assertFalse(valid)
            self.assertIn('members[1].profession (zh or en) is missing or contains [TODO]', errors)
            self.assertIn('members[1].avatar must be an integer from 0 to 35', errors)


if __name__ == '__main__':
    unittest.main()
