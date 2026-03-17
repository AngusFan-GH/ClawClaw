/**
 * Channel Configuration Utilities
 * Manages channel configuration in OpenClaw config files.
 *
 * All file I/O uses async fs/promises to avoid blocking the main thread.
 */
import { access, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { constants } from 'fs';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { app, utilityProcess } from 'electron';
import { getOpenClawEntryPath, getOpenClawResolvedDir, getOpenClawDir } from './paths';
import * as logger from './logger';
import { proxyAwareFetch } from './proxy-fetch';
import { prepareWinSpawn } from './win-shell';

const OPENCLAW_DIR = join(homedir(), '.openclaw');
const CONFIG_FILE = join(OPENCLAW_DIR, 'openclaw.json');
const WECOM_PLUGIN_ID = 'wecom-openclaw-plugin';
const SUPPORTED_CHANNEL_IDS = [
    'whatsapp',
    'dingtalk',
    'telegram',
    'discord',
    'signal',
    'feishu',
    'wecom',
    'imessage',
    'matrix',
    'line',
    'msteams',
    'googlechat',
    'mattermost',
    'qqbot',
] as const;

// Channels that are managed as plugins (config goes under plugins.entries, not channels)
const PLUGIN_CHANNELS = ['whatsapp'];

// ── Helpers ──────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
    try { await access(p, constants.F_OK); return true; } catch { return false; }
}

function extractTrailingJsonObject(raw: string): Record<string, unknown> | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const directMatch = trimmed.match(/(\{[\s\S]*\})\s*$/);
    if (directMatch) {
        try {
            return JSON.parse(directMatch[1]) as Record<string, unknown>;
        } catch {
            // fall through
        }
    }

    const lastObjectStart = trimmed.lastIndexOf('\n{');
    const candidate = lastObjectStart >= 0 ? trimmed.slice(lastObjectStart + 1) : trimmed;
    try {
        return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function getOpenClawCliSpawnConfig(): { command: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string } {
    const cwd = getOpenClawResolvedDir();
    const entryPath = getOpenClawEntryPath();

    if (process.platform === 'win32') {
        return {
            command: process.execPath,
            args: [entryPath, 'channels', 'list', '--json', '--no-usage'],
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                OPENCLAW_NO_RESPAWN: '1',
                OPENCLAW_EMBEDDED_IN: 'ClawClaw',
            },
            cwd,
        };
    }

    if (!app.isPackaged) {
        const openclawDir = getOpenClawDir();
        const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
        const binPath = join(dirname(openclawDir), '.bin', binName);
        if (existsSync(binPath)) {
            return {
                command: binPath,
                args: ['channels', 'list', '--json', '--no-usage'],
                env: {
                    ...process.env,
                    OPENCLAW_NO_RESPAWN: '1',
                    OPENCLAW_EMBEDDED_IN: 'ClawClaw',
                },
                cwd,
            };
        }
    }

    const packagedCli =
        process.platform === 'win32'
            ? join(process.resourcesPath, 'cli', 'openclaw.cmd')
            : join(process.resourcesPath, 'cli', 'openclaw');
    if (app.isPackaged && existsSync(packagedCli)) {
        return {
            command: packagedCli,
            args: ['channels', 'list', '--json', '--no-usage'],
            env: {
                ...process.env,
                OPENCLAW_NO_RESPAWN: '1',
                OPENCLAW_EMBEDDED_IN: 'ClawClaw',
            },
            cwd,
        };
    }

    return {
        command: process.execPath,
        args: [entryPath, 'channels', 'list', '--json', '--no-usage'],
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            OPENCLAW_NO_RESPAWN: '1',
            OPENCLAW_EMBEDDED_IN: 'ClawClaw',
        },
        cwd,
    };
}

async function listConfiguredChannelsFromCli(): Promise<string[]> {
    const supported = new Set<string>(SUPPORTED_CHANNEL_IDS);
    const { command, args, env, cwd } = getOpenClawCliSpawnConfig();

    return await new Promise((resolve) => {
        const child = process.platform === 'win32'
            ? utilityProcess.fork(args[0] ?? '', args.slice(1), {
                cwd,
                env,
                stdio: 'pipe',
                serviceName: 'OpenClaw Channels List',
            })
            : (() => {
                const prepared = prepareWinSpawn(command, args);
                return spawn(prepared.command, prepared.args, {
                    cwd,
                    env,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    shell: prepared.shell,
                    windowsHide: true,
                });
            })();

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            logger.warn('Failed to execute openclaw channels list:', error);
            resolve([]);
        });

        child.on(process.platform === 'win32' ? 'exit' : 'close', () => {
            const parsed = extractTrailingJsonObject(`${stdout}\n${stderr}`);
            if (!parsed) {
                resolve([]);
                return;
            }

            const configured = new Set<string>();
            const chat = parsed.chat;
            if (chat && typeof chat === 'object') {
                for (const key of Object.keys(chat as Record<string, unknown>)) {
                    if (supported.has(key)) {
                        configured.add(key);
                    }
                }
            }

            resolve(Array.from(configured));
        });
    });
}

// ── Types ────────────────────────────────────────────────────────

export interface ChannelConfigData {
    enabled?: boolean;
    [key: string]: unknown;
}

export interface PluginsConfig {
    entries?: Record<string, ChannelConfigData>;
    allow?: string[];
    enabled?: boolean;
    [key: string]: unknown;
}

export interface OpenClawConfig {
    channels?: Record<string, ChannelConfigData>;
    plugins?: PluginsConfig;
    commands?: Record<string, unknown>;
    [key: string]: unknown;
}

interface AccountScopedChannelSection extends ChannelConfigData {
    accounts?: Record<string, ChannelConfigData>;
}

function resolveConfiguredAccounts(
    section: AccountScopedChannelSection | undefined
): Array<{ accountId: string; config: ChannelConfigData }> {
    if (!section?.accounts || typeof section.accounts !== 'object') {
        return [];
    }
    return Object.entries(section.accounts)
        .filter(([, value]) => value && typeof value === 'object')
        .map(([accountId, config]) => ({ accountId, config }));
}

function stripChannelSectionScaffolding(
    value: ChannelConfigData | undefined
): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
        return {};
    }
    return Object.fromEntries(
        Object.entries(value).filter(([key]) => !['enabled', 'name', 'accounts'].includes(key))
    );
}

function hasMeaningfulSectionConfig(value: ChannelConfigData | undefined): boolean {
    return Object.keys(stripChannelSectionScaffolding(value)).length > 0;
}

function configsShareComparableValues(
    left: ChannelConfigData | undefined,
    right: ChannelConfigData | undefined
): boolean {
    const lhs = stripChannelSectionScaffolding(left);
    const rhs = stripChannelSectionScaffolding(right);
    const sharedKeys = Object.keys(lhs).filter((key) => key in rhs);
    return sharedKeys.some((key) => {
        try {
            return JSON.stringify(lhs[key]) === JSON.stringify(rhs[key]);
        } catch {
            return lhs[key] === rhs[key];
        }
    });
}

function resolveEditableChannelSource(
    config: OpenClawConfig,
    channelType: string,
    preferredAccountId?: string | null
): { kind: 'top-level' } | { kind: 'account'; accountId: string } {
    const section = config.channels?.[channelType] as AccountScopedChannelSection | undefined;
    const configuredAccounts = resolveConfiguredAccounts(section);
    const normalizedPreferredAccountId =
        typeof preferredAccountId === 'string' && preferredAccountId.trim()
            ? preferredAccountId.trim()
            : '';

    if (
        normalizedPreferredAccountId === 'default' &&
        hasMeaningfulSectionConfig(section)
    ) {
        return { kind: 'top-level' };
    }

    if (normalizedPreferredAccountId && section?.accounts?.[normalizedPreferredAccountId]) {
        return { kind: 'account', accountId: normalizedPreferredAccountId };
    }

    if (configuredAccounts.length === 1) {
        const [{ accountId, config: accountConfig }] = configuredAccounts;
        if (!hasMeaningfulSectionConfig(section)) {
            return { kind: 'account', accountId };
        }
        if (configsShareComparableValues(section, accountConfig)) {
            // Legacy/buggy duplicated config shape: both top-level and one named
            // account carry the same credentials. Prefer the named account so we
            // do not keep shadowing the plugin's resolved default account.
            return { kind: 'account', accountId };
        }
    }

    return { kind: 'top-level' };
}

function removeTopLevelCredentialFields(
    section: AccountScopedChannelSection
): AccountScopedChannelSection {
    const nextSection = { ...section };
    for (const key of Object.keys(stripChannelSectionScaffolding(section))) {
        delete nextSection[key];
    }
    return nextSection;
}

const BASE_SHARED_CHANNEL_SECTION_KEYS = new Set([
    'enabled',
    'accounts',
    'defaultAccount',
]);

const SHARED_CHANNEL_SECTION_KEYS_BY_TYPE: Record<string, readonly string[]> = {
    feishu: ['connectionMode', 'groupSessionScope', 'renderMode', 'replyInThread', 'groups'],
    qqbot: ['stt', 'tts'],
    telegram: ['historyLimit'],
    discord: ['historyLimit'],
    signal: ['historyLimit'],
    mattermost: ['historyLimit'],
    matrix: ['historyLimit'],
    line: ['historyLimit'],
    msteams: ['historyLimit'],
    googlechat: ['historyLimit'],
    imessage: ['historyLimit'],
    dingtalk: ['historyLimit'],
    wecom: ['historyLimit'],
};

function isSharedChannelSectionKey(channelType: string, key: string): boolean {
    if (BASE_SHARED_CHANNEL_SECTION_KEYS.has(key)) {
        return true;
    }
    return SHARED_CHANNEL_SECTION_KEYS_BY_TYPE[channelType]?.includes(key) ?? false;
}

function cloneIfObject<T>(value: T): T {
    if (value && typeof value === 'object') {
        return structuredClone(value);
    }
    return value;
}

function getAccountScopedTopLevelKeys(
    channelType: string,
    section: AccountScopedChannelSection
): string[] {
    return Object.entries(section)
        .filter(([key, value]) => key !== 'accounts' && value !== undefined)
        .filter(([key]) => !isSharedChannelSectionKey(channelType, key))
        .map(([key]) => key);
}

function moveSingleAccountSectionToDefaultAccount(
    channelType: string,
    section: AccountScopedChannelSection
): AccountScopedChannelSection {
    const accounts = section.accounts && typeof section.accounts === 'object'
        ? { ...section.accounts }
        : {};
    if (Object.keys(accounts).length > 0) {
        return section;
    }

    const keysToMove = getAccountScopedTopLevelKeys(channelType, section);
    if (keysToMove.length === 0) {
        return section;
    }

    const defaultAccount = { ...((accounts.default as ChannelConfigData | undefined) || {}) };
    const nextSection: AccountScopedChannelSection = { ...section };

    for (const key of keysToMove) {
        defaultAccount[key] = cloneIfObject((section as Record<string, unknown>)[key]);
        delete (nextSection as Record<string, unknown>)[key];
    }

    nextSection.accounts = {
        ...accounts,
        default: defaultAccount,
    };
    return nextSection;
}

function clearTopLevelAccountFields(
    channelType: string,
    section: AccountScopedChannelSection
): AccountScopedChannelSection {
    const nextSection = { ...section };
    for (const key of getAccountScopedTopLevelKeys(channelType, section)) {
        delete (nextSection as Record<string, unknown>)[key];
    }
    return nextSection;
}

// ── Config I/O ───────────────────────────────────────────────────

async function ensureConfigDir(): Promise<void> {
    if (!(await fileExists(OPENCLAW_DIR))) {
        await mkdir(OPENCLAW_DIR, { recursive: true });
    }
}

export async function readOpenClawConfig(): Promise<OpenClawConfig> {
    await ensureConfigDir();

    if (!(await fileExists(CONFIG_FILE))) {
        return {};
    }

    try {
        const content = await readFile(CONFIG_FILE, 'utf-8');
        return JSON.parse(content) as OpenClawConfig;
    } catch (error) {
        logger.error('Failed to read OpenClaw config', error);
        console.error('Failed to read OpenClaw config:', error);
        return {};
    }
}

export async function writeOpenClawConfig(config: OpenClawConfig): Promise<void> {
    await ensureConfigDir();

    try {
        // Enable graceful in-process reload authorization for SIGUSR1 flows.
        const commands =
            config.commands && typeof config.commands === 'object'
                ? { ...(config.commands as Record<string, unknown>) }
                : {};
        commands.restart = true;
        config.commands = commands;

        await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
        logger.error('Failed to write OpenClaw config', error);
        console.error('Failed to write OpenClaw config:', error);
        throw error;
    }
}

// ── Channel operations ───────────────────────────────────────────

export async function saveChannelConfig(
    channelType: string,
    config: ChannelConfigData
): Promise<void> {
    const currentConfig = await readOpenClawConfig();
    const preferredAccountId =
        typeof config.__accountId === 'string' && config.__accountId.trim()
            ? config.__accountId.trim()
            : undefined;

    // DingTalk is a channel plugin; make sure it's explicitly allowed.
    // Newer OpenClaw versions may not load non-bundled plugins when allowlist is empty.
    if (channelType === 'dingtalk') {
        const defaultDingtalkAllow = ['dingtalk'];
        if (!currentConfig.plugins) {
            currentConfig.plugins = { allow: defaultDingtalkAllow, enabled: true };
        } else {
            currentConfig.plugins.enabled = true;
            const allow: string[] = Array.isArray(currentConfig.plugins.allow)
                ? (currentConfig.plugins.allow as string[])
                : [];
            if (!allow.includes('dingtalk')) {
                currentConfig.plugins.allow = [...allow, 'dingtalk'];
            }
        }
    }

    if (channelType === 'wecom') {
        const defaultWecomAllow = [WECOM_PLUGIN_ID];
        if (!currentConfig.plugins) {
            currentConfig.plugins = { allow: defaultWecomAllow, enabled: true };
        } else {
            currentConfig.plugins.enabled = true;
            const allow: string[] = Array.isArray(currentConfig.plugins.allow)
                ? (currentConfig.plugins.allow as string[])
                : [];
            const normalizedAllow = allow.filter((pluginId) => pluginId !== 'wecom');
            if (!normalizedAllow.includes(WECOM_PLUGIN_ID)) {
                currentConfig.plugins.allow = [...normalizedAllow, WECOM_PLUGIN_ID];
            } else if (normalizedAllow.length !== allow.length) {
                currentConfig.plugins.allow = normalizedAllow;
            }
        }
    }

    // QQ Bot is a channel plugin; make sure it's explicitly allowed.
    // Newer OpenClaw versions may not load non-bundled plugins when allowlist is empty.
    if (channelType === 'qqbot') {
        if (!currentConfig.plugins) {
            currentConfig.plugins = {};
        }
        currentConfig.plugins.enabled = true;
        const allow = Array.isArray(currentConfig.plugins.allow)
            ? currentConfig.plugins.allow as string[]
            : [];
        if (!allow.includes('qqbot')) {
            currentConfig.plugins.allow = [...allow, 'qqbot'];
        }
    }

    // Plugin-based channels (e.g. WhatsApp) go under plugins.entries, not channels
    if (PLUGIN_CHANNELS.includes(channelType)) {
        if (!currentConfig.plugins) {
            currentConfig.plugins = {};
        }
        if (!currentConfig.plugins.entries) {
            currentConfig.plugins.entries = {};
        }
        currentConfig.plugins.entries[channelType] = {
            ...currentConfig.plugins.entries[channelType],
            enabled: config.enabled ?? true,
        };
        await writeOpenClawConfig(currentConfig);
        logger.info('Plugin channel config saved', {
            channelType,
            configFile: CONFIG_FILE,
            path: `plugins.entries.${channelType}`,
        });
        console.log(`Saved plugin channel config for ${channelType}`);
        return;
    }

    if (!currentConfig.channels) {
        currentConfig.channels = {};
    }

    // Transform config to match OpenClaw expected format
    let transformedConfig: ChannelConfigData = { ...config };
    delete transformedConfig.__accountId;

    // Special handling for Discord: convert guildId/channelId to complete structure
    if (channelType === 'discord') {
        const { guildId, channelId, ...restConfig } = config;
        transformedConfig = { ...restConfig };

        transformedConfig.groupPolicy = 'allowlist';
        transformedConfig.dm = { enabled: false };
        transformedConfig.retry = {
            attempts: 3,
            minDelayMs: 500,
            maxDelayMs: 30000,
            jitter: 0.1,
        };

        if (guildId && typeof guildId === 'string' && guildId.trim()) {
            const guildConfig: Record<string, unknown> = {
                users: ['*'],
                requireMention: true,
            };

            if (channelId && typeof channelId === 'string' && channelId.trim()) {
                guildConfig.channels = {
                    [channelId.trim()]: { allow: true, requireMention: true }
                };
            } else {
                guildConfig.channels = {
                    '*': { allow: true, requireMention: true }
                };
            }

            transformedConfig.guilds = {
                [guildId.trim()]: guildConfig
            };
        }
    }

    // Special handling for Telegram: convert allowedUsers string to allowlist array
    if (channelType === 'telegram') {
        const { allowedUsers, ...restConfig } = config;
        transformedConfig = { ...restConfig };

        if (allowedUsers && typeof allowedUsers === 'string') {
            const users = allowedUsers.split(',')
                .map(u => u.trim())
                .filter(u => u.length > 0);

            if (users.length > 0) {
                transformedConfig.allowFrom = users;
            }
        }
    }

    // Special handling for Feishu / WeCom: default to open DM policy with wildcard allowlist
    if (channelType === 'feishu' || channelType === 'wecom') {
        const existingConfig = currentConfig.channels[channelType] || {};
        const existingDmPolicy = existingConfig.dmPolicy === 'pairing' ? 'open' : existingConfig.dmPolicy;
        transformedConfig.dmPolicy = transformedConfig.dmPolicy ?? existingDmPolicy ?? 'open';

        let allowFrom = (transformedConfig.allowFrom ?? existingConfig.allowFrom ?? ['*']) as string[];
        if (!Array.isArray(allowFrom)) {
            allowFrom = [allowFrom] as string[];
        }

        if (transformedConfig.dmPolicy === 'open' && !allowFrom.includes('*')) {
            allowFrom = [...allowFrom, '*'];
        }

        transformedConfig.allowFrom = allowFrom;
    }

    {
        let existingSection = (currentConfig.channels[channelType] as AccountScopedChannelSection | undefined) || {};

        const normalizedPreferredAccountId =
            typeof preferredAccountId === 'string' && preferredAccountId.trim()
                ? preferredAccountId.trim()
                : '';

        if (
            normalizedPreferredAccountId &&
            normalizedPreferredAccountId !== 'default' &&
            hasMeaningfulSectionConfig(existingSection) &&
            (!existingSection.accounts || Object.keys(existingSection.accounts).length === 0)
        ) {
            existingSection = moveSingleAccountSectionToDefaultAccount(channelType, existingSection);
            currentConfig.channels[channelType] = existingSection;
        }

        const editableSource =
            normalizedPreferredAccountId && normalizedPreferredAccountId !== 'default'
                ? { kind: 'account' as const, accountId: normalizedPreferredAccountId }
                : resolveEditableChannelSource(currentConfig, channelType, preferredAccountId);

        if (editableSource.kind === 'account') {
            const accounts = { ...(existingSection.accounts || {}) };
            const existingAccount = (accounts[editableSource.accountId] as ChannelConfigData | undefined) || {};
            accounts[editableSource.accountId] = {
                ...existingAccount,
                ...transformedConfig,
                enabled: transformedConfig.enabled ?? true,
            };

            let nextSection: AccountScopedChannelSection = {
                ...existingSection,
                accounts,
            };

            // If ClawX previously created a conflicting duplicated default account,
            // remove top-level credentials so the plugin resolves the named account.
            if (configsShareComparableValues(existingSection, existingAccount)) {
                nextSection = removeTopLevelCredentialFields(nextSection);
            }

            currentConfig.channels[channelType] = nextSection;
        } else {
            currentConfig.channels[channelType] = {
                ...existingSection,
                ...transformedConfig,
                enabled: transformedConfig.enabled ?? true,
            };
        }
    }

    await writeOpenClawConfig(currentConfig);
    logger.info('Channel config saved', {
        channelType,
        configFile: CONFIG_FILE,
        rawKeys: Object.keys(config),
        transformedKeys: Object.keys(transformedConfig),
        enabled: currentConfig.channels[channelType]?.enabled,
    });
    console.log(`Saved channel config for ${channelType}`);
}

export async function getChannelConfig(
    channelType: string,
    preferredAccountId?: string | null
): Promise<ChannelConfigData | undefined> {
    const config = await readOpenClawConfig();
    if (config.channels?.[channelType]) {
        const section = config.channels[channelType] as AccountScopedChannelSection | undefined;
        if (!section) return undefined;
        const source = resolveEditableChannelSource(config, channelType, preferredAccountId);
        if (source.kind === 'account') {
            return section.accounts?.[source.accountId];
        }
    }
    return config.channels?.[channelType];
}

export async function getChannelFormValues(
    channelType: string,
    preferredAccountId?: string | null
): Promise<Record<string, string> | undefined> {
    const config = await readOpenClawConfig();
    const source = resolveEditableChannelSource(config, channelType, preferredAccountId);
    const saved = await getChannelConfig(channelType, preferredAccountId);
    if (!saved) return undefined;

    const values: Record<string, string> = {};

    if (channelType === 'discord') {
        if (saved.token && typeof saved.token === 'string') {
            values.token = saved.token;
        }
        const guilds = saved.guilds as Record<string, Record<string, unknown>> | undefined;
        if (guilds) {
            const guildIds = Object.keys(guilds);
            if (guildIds.length > 0) {
                values.guildId = guildIds[0];
                const guildConfig = guilds[guildIds[0]];
                const channels = guildConfig?.channels as Record<string, unknown> | undefined;
                if (channels) {
                    const channelIds = Object.keys(channels).filter((id) => id !== '*');
                    if (channelIds.length > 0) {
                        values.channelId = channelIds[0];
                    }
                }
            }
        }
    } else if (channelType === 'telegram') {
        if (Array.isArray(saved.allowFrom)) {
            values.allowedUsers = saved.allowFrom.join(', ');
        }
        for (const [key, value] of Object.entries(saved)) {
            if (typeof value === 'string' && key !== 'enabled') {
                values[key] = value;
            }
        }
    } else {
        for (const [key, value] of Object.entries(saved)) {
            if (typeof value === 'string' && key !== 'enabled') {
                values[key] = value;
            }
        }
    }

    if (source.kind === 'account') {
        values.__accountId = source.accountId;
    }

    return Object.keys(values).length > 0 ? values : undefined;
}

export async function deleteChannelConfig(
    channelType: string,
    preferredAccountId?: string | null
): Promise<void> {
    const currentConfig = await readOpenClawConfig();
    let configChanged = false;

    if (currentConfig.channels?.[channelType]) {
        const section = currentConfig.channels[channelType] as AccountScopedChannelSection | undefined;
        const source = resolveEditableChannelSource(currentConfig, channelType, preferredAccountId);
        if (section && source.kind === 'account' && section.accounts?.[source.accountId]) {
            const accounts = { ...section.accounts };
            const accountConfig = accounts[source.accountId] as ChannelConfigData | undefined;
            delete accounts[source.accountId];
            const remainingAccounts = Object.keys(accounts);
            let nextSection: AccountScopedChannelSection = {
                ...section,
                ...(remainingAccounts.length > 0 ? { accounts } : {}),
            };
            if (remainingAccounts.length === 0) {
                delete nextSection.accounts;
            }
            if (configsShareComparableValues(section, accountConfig)) {
                nextSection = removeTopLevelCredentialFields(nextSection);
            }
            if (remainingAccounts.length === 0 && !hasMeaningfulSectionConfig(nextSection)) {
                delete currentConfig.channels[channelType];
            } else {
                currentConfig.channels[channelType] = nextSection;
            }
        } else {
            if (section?.accounts && Object.keys(section.accounts).length > 0) {
                const nextSection = clearTopLevelAccountFields(channelType, section);
                if (!nextSection.accounts || Object.keys(nextSection.accounts).length === 0) {
                    delete currentConfig.channels[channelType];
                } else {
                    currentConfig.channels[channelType] = nextSection;
                }
            } else {
                delete currentConfig.channels[channelType];
            }
        }
        configChanged = true;
        console.log(`Deleted channel config for ${channelType}`);
    }

    if (PLUGIN_CHANNELS.includes(channelType)) {
        if (currentConfig.plugins?.entries?.[channelType]) {
            delete currentConfig.plugins.entries[channelType];
            if (Object.keys(currentConfig.plugins.entries).length === 0) {
                delete currentConfig.plugins.entries;
            }
            if (currentConfig.plugins && Object.keys(currentConfig.plugins).length === 0) {
                delete currentConfig.plugins;
            }
            configChanged = true;
            console.log(`Deleted plugin channel config for ${channelType}`);
        }
    } else if (currentConfig.plugins?.entries?.[channelType]) {
        delete currentConfig.plugins.entries[channelType];
        if (Object.keys(currentConfig.plugins.entries).length === 0) {
            delete currentConfig.plugins.entries;
        }
        if (currentConfig.plugins && Object.keys(currentConfig.plugins).length === 0) {
            delete currentConfig.plugins;
        }
        configChanged = true;
    }

    if (configChanged) {
        await writeOpenClawConfig(currentConfig);
    }

    // Special handling for WhatsApp credentials
    if (channelType === 'whatsapp') {
        try {
            const whatsappDir = join(homedir(), '.openclaw', 'credentials', 'whatsapp');
            if (await fileExists(whatsappDir)) {
                await rm(whatsappDir, { recursive: true, force: true });
                console.log('Deleted WhatsApp credentials directory');
            }
        } catch (error) {
            console.error('Failed to delete WhatsApp credentials:', error);
        }
    }
}

export async function listConfiguredChannels(): Promise<string[]> {
    const config = await readOpenClawConfig();
    const channels = new Set<string>();

    if (process.platform !== 'win32') {
        for (const channelType of await listConfiguredChannelsFromCli()) {
            channels.add(channelType);
        }
    }

    if (config.channels) {
        for (const [channelType, rawSection] of Object.entries(config.channels)) {
            const section = rawSection as AccountScopedChannelSection | undefined;
            if (!section || section.enabled === false) continue;
            const hasTopLevelConfig = hasMeaningfulSectionConfig(section);
            const hasConfiguredAccounts = resolveConfiguredAccounts(section).some(
                ({ config: accountConfig }) => hasMeaningfulSectionConfig(accountConfig)
            );
            if (hasTopLevelConfig || hasConfiguredAccounts) {
                channels.add(channelType);
            }
        }
    }

    if (config.plugins?.entries) {
        for (const [pluginId, pluginConfig] of Object.entries(config.plugins.entries)) {
            if (pluginConfig?.enabled === false) continue;
            if (PLUGIN_CHANNELS.includes(pluginId as typeof PLUGIN_CHANNELS[number])) {
                channels.add(pluginId);
            }
        }
    }

    return Array.from(channels);
}

export async function listConfiguredChannelAccounts(): Promise<Record<string, string[]>> {
    const config = await readOpenClawConfig();
    const result: Record<string, string[]> = {};

    for (const channelType of await listConfiguredChannels()) {
        const section = config.channels?.[channelType] as AccountScopedChannelSection | undefined;
        const accountIds = new Set<string>();

        if (section && section.enabled !== false) {
            if (getAccountScopedTopLevelKeys(channelType, section).length > 0) {
                accountIds.add('default');
            }
            for (const { accountId, config: accountConfig } of resolveConfiguredAccounts(section)) {
                if (hasMeaningfulSectionConfig(accountConfig)) {
                    accountIds.add(accountId);
                }
            }
        }

        if (PLUGIN_CHANNELS.includes(channelType) && accountIds.size === 0) {
            accountIds.add('default');
        }

        if (accountIds.size > 0) {
            result[channelType] = Array.from(accountIds);
        }
    }

    return result;
}

export interface ConfiguredChannelGroupSnapshot {
    type: string;
    defaultAccountId?: string;
    configured: boolean;
    accounts: Array<{
        accountId: string;
        isDefaultAccount: boolean;
        configured: boolean;
    }>;
}

export async function listConfiguredChannelGroups(): Promise<ConfiguredChannelGroupSnapshot[]> {
    const config = await readOpenClawConfig();
    const groups: ConfiguredChannelGroupSnapshot[] = [];

    for (const channelType of await listConfiguredChannels()) {
        const section = config.channels?.[channelType] as AccountScopedChannelSection | undefined;
        const accounts = new Map<string, ConfiguredChannelGroupSnapshot['accounts'][number]>();
        const explicitDefaultAccountId =
            typeof section?.defaultAccount === 'string' && section.defaultAccount.trim()
                ? section.defaultAccount.trim()
                : undefined;

        if (section && section.enabled !== false && getAccountScopedTopLevelKeys(channelType, section).length > 0) {
            accounts.set('default', {
                accountId: 'default',
                isDefaultAccount: explicitDefaultAccountId ? explicitDefaultAccountId === 'default' : true,
                configured: true,
            });
        }

        if (section && section.enabled !== false) {
            for (const { accountId, config: accountConfig } of resolveConfiguredAccounts(section)) {
                if (!hasMeaningfulSectionConfig(accountConfig)) continue;
                accounts.set(accountId, {
                    accountId,
                    isDefaultAccount: explicitDefaultAccountId
                        ? explicitDefaultAccountId === accountId
                        : accountId === 'default',
                    configured: true,
                });
            }
        }

        if (PLUGIN_CHANNELS.includes(channelType) && accounts.size === 0) {
            accounts.set('default', {
                accountId: 'default',
                isDefaultAccount: true,
                configured: true,
            });
        }

        const sortedAccounts = Array.from(accounts.values()).sort((left, right) => {
            if (left.isDefaultAccount !== right.isDefaultAccount) {
                return left.isDefaultAccount ? -1 : 1;
            }
            return left.accountId.localeCompare(right.accountId);
        });

        groups.push({
            type: channelType,
            defaultAccountId:
                explicitDefaultAccountId ||
                sortedAccounts.find((account) => account.isDefaultAccount)?.accountId,
            configured: sortedAccounts.length > 0,
            accounts: sortedAccounts,
        });
    }

    return groups;
}

export async function setChannelEnabled(
    channelType: string,
    enabled: boolean,
    preferredAccountId?: string | null
): Promise<void> {
    const currentConfig = await readOpenClawConfig();

    if (PLUGIN_CHANNELS.includes(channelType)) {
        if (!currentConfig.plugins) currentConfig.plugins = {};
        if (!currentConfig.plugins.entries) currentConfig.plugins.entries = {};
        if (!currentConfig.plugins.entries[channelType]) currentConfig.plugins.entries[channelType] = {};
        currentConfig.plugins.entries[channelType].enabled = enabled;
        await writeOpenClawConfig(currentConfig);
        console.log(`Set plugin channel ${channelType} enabled: ${enabled}`);
        return;
    }

    if (!currentConfig.channels) currentConfig.channels = {};
    if (!currentConfig.channels[channelType]) currentConfig.channels[channelType] = {};
    const section = currentConfig.channels[channelType] as AccountScopedChannelSection;
    const source = resolveEditableChannelSource(currentConfig, channelType, preferredAccountId);
    if (source.kind === 'account') {
        const accounts = { ...(section.accounts || {}) };
        const accountSection = { ...((accounts[source.accountId] as ChannelConfigData | undefined) || {}) };
        accountSection.enabled = enabled;
        accounts[source.accountId] = accountSection;
        currentConfig.channels[channelType] = {
            ...section,
            enabled,
            accounts,
        };
    } else {
        currentConfig.channels[channelType].enabled = enabled;
    }
    await writeOpenClawConfig(currentConfig);
    console.log(`Set channel ${channelType} enabled: ${enabled}`);
}

// ── Validation ───────────────────────────────────────────────────

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export interface CredentialValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    details?: Record<string, string>;
}

export async function validateChannelCredentials(
    channelType: string,
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    switch (channelType) {
        case 'discord':
            return validateDiscordCredentials(config);
        case 'telegram':
            return validateTelegramCredentials(config);
        default:
            return { valid: true, errors: [], warnings: ['No online validation available for this channel type.'] };
    }
}

async function validateDiscordCredentials(
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    const result: CredentialValidationResult = { valid: true, errors: [], warnings: [], details: {} };
    const token = config.token?.trim();

    if (!token) {
        return { valid: false, errors: ['Bot token is required'], warnings: [] };
    }

    try {
        const meResponse = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bot ${token}` },
        });
        if (!meResponse.ok) {
            if (meResponse.status === 401) {
                return { valid: false, errors: ['Invalid bot token. Please check and try again.'], warnings: [] };
            }
            const errorData = await meResponse.json().catch(() => ({}));
            const msg = (errorData as { message?: string }).message || `Discord API error: ${meResponse.status}`;
            return { valid: false, errors: [msg], warnings: [] };
        }
        const meData = (await meResponse.json()) as { username?: string; id?: string; bot?: boolean };
        if (!meData.bot) {
            return { valid: false, errors: ['The provided token belongs to a user account, not a bot. Please use a bot token.'], warnings: [] };
        }
        result.details!.botUsername = meData.username || 'Unknown';
        result.details!.botId = meData.id || '';
    } catch (error) {
        return { valid: false, errors: [`Connection error when validating bot token: ${error instanceof Error ? error.message : String(error)}`], warnings: [] };
    }

    const guildId = config.guildId?.trim();
    if (guildId) {
        try {
            const guildResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
                headers: { Authorization: `Bot ${token}` },
            });
            if (!guildResponse.ok) {
                if (guildResponse.status === 403 || guildResponse.status === 404) {
                    result.errors.push(`Cannot access guild (server) with ID "${guildId}". Make sure the bot has been invited to this server.`);
                    result.valid = false;
                } else {
                    result.errors.push(`Failed to verify guild ID: Discord API returned ${guildResponse.status}`);
                    result.valid = false;
                }
            } else {
                const guildData = (await guildResponse.json()) as { name?: string };
                result.details!.guildName = guildData.name || 'Unknown';
            }
        } catch (error) {
            result.warnings.push(`Could not verify guild ID: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const channelId = config.channelId?.trim();
    if (channelId) {
        try {
            const channelResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
                headers: { Authorization: `Bot ${token}` },
            });
            if (!channelResponse.ok) {
                if (channelResponse.status === 403 || channelResponse.status === 404) {
                    result.errors.push(`Cannot access channel with ID "${channelId}". Make sure the bot has permission to view this channel.`);
                    result.valid = false;
                } else {
                    result.errors.push(`Failed to verify channel ID: Discord API returned ${channelResponse.status}`);
                    result.valid = false;
                }
            } else {
                const channelData = (await channelResponse.json()) as { name?: string; guild_id?: string };
                result.details!.channelName = channelData.name || 'Unknown';
                if (guildId && channelData.guild_id && channelData.guild_id !== guildId) {
                    result.errors.push(`Channel "${channelData.name}" does not belong to the specified guild. It belongs to a different server.`);
                    result.valid = false;
                }
            }
        } catch (error) {
            result.warnings.push(`Could not verify channel ID: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return result;
}

async function validateTelegramCredentials(
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    const botToken = config.botToken?.trim();
    const allowedUsers = config.allowedUsers?.trim();

    if (!botToken) return { valid: false, errors: ['Bot token is required'], warnings: [] };
    if (!allowedUsers) return { valid: false, errors: ['At least one allowed user ID is required'], warnings: [] };

    try {
        const response = await proxyAwareFetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const data = (await response.json()) as { ok?: boolean; description?: string; result?: { username?: string } };
        if (data.ok) {
            return { valid: true, errors: [], warnings: [], details: { botUsername: data.result?.username || 'Unknown' } };
        }
        return { valid: false, errors: [data.description || 'Invalid bot token'], warnings: [] };
    } catch (error) {
        return { valid: false, errors: [`Connection error: ${error instanceof Error ? error.message : String(error)}`], warnings: [] };
    }
}

export async function validateChannelConfig(channelType: string): Promise<ValidationResult> {
    const { exec } = await import('child_process');

    const result: ValidationResult = { valid: true, errors: [], warnings: [] };

    try {
        const openclawPath = getOpenClawResolvedDir();

        // Run openclaw doctor command to validate config (async to avoid
        // blocking the main thread).
        const output = await new Promise<string>((resolve, reject) => {
            exec(
                `node openclaw.mjs doctor --json 2>&1`,
                {
                    cwd: openclawPath,
                    encoding: 'utf-8',
                    timeout: 30000,
                    windowsHide: true,
                },
                (err, stdout) => {
                    if (err) reject(err);
                    else resolve(stdout);
                },
            );
        });

        const lines = output.split('\n');
        for (const line of lines) {
            const lowerLine = line.toLowerCase();
            if (lowerLine.includes(channelType) && lowerLine.includes('error')) {
                result.errors.push(line.trim());
                result.valid = false;
            } else if (lowerLine.includes(channelType) && lowerLine.includes('warning')) {
                result.warnings.push(line.trim());
            } else if (lowerLine.includes('unrecognized key') && lowerLine.includes(channelType)) {
                result.errors.push(line.trim());
                result.valid = false;
            }
        }

        const config = await readOpenClawConfig();
        if (!config.channels?.[channelType]) {
            result.errors.push(`Channel ${channelType} is not configured`);
            result.valid = false;
        } else if (!config.channels[channelType].enabled) {
            result.warnings.push(`Channel ${channelType} is disabled`);
        }

        if (channelType === 'discord') {
            const discordConfig = config.channels?.discord;
            if (!discordConfig?.token) {
                result.errors.push('Discord: Bot token is required');
                result.valid = false;
            }
        } else if (channelType === 'telegram') {
            const telegramConfig = config.channels?.telegram;
            if (!telegramConfig?.botToken) {
                result.errors.push('Telegram: Bot token is required');
                result.valid = false;
            }
            const allowedUsers = telegramConfig?.allowFrom as string[] | undefined;
            if (!allowedUsers || allowedUsers.length === 0) {
                result.errors.push('Telegram: Allowed User IDs are required');
                result.valid = false;
            }
        }

        if (result.errors.length === 0 && result.warnings.length === 0) {
            result.valid = true;
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('Unrecognized key') || errorMessage.includes('invalid config')) {
            result.errors.push(errorMessage);
            result.valid = false;
        } else if (errorMessage.includes('ENOENT')) {
            result.errors.push('OpenClaw not found. Please ensure OpenClaw is installed.');
            result.valid = false;
        } else {
            console.warn('Doctor command failed:', errorMessage);
            const config = await readOpenClawConfig();
            if (config.channels?.[channelType]) {
                result.valid = true;
            } else {
                result.errors.push(`Channel ${channelType} is not configured`);
                result.valid = false;
            }
        }
    }

    return result;
}
