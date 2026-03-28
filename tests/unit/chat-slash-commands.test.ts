import { describe, expect, it } from 'vitest';
import {
  getSlashArgumentCompletions,
  getSlashCommandCompletions,
  parseSlashCommand,
  SLASH_COMMANDS,
} from '@/pages/Chat/slash-commands';

describe('chat slash commands', () => {
  it('parses colon-delimited commands', () => {
    expect(parseSlashCommand('/think: high')).toMatchObject({
      command: { name: 'think' },
      args: 'high',
    });
  });

  it('parses alias commands from the generated OpenClaw catalog', () => {
    expect(parseSlashCommand('/export')).toMatchObject({
      command: { key: 'export-session' },
      args: '',
    });
    expect(parseSlashCommand('/t')).toMatchObject({
      command: { key: 'think' },
      args: '',
    });
  });

  it('exposes generated OpenClaw command completions', () => {
    const commands = getSlashCommandCompletions('comp');
    expect(commands[0]).toMatchObject({
      key: 'compact',
      name: 'compact',
    });
    expect(SLASH_COMMANDS.some((command) => command.key === 'bash')).toBe(true);
  });

  it('returns argument completions for commands with fixed options', () => {
    expect(getSlashArgumentCompletions('/tools c')).toMatchObject({
      command: { key: 'tools' },
      options: ['compact'],
    });
  });
});
