#!/usr/bin/env python3
"""
Expert Validator - Validates an expert package against the ClawClaw specification.

Usage:
    validate_expert.py <path/to/expert-dir>

Example:
    python3 validate_expert.py plugins/my-expert
"""

import sys
import json
import os
import re
from pathlib import Path


VALID_CATEGORY_IDS = {
    '01-ProductDesign', '02-Engineering', '03-GameSpatial', '04-DataAI',
    '05-MarketingGrowth', '06-ContentCreative', '07-SalesCommerce',
    '08-FinanceInvestment', '09-OperationsHR', '10-ProjectQuality',
    '11-SecurityCompliance', '12-IndustryConsultant',
}

VALID_EXPERT_TYPES = {'agent', 'team'}


class ValidationResult:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)

    @property
    def is_valid(self):
        return len(self.errors) == 0

    def summary(self):
        lines = []
        if self.errors:
            lines.append(f"❌ {len(self.errors)} error(s):")
            for e in self.errors:
                lines.append(f"   • {e}")
        if self.warnings:
            lines.append(f"⚠️  {len(self.warnings)} warning(s):")
            for w in self.warnings:
                lines.append(f"   • {w}")
        if self.is_valid:
            lines.append("✅ Expert package is valid!")
        return '\n'.join(lines)


def parse_md_frontmatter(md_path):
    """Parse YAML frontmatter from a Markdown file. Returns dict or None."""
    try:
        content = md_path.read_text(encoding='utf-8')
    except Exception as e:
        return None, f"Cannot read {md_path}: {e}"

    if not content.startswith('---'):
        return None, f"{md_path.name}: No YAML frontmatter found"

    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return None, f"{md_path.name}: Invalid frontmatter format"

    # LIMITATION: Only parses simple top-level "key: value" pairs.
    # Does NOT handle nested objects, lists, or multi-line values.
    # Sufficient for extracting 'name', 'description', and detecting 'tools'.
    fm_text = match.group(1)
    result = {}

    # Extract simple key-value pairs
    for line in fm_text.split('\n'):
        line = line.strip()
        if ':' in line and not line.startswith('-') and not line.startswith('#'):
            key, _, value = line.partition(':')
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if value:
                result[key] = value

    return result, None


def check_i18n_field(obj, field_name, result, context="plugin.json"):
    """Check that a field has both 'en' and 'zh' values."""
    if field_name not in obj:
        result.error(f"{context}: missing '{field_name}'")
        return False

    val = obj[field_name]
    if not isinstance(val, dict):
        result.error(f"{context}: '{field_name}' must be an object with 'en' and 'zh'")
        return False

    if not val.get('en'):
        result.error(f"{context}: '{field_name}.en' is empty")
    if not val.get('zh'):
        result.error(f"{context}: '{field_name}.zh' is empty")

    return True


def validate_plugin_json(plugin_json, expert_dir, result):
    """Validate plugin.json fields."""
    # Required fields
    for field in ('name', 'version', 'description'):
        if field not in plugin_json:
            result.error(f"plugin.json: missing required field '{field}'")

    name = plugin_json.get('name', '')
    if name and (len(name) < 2 or not re.match(r'^[a-z0-9][a-z0-9-]*[a-z0-9]$', name)):
        result.error(f"plugin.json: 'name' must be kebab-case (at least 2 chars), got '{name}'")

    expert_type = plugin_json.get('expertType', '')
    if expert_type not in VALID_EXPERT_TYPES:
        result.error(f"plugin.json: 'expertType' must be one of {VALID_EXPERT_TYPES}, got '{expert_type}'")
        return expert_type

    # plugin field consistency
    plugin_field = plugin_json.get('plugin', '')
    if plugin_field and plugin_field != name:
        result.error(f"plugin.json: 'plugin' ({plugin_field}) must equal 'name' ({name})")

    # Agent/Team specific
    if expert_type in ('agent', 'team'):
        agent_name = plugin_json.get('agentName', '')
        if not agent_name:
            result.error("plugin.json: missing 'agentName'")
        else:
            # Check agentName matches an MD file
            md_file = expert_dir / 'agents' / f'{agent_name}.md'
            if not md_file.exists():
                result.error(f"plugin.json: agentName '{agent_name}' has no matching file agents/{agent_name}.md")

            # agentName must not be generic "team-lead"
            if agent_name == 'team-lead':
                result.error("plugin.json: agentName must not be generic 'team-lead', add team prefix")

        # Display fields
        check_i18n_field(plugin_json, 'profession', result)
        check_i18n_field(plugin_json, 'displayDescription', result)
        check_i18n_field(plugin_json, 'defaultInitPrompt', result)

        # displayDescription zh length
        dd = plugin_json.get('displayDescription', {})
        zh_desc = dd.get('zh', '')
        if zh_desc and not zh_desc.startswith('[TODO'):
            zh_len = len(zh_desc)
            if zh_len < 40 or zh_len > 50:
                result.warn(f"plugin.json: displayDescription.zh is {zh_len} chars (recommended 40-50)")

        # categoryId
        cat = plugin_json.get('categoryId', '')
        if cat and not cat.startswith('[TODO') and cat not in VALID_CATEGORY_IDS:
            result.error(f"plugin.json: invalid categoryId '{cat}'")

        # tags (must be 3)
        tags = plugin_json.get('tags', [])
        if isinstance(tags, list) and len(tags) != 3:
            result.error(f"plugin.json: must have exactly 3 tags, got {len(tags)}")

        # quickPrompts (must be 3)
        qp = plugin_json.get('quickPrompts', [])
        if isinstance(qp, list) and len(qp) != 3:
            result.error(f"plugin.json: must have exactly 3 quickPrompts, got {len(qp)}")

        # defaultInitPrompt == quickPrompts[0]
        dip = plugin_json.get('defaultInitPrompt', {})
        if isinstance(qp, list) and len(qp) > 0 and isinstance(qp[0], dict):
            if dip.get('zh') and qp[0].get('zh') and dip['zh'] != qp[0]['zh']:
                if not dip['zh'].startswith('[TODO'):
                    result.warn("plugin.json: defaultInitPrompt.zh should match quickPrompts[0].zh")

        # ClawClaw preset avatar index, shared with the manual expert editor.
        avatar = plugin_json.get('avatar')
        if not isinstance(avatar, int) or isinstance(avatar, bool) or not 0 <= avatar <= 35:
            result.error("plugin.json: 'avatar' must be an integer from 0 to 35")

        if expert_type == 'team':
            for index, member in enumerate(plugin_json.get('members', [])):
                if not isinstance(member, dict):
                    result.error(f"plugin.json: members[{index}] must be an object")
                    continue
                check_i18n_field(member, 'profession', result, f"plugin.json members[{index}]")
                member_avatar = member.get('avatar')
                if not isinstance(member_avatar, int) or isinstance(member_avatar, bool) or not 0 <= member_avatar <= 35:
                    result.error(f"plugin.json: members[{index}].avatar must be an integer from 0 to 35")

    # agents array check
    agents_arr = plugin_json.get('agents', [])
    if isinstance(agents_arr, list):
        for agent_path in agents_arr:
            rel = agent_path[2:] if agent_path.startswith('./') else agent_path
            resolved = expert_dir / rel
            if not resolved.exists() and not agent_path.startswith('[TODO'):
                result.error(f"plugin.json: agents path not found: {agent_path}")

    # skills array check
    skills_arr = plugin_json.get('skills', [])
    if isinstance(skills_arr, list):
        for skill_path in skills_arr:
            rel = skill_path[2:] if skill_path.startswith('./') else skill_path
            resolved = expert_dir / rel
            skill_md = resolved / 'SKILL.md'
            if not skill_md.exists() and not skill_path.startswith('[TODO'):
                result.error(f"plugin.json: skill path has no SKILL.md: {skill_path}")

    # Connector dependencies use catalog IDs and are resolved to installed
    # MCP server names by the ClawClaw Host at runtime.
    dependencies = plugin_json.get('dependencies', {})
    if not isinstance(dependencies, dict):
        result.error("plugin.json: 'dependencies' must be an object")
    else:
        connectors = dependencies.get('connectors', [])
        if not isinstance(connectors, list):
            result.error("plugin.json: 'dependencies.connectors' must be an array")
        else:
            seen_connectors = set()
            for connector in connectors:
                if not isinstance(connector, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', connector):
                    result.error(f"plugin.json: invalid Connector ID '{connector}'")
                elif connector in seen_connectors:
                    result.error(f"plugin.json: duplicate Connector ID '{connector}'")
                else:
                    seen_connectors.add(connector)

    # Team specific
    if expert_type == 'team':
        team_info = plugin_json.get('teamInfo', {})
        if not team_info:
            result.error("plugin.json: Team type must have 'teamInfo'")
        else:
            lead = team_info.get('leadAgent', '')
            members_agents = team_info.get('memberAgents', [])
            if lead and lead in members_agents:
                result.error("plugin.json: teamInfo.memberAgents should NOT contain the lead agent")

        members = plugin_json.get('members', [])
        if not members:
            result.error("plugin.json: Team type must have 'members' array")
        else:
            has_lead = any(m.get('role') == 'lead' for m in members if isinstance(m, dict))
            if not has_lead:
                result.error("plugin.json: members array must contain at least one member with role='lead'")

        # settings.json
        settings_path = expert_dir / 'settings.json'
        if not settings_path.exists():
            result.error("Team type must have settings.json")
        else:
            try:
                settings = json.loads(settings_path.read_text(encoding='utf-8'))
                settings_agent = settings.get('agent', '')
                pj_agent = plugin_json.get('agentName', '')
                if settings_agent and pj_agent and settings_agent != pj_agent:
                    result.error(f"settings.json 'agent' ({settings_agent}) != plugin.json 'agentName' ({pj_agent})")
            except json.JSONDecodeError as e:
                result.error(f"settings.json: invalid JSON: {e}")

    return expert_type


def validate_agent_mds(expert_dir, plugin_json, result):
    """Validate all Agent MD files."""
    agents_dir = expert_dir / 'agents'
    if not agents_dir.exists():
        result.error("agents/ directory not found")
        return

    for md_file in agents_dir.glob('*.md'):
        fm, err = parse_md_frontmatter(md_file)
        if err:
            result.error(err)
            continue

        if not fm:
            result.error(f"{md_file.name}: empty frontmatter")
            continue

        # name must match filename
        fm_name = fm.get('name', '')
        expected_name = md_file.stem
        if fm_name and fm_name != expected_name:
            result.error(f"{md_file.name}: frontmatter name '{fm_name}' != filename '{expected_name}'")

        # Must have description
        if not fm.get('description'):
            result.warn(f"{md_file.name}: missing 'description' in frontmatter")

        # Must NOT have tools field
        content = md_file.read_text(encoding='utf-8')
        fm_section = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
        if fm_section and 'tools:' in fm_section.group(1):
            result.error(f"{md_file.name}: frontmatter must NOT contain 'tools' field")


def validate_file_structure(expert_dir, expert_type, result):
    """Validate basic file structure."""
    # .clawclaw-plugin/plugin.json must exist
    pj = expert_dir / '.clawclaw-plugin' / 'plugin.json'
    if not pj.exists():
        result.error(".clawclaw-plugin/plugin.json not found")

    # Must NOT have hooks/, commands/, .lsp.json
    for forbidden in ('hooks', 'commands'):
        if (expert_dir / forbidden).exists():
            result.error(f"Forbidden directory found: {forbidden}/")
    if (expert_dir / '.lsp.json').exists():
        result.error("Forbidden file found: .lsp.json")

    # agents/, skills/, bin/ must be at root, not inside .clawclaw-plugin/
    manifest_dir = expert_dir / '.clawclaw-plugin'
    for subdir in ('agents', 'skills', 'bin', 'avatars'):
        if (manifest_dir / subdir).exists():
            result.error(f"{subdir}/ found inside .clawclaw-plugin/ — must be at plugin root")

    # Must have agents/ dir
    if not (expert_dir / 'agents').exists():
        result.error(f"{expert_type} type must have agents/ directory")

    # README.md recommended
    if not (expert_dir / 'README.md').exists():
        result.warn("README.md is recommended")


def validate_expert(expert_path):
    """Main validation entry point."""
    expert_dir = Path(expert_path).resolve()
    result = ValidationResult()

    if not expert_dir.exists():
        result.error(f"Directory not found: {expert_dir}")
        return result

    if not expert_dir.is_dir():
        result.error(f"Not a directory: {expert_dir}")
        return result

    # Check if expert is in the default install path
    config_dir = os.environ.get('DSH_HOME', '').strip() or str(Path.home() / '.clawclaw' / 'data')
    default_plugins_dir = Path(config_dir) / 'plugins' / 'marketplaces' / 'my-experts' / 'plugins'
    try:
        expert_dir.relative_to(default_plugins_dir.resolve())
    except ValueError:
        result.error(
            f"专家不在专家目录下，将无法被检测到。"
            f" 专家目录: {default_plugins_dir}"
        )

    # Load plugin.json
    pj_path = expert_dir / '.clawclaw-plugin' / 'plugin.json'
    if not pj_path.exists():
        result.error(".clawclaw-plugin/plugin.json not found")
        return result

    try:
        plugin_json = json.loads(pj_path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        result.error(f"plugin.json: invalid JSON: {e}")
        return result

    # Validate plugin.json
    expert_type = validate_plugin_json(plugin_json, expert_dir, result)

    # Validate file structure
    validate_file_structure(expert_dir, expert_type, result)

    # Validate Agent MDs
    validate_agent_mds(expert_dir, plugin_json, result)

    return result


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 validate_expert.py <path/to/expert-dir>")
        print("\nExample:")
        print("  python3 validate_expert.py plugins/my-expert")
        sys.exit(1)

    expert_path = sys.argv[1]
    print(f"🔍 Validating expert package: {expert_path}\n")

    result = validate_expert(expert_path)
    print(result.summary())

    sys.exit(0 if result.is_valid else 1)


if __name__ == "__main__":
    main()
