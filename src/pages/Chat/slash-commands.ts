import {
  GENERATED_OPENCLAW_CHAT_COMMANDS,
  type GeneratedOpenClawArgChoice,
  type GeneratedOpenClawArgDefinition,
} from './openclaw-command-catalog.generated';

export type SlashCommandCategory =
  | 'session'
  | 'options'
  | 'status'
  | 'management'
  | 'media'
  | 'tools'
  | 'docks';

export type SlashCommandDef = {
  key: string;
  name: string;
  aliases: string[];
  description: string;
  category: SlashCommandCategory;
  acceptsArgs: boolean;
  args?: string;
  argOptions?: string[];
};

function getPrimarySlashName(aliases: string[]): string | null {
  const primary = aliases.find((alias) => alias.startsWith('/'));
  return primary ? primary.slice(1) : null;
}

function getAliases(aliases: string[], primary: string): string[] {
  return aliases
    .filter((alias) => alias.startsWith('/'))
    .map((alias) => alias.slice(1))
    .filter((alias) => alias && alias !== primary);
}

function formatArgs(args?: GeneratedOpenClawArgDefinition[]): string | undefined {
  if (!args?.length) return undefined;
  return args
    .map((arg) => {
      const token = `<${arg.name}>`;
      return arg.required ? token : `[${arg.name}]`;
    })
    .join(' ');
}

function choiceToString(choice: GeneratedOpenClawArgChoice): string | null {
  if (typeof choice === 'string') {
    return choice;
  }
  if (choice && typeof choice === 'object' && typeof choice.value === 'string') {
    return choice.value;
  }
  return null;
}

function getArgOptions(args?: GeneratedOpenClawArgDefinition[]): string[] | undefined {
  const firstArg = args?.[0];
  if (!firstArg?.choices?.length) return undefined;
  const options = firstArg.choices.map(choiceToString).filter((value): value is string => Boolean(value));
  return options.length > 0 ? options : undefined;
}

export const CATEGORY_LABELS: Record<SlashCommandCategory, string> = {
  session: 'Session',
  options: 'Options',
  status: 'Status',
  management: 'Management',
  media: 'Media',
  tools: 'Tools',
  docks: 'Docks',
};

export const CATEGORY_I18N_KEYS: Record<SlashCommandCategory, string> = {
  session: 'slash.categories.session',
  options: 'slash.categories.options',
  status: 'slash.categories.status',
  management: 'slash.categories.management',
  media: 'slash.categories.media',
  tools: 'slash.categories.tools',
  docks: 'slash.categories.docks',
};

const CATEGORY_ORDER: SlashCommandCategory[] = [
  'session',
  'options',
  'status',
  'management',
  'media',
  'tools',
  'docks',
];

export const SLASH_COMMANDS: SlashCommandDef[] = GENERATED_OPENCLAW_CHAT_COMMANDS.reduce<SlashCommandDef[]>(
  (acc, command) => {
    const primary = getPrimarySlashName(command.textAliases);
    if (!primary) return acc;

    acc.push({
      key: command.key,
      name: primary,
      aliases: getAliases(command.textAliases, primary),
      description: command.description,
      category: (command.category as SlashCommandCategory | undefined) ?? 'tools',
      acceptsArgs: Boolean(command.acceptsArgs),
      args: formatArgs(command.args),
      argOptions: getArgOptions(command.args),
    });
    return acc;
  },
  [],
);

export function getSlashCommandCompletions(filter: string): SlashCommandDef[] {
  const lower = filter.trim().toLowerCase();
  const commands = lower
    ? SLASH_COMMANDS.filter((command) =>
        command.name.startsWith(lower)
        || command.aliases.some((alias) => alias.startsWith(lower))
        || command.description.toLowerCase().includes(lower))
    : SLASH_COMMANDS;

  return [...commands].sort((left, right) => {
    const categoryDiff = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
    if (categoryDiff !== 0) return categoryDiff;

    const leftPrefix = left.name.startsWith(lower) ? 0 : 1;
    const rightPrefix = right.name.startsWith(lower) ? 0 : 1;
    if (leftPrefix !== rightPrefix) return leftPrefix - rightPrefix;

    return left.name.localeCompare(right.name);
  });
}

export type ParsedSlashCommand = {
  command: SlashCommandDef;
  args: string;
};

export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const body = trimmed.slice(1);
  const firstSeparator = body.search(/[\s:]/u);
  const name = firstSeparator === -1 ? body : body.slice(0, firstSeparator);
  let remainder = firstSeparator === -1 ? '' : body.slice(firstSeparator).trimStart();
  if (remainder.startsWith(':')) {
    remainder = remainder.slice(1).trimStart();
  }
  const args = remainder.trim();

  if (!name) return null;

  const normalizedName = name.toLowerCase();
  const command = SLASH_COMMANDS.find(
    (entry) => entry.name === normalizedName || entry.aliases.some((alias) => alias === normalizedName),
  );
  if (!command) return null;

  return { command, args };
}

export function getSlashArgumentCompletions(text: string): {
  command: SlashCommandDef;
  prefix: string;
  options: string[];
} | null {
  const trimmed = text.trimStart();
  const match = trimmed.match(/^\/([^\s:]+)(?::\s*|\s+)(.*)$/u);
  if (!match) return null;

  const [, rawName, rawArgs] = match;
  const command = SLASH_COMMANDS.find(
    (entry) => entry.name === rawName.toLowerCase() || entry.aliases.some((alias) => alias === rawName.toLowerCase()),
  );
  if (!command?.argOptions?.length) return null;

  const prefix = rawArgs.trim().toLowerCase();
  const options = command.argOptions.filter((option) => option.toLowerCase().startsWith(prefix));
  if (options.length === 0) return null;

  return { command, prefix: rawArgs.trim(), options };
}
