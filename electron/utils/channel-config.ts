/**
 * Channel Configuration Utilities
 * Manages channel configuration in OpenClaw config files.
 *
 * All file I/O uses async fs/promises to avoid blocking the main thread.
 */
import { access, readFile, readdir, rm, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { resolveOpenClawDir } from './paths';
import * as logger from './logger';
import {
    readOpenClawConfigRecord,
    readOpenClawConfigRecordRaw,
    sanitizeKnownInvalidOpenClawKeys,
    updateOpenClawConfigRecord,
    writeOpenClawConfigRecord,
} from './openclaw-config';
import { hasIncompatibleManagedPluginSdkImports } from './plugin-sdk-compat';
import { proxyAwareFetch } from './proxy-fetch';
import {
    normalizeOpenClawAccountId,
    WECHAT_RUNTIME_CHANNEL_ID,
    WECHAT_UI_CHANNEL_ID,
    isWeChatRuntimeChannel,
    toRuntimeChannelType,
    toUiChannelType,
} from './channel-alias';
import {
    beginChannelDraftSession,
    getChannelDraftConfigSnapshot,
    stageChannelRemovedPaths,
    updateChannelDraftConfig,
} from '../services/channel-draft-session';

const OPENCLAW_DIR = resolveOpenClawDir();
const EXTENSIONS_DIR = join(OPENCLAW_DIR, 'extensions');
const CONFIG_FILE = join(OPENCLAW_DIR, 'openclaw.json');
const FEISHU_PLUGIN_ID_CANDIDATES = ['feishu', 'openclaw-lark', 'feishu-openclaw-plugin'] as const;
const LEGACY_CHINA_CHANNEL_PLUGIN_ID = 'channels';
const CHINA_CHANNEL_TYPES = ['dingtalk', 'wecom'] as const;
const QQBOT_LEGACY_PLUGIN_IDS = ['openclaw-qqbot'] as const;
const CHINA_CHANNEL_LEGACY_PLUGIN_IDS: Record<(typeof CHINA_CHANNEL_TYPES)[number], string[]> = {
    dingtalk: [LEGACY_CHINA_CHANNEL_PLUGIN_ID],
    wecom: [LEGACY_CHINA_CHANNEL_PLUGIN_ID, 'wecom-openclaw-plugin'],
};
const CHINA_CHANNEL_PLUGIN_IDS: Record<(typeof CHINA_CHANNEL_TYPES)[number], string> = {
    dingtalk: 'dingtalk',
    wecom: 'wecom',
};
const CHANNEL_PLUGIN_ALLOWLIST_IDS: Partial<Record<string, string>> = {
    qqbot: 'qqbot',
    [WECHAT_RUNTIME_CHANNEL_ID]: WECHAT_RUNTIME_CHANNEL_ID,
};
const BUILTIN_CHANNEL_ALLOWLIST_IDS = new Set(['discord', 'telegram', 'qqbot', 'whatsapp']);
const TOP_LEVEL_DEFAULT_ACCOUNT_MIRROR_CHANNELS = new Set(['discord', 'telegram', 'qqbot', 'whatsapp']);
const CHANNELS_OMIT_DEFAULT_ACCOUNT_KEY = new Set(['dingtalk']);
// OpenClaw channel runtime configuration is stored under channels.<id>.
// Keep the set empty so older plugin-entry code paths can be retired without
// removing the defensive migration/delete branches below.
const PLUGIN_CHANNELS: string[] = [];
const LEGACY_CHANNEL_PLUGIN_IDS = [
    'openclaw-lark',
    'feishu-openclaw-plugin',
    'wecom-openclaw-plugin',
    'openclaw-qqbot',
] as const;
const OFFICIAL_BUNDLED_PLUGIN_MIRROR_IDS = ['feishu'] as const;
const MANAGED_CHANNEL_PLUGIN_IDS = [
    ...new Set<string>([
        ...LEGACY_CHANNEL_PLUGIN_IDS,
        ...OFFICIAL_BUNDLED_PLUGIN_MIRROR_IDS,
        LEGACY_CHINA_CHANNEL_PLUGIN_ID,
        ...Object.values(CHINA_CHANNEL_PLUGIN_IDS),
        WECHAT_RUNTIME_CHANNEL_ID,
    ]),
] as const;

export type OpenClawConfigWriteOptions = {
    requestRestart?: boolean;
};

export const NO_RESTART_CONFIG_WRITE = { requestRestart: false } as const;

function collapseShadowDefaultAccount(
    section: AccountScopedChannelSection | undefined
): AccountScopedChannelSection | undefined {
    if (!section?.accounts || typeof section.accounts !== 'object') {
        return section;
    }

    if (hasMeaningfulSectionConfig(section)) {
        return section;
    }

    const defaultConfig = section.accounts.default as ChannelConfigData | undefined;
    if (!hasMeaningfulSectionConfig(defaultConfig)) {
        return section;
    }

    const namedAccounts = Object.entries(section.accounts)
        .filter(([accountId, value]) => accountId !== 'default' && value && typeof value === 'object')
        .map(([accountId, config]) => ({ accountId, config: config as ChannelConfigData }))
        .filter(({ config }) => hasMeaningfulSectionConfig(config));

    if (namedAccounts.length !== 1) {
        return section;
    }

    const [namedAccount] = namedAccounts;
    if (!configsShareComparableValues(defaultConfig, namedAccount.config)) {
        return section;
    }

    const nextAccounts = { ...section.accounts };
    delete nextAccounts.default;

    const nextSection: AccountScopedChannelSection = {
        ...section,
        accounts: nextAccounts,
    };

    if (nextSection.defaultAccount === 'default' || !nextSection.defaultAccount) {
        nextSection.defaultAccount = namedAccount.accountId;
    }

    return nextSection;
}

function normalizeAccountScopedChannelSections(currentConfig: OpenClawConfig): void {
    if (!currentConfig.channels || typeof currentConfig.channels !== 'object') {
        return;
    }

    for (const [channelType, rawSection] of Object.entries(currentConfig.channels)) {
        if (channelType === 'feishu') {
            continue;
        }
        const section = rawSection as AccountScopedChannelSection | undefined;
        const normalized = collapseShadowDefaultAccount(section);
        if (normalized) {
            currentConfig.channels[channelType] = normalized;
        }
    }
}

function migrateLegacyWechatSection(currentConfig: OpenClawConfig): void {
    const legacyWhatsAppEntry = currentConfig.plugins?.entries?.whatsapp;
    if (legacyWhatsAppEntry && typeof legacyWhatsAppEntry === 'object') {
        if (!currentConfig.channels) {
            currentConfig.channels = {};
        }
        currentConfig.channels.whatsapp = {
            ...(currentConfig.channels.whatsapp || {}),
            ...(legacyWhatsAppEntry as ChannelConfigData),
        };
        delete currentConfig.plugins?.entries?.whatsapp;
        pruneEmptyPluginsConfig(currentConfig);
    }

    if (!currentConfig.channels?.[WECHAT_UI_CHANNEL_ID]) {
        normalizeAccountScopedChannelSections(currentConfig);
        return;
    }

    if (!currentConfig.channels) {
        return;
    }

    const legacySection = currentConfig.channels[WECHAT_UI_CHANNEL_ID] as ChannelConfigData | undefined;
    if (!legacySection) {
        delete currentConfig.channels[WECHAT_UI_CHANNEL_ID];
        return;
    }

    if (!currentConfig.channels[WECHAT_RUNTIME_CHANNEL_ID]) {
        currentConfig.channels[WECHAT_RUNTIME_CHANNEL_ID] = legacySection;
    }

    delete currentConfig.channels[WECHAT_UI_CHANNEL_ID];
    normalizeAccountScopedChannelSections(currentConfig);
}

// ── Helpers ──────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
    try { await access(p, constants.F_OK); return true; } catch { return false; }
}

function isChinaChannelsManagedChannel(channelType: string): channelType is (typeof CHINA_CHANNEL_TYPES)[number] {
    return CHINA_CHANNEL_TYPES.includes(channelType as (typeof CHINA_CHANNEL_TYPES)[number]);
}

function getLegacyChannelPluginIds(channelType: string): string[] {
    if (channelType === 'feishu') {
        return ['feishu', ...FEISHU_PLUGIN_ID_CANDIDATES];
    }
    if (isChinaChannelsManagedChannel(channelType)) {
        return CHINA_CHANNEL_LEGACY_PLUGIN_IDS[channelType];
    }
    return [CHANNEL_PLUGIN_ALLOWLIST_IDS[channelType]].filter((value): value is string => Boolean(value));
}

function getChannelPluginAllowIds(channelType: string): string[] {
    if (isChinaChannelsManagedChannel(channelType)) {
        return [CHINA_CHANNEL_PLUGIN_IDS[channelType]];
    }
    return getLegacyChannelPluginIds(channelType);
}

function ensurePluginEnabled(
    currentConfig: OpenClawConfig,
    pluginId: string,
    options?: { createEntry?: boolean; createAllowlist?: boolean }
): void {
    if (!currentConfig.plugins) {
        currentConfig.plugins = {};
    }
    currentConfig.plugins.enabled = true;
    if (Array.isArray(currentConfig.plugins.allow)) {
        const allow = currentConfig.plugins.allow as string[];
        if (!allow.includes(pluginId)) {
            currentConfig.plugins.allow = [...allow, pluginId];
        }
    } else if (options?.createAllowlist) {
        currentConfig.plugins.allow = [pluginId];
    }

    if (!options?.createEntry) {
        return;
    }

    if (!currentConfig.plugins.entries) {
        currentConfig.plugins.entries = {};
    }
    if (!currentConfig.plugins.entries[pluginId]) {
        currentConfig.plugins.entries[pluginId] = {};
    }
    currentConfig.plugins.entries[pluginId].enabled = true;
}

function removePluginIds(
    currentConfig: OpenClawConfig,
    pluginIds: readonly string[],
): boolean {
    if (pluginIds.length === 0 || !currentConfig.plugins) {
        return false;
    }

    let changed = false;
    if (Array.isArray(currentConfig.plugins.allow)) {
        const nextAllow = (currentConfig.plugins.allow as string[]).filter((pluginId) => !pluginIds.includes(pluginId));
        if (nextAllow.length !== currentConfig.plugins.allow.length) {
            if (nextAllow.length > 0) {
                currentConfig.plugins.allow = nextAllow;
            } else {
                delete currentConfig.plugins.allow;
            }
            changed = true;
        }
    }

    if (currentConfig.plugins.entries) {
        for (const pluginId of pluginIds) {
            if (currentConfig.plugins.entries[pluginId]) {
                delete currentConfig.plugins.entries[pluginId];
                changed = true;
            }
        }
        if (Object.keys(currentConfig.plugins.entries).length === 0) {
            delete currentConfig.plugins.entries;
        }
    }

    if (Object.keys(currentConfig.plugins).length === 0) {
        delete currentConfig.plugins;
    }

    return changed;
}

function pruneEmptyPluginsConfig(currentConfig: OpenClawConfig): void {
    if (!currentConfig.plugins || typeof currentConfig.plugins !== 'object') {
        return;
    }

    const hasMeaningfulKeys = Object.entries(currentConfig.plugins).some(([key, value]) => {
        if (key === 'enabled') {
            return false;
        }
        if (Array.isArray(value)) {
            return value.length > 0;
        }
        if (value && typeof value === 'object') {
            return Object.keys(value as Record<string, unknown>).length > 0;
        }
        return value !== undefined;
    });

    if (!hasMeaningfulKeys) {
        delete currentConfig.plugins;
    }
}

function resolveDefaultAgentId(currentConfig: OpenClawConfig): string | null {
    const entries = Array.isArray(currentConfig.agents?.list) ? currentConfig.agents.list : [];
    const defaultEntry = entries.find((entry) => entry?.id && entry.default === true);
    if (typeof defaultEntry?.id === 'string' && defaultEntry.id.trim()) {
        return defaultEntry.id.trim();
    }
    const mainEntry = entries.find((entry) => entry?.id === 'main');
    if (typeof mainEntry?.id === 'string' && mainEntry.id.trim()) {
        return mainEntry.id.trim();
    }
    const firstEntry = entries.find((entry) => typeof entry?.id === 'string' && entry.id.trim());
    if (typeof firstEntry?.id === 'string' && firstEntry.id.trim()) {
        return firstEntry.id.trim();
    }
    return 'main';
}

function isSimpleChannelBinding(binding: unknown): binding is NonNullable<OpenClawConfig['bindings']>[number] {
    if (!binding || typeof binding !== 'object') return false;
    const candidate = binding as NonNullable<OpenClawConfig['bindings']>[number];
    if (typeof candidate.agentId !== 'string' || !candidate.agentId.trim()) return false;
    if (!candidate.match || typeof candidate.match !== 'object' || Array.isArray(candidate.match)) return false;
    const keys = Object.keys(candidate.match);
    return keys.every((key) => key === 'channel' || key === 'accountId')
        && typeof candidate.match.channel === 'string'
        && Boolean(candidate.match.channel.trim())
        && (
            candidate.match.accountId === undefined
            || (typeof candidate.match.accountId === 'string' && Boolean(candidate.match.accountId.trim()))
        );
}

function makeBindingAccountKey(channelType: string, accountId?: string | null): string {
    const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : 'default';
    return `${toRuntimeChannelType(channelType)}:${normalizedAccountId}`;
}

function ensureDefaultBindingsForConfiguredChannels(currentConfig: OpenClawConfig): boolean {
    const defaultAgentId = resolveDefaultAgentId(currentConfig);
    if (!defaultAgentId) {
        return false;
    }

    const bindings = Array.isArray(currentConfig.bindings) ? [...currentConfig.bindings] : [];
    const typeOwners = new Set<string>();
    const accountOwners = new Set<string>();
    for (const binding of bindings) {
        if (!isSimpleChannelBinding(binding)) continue;
        const channelType = toRuntimeChannelType(binding.match?.channel || '');
        if (!channelType) continue;
        if (typeof binding.match?.accountId === 'string' && binding.match.accountId.trim()) {
            accountOwners.add(makeBindingAccountKey(channelType, binding.match.accountId));
        } else {
            typeOwners.add(channelType);
        }
    }

    let changed = false;
    const groups = listConfiguredChannelGroupsFromConfig(currentConfig, { includeCli: false });
    for (const group of groups) {
        const runtimeChannelType = toRuntimeChannelType(group.type);
        if (typeOwners.has(runtimeChannelType)) {
            continue;
        }
        for (const account of group.accounts) {
            if (!account.configured) continue;
            const accountKey = makeBindingAccountKey(runtimeChannelType, account.accountId);
            if (accountOwners.has(accountKey)) {
                continue;
            }
            bindings.push({
                agentId: defaultAgentId,
                match: {
                    channel: runtimeChannelType,
                    accountId: account.accountId || 'default',
                },
            });
            accountOwners.add(accountKey);
            changed = true;
        }
    }

    if (changed) {
        currentConfig.bindings = bindings;
    }
    return changed;
}

function ensureConfiguredBuiltInChannelsAllowed(currentConfig: OpenClawConfig): boolean {
    if (!currentConfig.plugins || !Array.isArray(currentConfig.plugins.allow)) {
        return false;
    }

    const allow = currentConfig.plugins.allow as string[];
    const nextAllow = [...allow];
    for (const channelType of BUILTIN_CHANNEL_ALLOWLIST_IDS) {
        if (!hasConfiguredChannelState(channelType, currentConfig.channels?.[channelType] as AccountScopedChannelSection | undefined)) {
            continue;
        }
        if (!nextAllow.includes(channelType)) {
            nextAllow.push(channelType);
        }
    }

    if (nextAllow.length === allow.length) {
        return false;
    }
    currentConfig.plugins.allow = nextAllow;
    return true;
}

function hasConfiguredChinaManagedChannel(currentConfig: OpenClawConfig): boolean {
    return CHINA_CHANNEL_TYPES.some((channelType) =>
        hasConfiguredChannelState(channelType, currentConfig.channels?.[channelType] as AccountScopedChannelSection | undefined),
    );
}

async function resolveFeishuPluginId(): Promise<string> {
    const extensionRoot = join(resolveOpenClawDir(), 'extensions');
    for (const dirName of FEISHU_PLUGIN_ID_CANDIDATES) {
        const manifestPath = join(extensionRoot, dirName, 'openclaw.plugin.json');
        try {
            const raw = await readFile(manifestPath, 'utf-8');
            const parsed = JSON.parse(raw) as { id?: unknown };
            if (typeof parsed.id === 'string' && parsed.id.trim()) {
                return parsed.id.trim();
            }
        } catch {
            // ignore and try next candidate
        }
    }
    return FEISHU_PLUGIN_ID_CANDIDATES[0];
}

async function getWeChatAccountStatePaths(accountId: string): Promise<string[]> {
    const normalizedAccountId = normalizeOpenClawAccountId(accountId);
    const weChatStateDir = join(resolveOpenClawDir(), WECHAT_RUNTIME_CHANNEL_ID);
    const weChatAccountsDir = join(weChatStateDir, 'accounts');
    const credentialsDir = join(resolveOpenClawDir(), 'credentials');
    const scopedCredentialsDir = join(resolveOpenClawDir(), 'credentials', WECHAT_RUNTIME_CHANNEL_ID);
    const paths = new Set<string>();

    for (const fileName of [
        `${normalizedAccountId}.json`,
        `${normalizedAccountId}.sync.json`,
        `${normalizedAccountId}.context-tokens.json`,
    ]) {
        paths.add(join(weChatAccountsDir, fileName));
    }

    try {
        if (await fileExists(credentialsDir)) {
            const candidates = await readdir(credentialsDir);
            for (const name of candidates) {
                if (
                    name.startsWith('openclaw-weixin-')
                    && name.endsWith('-allowFrom.json')
                    && name.includes(normalizedAccountId)
                ) {
                    paths.add(join(credentialsDir, name));
                }
            }
        }
    } catch {
        // Ignore staging enumeration failures.
    }

    try {
        if (await fileExists(scopedCredentialsDir)) {
            const candidates = await readdir(scopedCredentialsDir);
            for (const name of candidates) {
                if (name.includes(normalizedAccountId)) {
                    paths.add(join(scopedCredentialsDir, name));
                }
            }
        }
    } catch {
        // Ignore staging enumeration failures.
    }

    return [...paths];
}

async function removeWeChatAccountState(accountId: string): Promise<void> {
    const normalizedAccountId = normalizeOpenClawAccountId(accountId);
    const weChatStateDir = join(resolveOpenClawDir(), WECHAT_RUNTIME_CHANNEL_ID);
    const weChatAccountsDir = join(weChatStateDir, 'accounts');
    const accountFilePrefixes = [
        `${normalizedAccountId}.json`,
        `${normalizedAccountId}.sync.json`,
        `${normalizedAccountId}.context-tokens.json`,
    ];

    try {
        if (await fileExists(weChatAccountsDir)) {
            await Promise.all(
                accountFilePrefixes.map(async (fileName) => {
                    const filePath = join(weChatAccountsDir, fileName);
                    try {
                        await rm(filePath, { force: true });
                    } catch (error) {
                        console.error(`Failed to delete WeChat account state ${filePath}:`, error);
                    }
                }),
            );
        }
    } catch (error) {
        console.error('Failed to delete WeChat account files:', error);
    }

    try {
        const accountIndexPath = join(weChatStateDir, 'accounts.json');
        if (await fileExists(accountIndexPath)) {
            const raw = await readFile(accountIndexPath, 'utf-8').catch(() => '');
            const parsed = raw ? JSON.parse(raw) : [];
            const accountIds = Array.isArray(parsed)
                ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
                : [];
            const nextAccountIds = accountIds.filter((entry) => normalizeOpenClawAccountId(entry) !== normalizedAccountId);
            if (nextAccountIds.length > 0) {
                await writeFile(accountIndexPath, `${JSON.stringify(nextAccountIds, null, 2)}\n`, 'utf-8');
            } else {
                await rm(accountIndexPath, { force: true });
            }
        }
    } catch (error) {
        console.error('Failed to update WeChat account index:', error);
    }

    try {
        const credentialsDir = join(resolveOpenClawDir(), 'credentials');
        if (await fileExists(credentialsDir)) {
            const candidates = await readdir(credentialsDir);
            await Promise.all(
                candidates
                    .filter((name) =>
                        name.startsWith('openclaw-weixin-') &&
                        name.endsWith('-allowFrom.json') &&
                        name.includes(normalizedAccountId),
                    )
                    .map(async (name) => {
                        try {
                            await rm(join(credentialsDir, name), { force: true });
                        } catch (error) {
                            console.error(`Failed to delete scoped WeChat allowFrom file ${name}:`, error);
                        }
                    }),
            );
        }
    } catch (error) {
        console.error('Failed to delete scoped WeChat allowFrom files:', error);
    }

    try {
        const scopedCredentialsDir = join(resolveOpenClawDir(), 'credentials', WECHAT_RUNTIME_CHANNEL_ID);
        if (await fileExists(scopedCredentialsDir)) {
            const candidates = await readdir(scopedCredentialsDir);
            await Promise.all(
                candidates
                    .filter((name) => name.includes(normalizedAccountId))
                    .map(async (name) => {
                        try {
                            await rm(join(scopedCredentialsDir, name), { recursive: true, force: true });
                        } catch (error) {
                            console.error(`Failed to delete scoped WeChat credential ${name}:`, error);
                        }
                    }),
            );
        }
    } catch (error) {
        console.error('Failed to delete scoped WeChat credentials:', error);
    }

    try {
        if (await fileExists(weChatAccountsDir)) {
            const remainingAccountFiles = await readdir(weChatAccountsDir);
            if (remainingAccountFiles.length === 0) {
                await rm(weChatAccountsDir, { recursive: true, force: true });
            }
        }
        if (await fileExists(weChatStateDir)) {
            const remainingEntries = await readdir(weChatStateDir);
            if (remainingEntries.length === 0) {
                await rm(weChatStateDir, { recursive: true, force: true });
            }
        }
    } catch (error) {
        console.error('Failed to compact WeChat state directories:', error);
    }
}

async function hasPersistedWeChatAccountState(): Promise<boolean> {
    const weChatStateDir = join(resolveOpenClawDir(), WECHAT_RUNTIME_CHANNEL_ID);
    const weChatAccountsDir = join(weChatStateDir, 'accounts');
    const accountIndexPath = join(weChatStateDir, 'accounts.json');

    try {
        if (await fileExists(accountIndexPath)) {
            const raw = await readFile(accountIndexPath, 'utf-8').catch(() => '');
            const parsed = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed) && parsed.some((entry) => typeof entry === 'string' && entry.trim().length > 0)) {
                return true;
            }
        }
    } catch {
        // Ignore malformed index content and fall back to scanning account files.
    }

    try {
        if (await fileExists(weChatAccountsDir)) {
            const candidates = await readdir(weChatAccountsDir);
            if (candidates.some((name) => name.endsWith('.json'))) {
                return true;
            }
        }
    } catch {
        // Ignore directory scan failures and treat as no persisted state.
    }

    return false;
}

function toQQBotSessionFileName(accountId: string): string {
    const safeId = accountId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `session-${safeId}.json`;
}

function decodeQQBotSessionFileAccountId(fileName: string): string | null {
    if (!fileName.startsWith('session-') || !fileName.endsWith('.json')) {
        return null;
    }
    const rawId = fileName.slice('session-'.length, -'.json'.length);
    if (!rawId) {
        return null;
    }
    try {
        const decoded = Buffer.from(rawId, 'base64').toString('utf8').trim();
        if (/^[a-zA-Z0-9_-]+$/.test(decoded)) {
            return decoded;
        }
    } catch {
        // Fall back to the file-name id below.
    }
    return rawId;
}

async function discoverQQBotSessionAccountIds(): Promise<string[]> {
    const sessionsDir = join(resolveOpenClawDir(), 'qqbot', 'sessions');
    const accountIds = new Set<string>();
    try {
        if (!(await fileExists(sessionsDir))) {
            return [];
        }
        const entries = await readdir(sessionsDir);
        for (const entry of entries) {
            if (!entry.endsWith('.json')) continue;
            const filePath = join(sessionsDir, entry);
            try {
                const raw = await readFile(filePath, 'utf8');
                const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
                const accountId = typeof parsed.accountId === 'string' && parsed.accountId.trim()
                    ? parsed.accountId.trim()
                    : decodeQQBotSessionFileAccountId(entry);
                if (accountId) {
                    accountIds.add(accountId);
                }
            } catch {
                const accountId = decodeQQBotSessionFileAccountId(entry);
                if (accountId) {
                    accountIds.add(accountId);
                }
            }
        }
    } catch {
        return [];
    }
    return Array.from(accountIds).sort();
}

async function getQQBotAccountStatePaths(accountId?: string): Promise<string[]> {
    if (!accountId) {
        return [join(resolveOpenClawDir(), 'qqbot', 'sessions')];
    }
    const sessionsDir = join(resolveOpenClawDir(), 'qqbot', 'sessions');
    const paths = new Set<string>([join(sessionsDir, toQQBotSessionFileName(accountId))]);
    try {
        if (!(await fileExists(sessionsDir))) {
            return Array.from(paths);
        }
        const entries = await readdir(sessionsDir);
        for (const entry of entries) {
            if (!entry.endsWith('.json')) continue;
            const filePath = join(sessionsDir, entry);
            const decodedId = decodeQQBotSessionFileAccountId(entry);
            if (decodedId === accountId) {
                paths.add(filePath);
                continue;
            }
            try {
                const raw = await readFile(filePath, 'utf8');
                const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
                if (parsed.accountId === accountId) {
                    paths.add(filePath);
                }
            } catch {
                // Ignore malformed session files while still deleting known paths.
            }
        }
    } catch {
        // Ignore scan failures while still deleting the deterministic path.
    }
    return Array.from(paths);
}

export async function migrateQQBotSessionAccountsToConfig(): Promise<boolean> {
    const sessionAccountIds = await discoverQQBotSessionAccountIds();
    if (sessionAccountIds.length === 0) {
        return false;
    }

    let changed = false;
    await updateOpenClawConfig(async (currentConfig) => {
        migrateLegacyWechatSection(currentConfig);
        const section = normalizeChannelSectionForRuntime(
            'qqbot',
            currentConfig.channels?.qqbot as AccountScopedChannelSection | undefined,
        );
        if (!section || section.enabled === false || !hasMeaningfulSectionConfig(section)) {
            return false;
        }

        const topLevelConfig = extractAccountScopedTopLevelConfig('qqbot', section);
        if (!hasMeaningfulSectionConfig(topLevelConfig)) {
            return false;
        }

        const accounts = { ...(section.accounts || {}) };
        for (const accountId of sessionAccountIds) {
            const existingAccount = accounts[accountId] as ChannelConfigData | undefined;
            if (hasConfiguredAccountConfig('qqbot', existingAccount)) {
                continue;
            }
            accounts[accountId] = {
                ...topLevelConfig,
                enabled: true,
            };
            changed = true;
        }

        if (!changed) {
            return false;
        }

        currentConfig.channels = {
            ...(currentConfig.channels || {}),
            qqbot: normalizeChannelSectionForRuntime('qqbot', {
                ...section,
                accounts,
                defaultAccount: section.defaultAccount || (accounts.default ? 'default' : sessionAccountIds[0]),
            }) || {
                ...section,
                accounts,
                defaultAccount: section.defaultAccount || (accounts.default ? 'default' : sessionAccountIds[0]),
            },
        };
        return true;
    }, NO_RESTART_CONFIG_WRITE);

    return changed;
}

export async function ensureDefaultChannelBindings(): Promise<boolean> {
    const snapshot = await readOpenClawConfigSnapshot();
    migrateLegacyWechatSection(snapshot);
    if (!ensureDefaultBindingsForConfiguredChannels(snapshot)) {
        return false;
    }

    let changed = false;
    await updateOpenClawConfig(async (currentConfig) => {
        migrateLegacyWechatSection(currentConfig);
        changed = ensureDefaultBindingsForConfiguredChannels(currentConfig);
        return changed;
    }, NO_RESTART_CONFIG_WRITE);
    return changed;
}

async function compactDirectoryIfEmpty(targetDir: string): Promise<void> {
    try {
        if (!(await fileExists(targetDir))) {
            return;
        }
        const entries = await readdir(targetDir);
        if (entries.length === 0) {
            await rm(targetDir, { recursive: true, force: true });
        }
    } catch (error) {
        console.error(`Failed to compact directory ${targetDir}:`, error);
    }
}

async function removeQQBotAccountState(accountId?: string): Promise<void> {
    const qqbotDir = join(resolveOpenClawDir(), 'qqbot');
    const sessionsDir = join(qqbotDir, 'sessions');

    try {
        if (!(await fileExists(sessionsDir))) {
            return;
        }

        if (accountId) {
            await rm(join(sessionsDir, toQQBotSessionFileName(accountId)), { force: true });
        } else {
            await rm(sessionsDir, { recursive: true, force: true });
        }
    } catch (error) {
        console.error('Failed to delete QQ Bot session state:', error);
    }

    await compactDirectoryIfEmpty(sessionsDir);
    await compactDirectoryIfEmpty(qqbotDir);
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
    agents?: {
        list?: Array<{
            id?: string;
            default?: boolean;
            [key: string]: unknown;
        }>;
        [key: string]: unknown;
    };
    bindings?: Array<{
        agentId?: string;
        match?: {
            channel?: string;
            accountId?: string;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    }>;
    [key: string]: unknown;
}

function cloneConfigRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
}

function cloneConfigStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
        return null;
    }
    const items = value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0);
    return items.length > 0 ? items : null;
}

function buildDiscordChannelConfig(existingValue: unknown): Record<string, unknown> {
    return {
        ...cloneConfigRecord(existingValue),
        allow: true,
        requireMention: true,
    };
}

function transformDiscordChannelConfig(
    config: ChannelConfigData,
    existingConfig: ChannelConfigData | undefined,
): ChannelConfigData {
    const { guildId, channelId, ...restConfig } = config;
    const transformedConfig: ChannelConfigData = { ...restConfig };
    const existingDiscordConfig = existingConfig || {};
    const existingGuilds = cloneConfigRecord(existingDiscordConfig.guilds);

    transformedConfig.groupPolicy =
        typeof existingDiscordConfig.groupPolicy === 'string'
            ? existingDiscordConfig.groupPolicy
            : 'allowlist';

    const existingDm = cloneConfigRecord(existingDiscordConfig.dm);
    transformedConfig.dm =
        Object.keys(existingDm).length > 0
            ? {
                ...existingDm,
                enabled:
                    typeof existingDm.enabled === 'boolean'
                        ? existingDm.enabled
                        : false,
            }
            : { enabled: false };

    const existingRetry = cloneConfigRecord(existingDiscordConfig.retry);
    transformedConfig.retry =
        Object.keys(existingRetry).length > 0
            ? existingRetry
            : {
                attempts: 3,
                minDelayMs: 500,
                maxDelayMs: 30000,
                jitter: 0.1,
            };

    const normalizedGuildId = typeof guildId === 'string' ? guildId.trim() : '';
    const normalizedChannelId = typeof channelId === 'string' ? channelId.trim() : '';
    if (!normalizedGuildId) {
        if (Object.keys(existingGuilds).length > 0) {
            transformedConfig.guilds = existingGuilds;
        }
        return transformedConfig;
    }

    const existingGuildConfig = cloneConfigRecord(existingGuilds[normalizedGuildId]);
    const nextGuildConfig: Record<string, unknown> = {
        ...existingGuildConfig,
        users: cloneConfigStringArray(existingGuildConfig.users) ?? ['*'],
        requireMention:
            typeof existingGuildConfig.requireMention === 'boolean'
                ? existingGuildConfig.requireMention
                : true,
    };

    if (normalizedChannelId) {
        const existingChannels = cloneConfigRecord(existingGuildConfig.channels);
        nextGuildConfig.channels = {
            [normalizedChannelId]: buildDiscordChannelConfig(existingChannels[normalizedChannelId]),
        };
    } else {
        const existingChannels = cloneConfigRecord(existingGuildConfig.channels);
        nextGuildConfig.channels =
            Object.keys(existingChannels).length > 0
                ? existingChannels
                : { '*': buildDiscordChannelConfig(undefined) };
    }

    transformedConfig.guilds = {
        ...existingGuilds,
        [normalizedGuildId]: nextGuildConfig,
    };
    return transformedConfig;
}

function transformTelegramChannelConfig(
    config: ChannelConfigData,
    existingConfig: ChannelConfigData | undefined,
): ChannelConfigData {
    const { allowedUsers, ...restConfig } = config;
    const transformedConfig: ChannelConfigData = { ...restConfig };
    if (typeof allowedUsers === 'string') {
        const users = allowedUsers
            .split(',')
            .map((user) => user.trim())
            .filter((user) => user.length > 0);

        if (users.length > 0) {
            transformedConfig.allowFrom = users;
        } else if (Array.isArray(existingConfig?.allowFrom)) {
            transformedConfig.allowFrom = [...existingConfig.allowFrom];
        }
    } else if (Array.isArray(existingConfig?.allowFrom)) {
        transformedConfig.allowFrom = [...existingConfig.allowFrom];
    }

    return transformedConfig;
}

function cloneConfigCommands(config: OpenClawConfig): Record<string, unknown> {
    return config.commands && typeof config.commands === 'object'
        ? { ...(config.commands as Record<string, unknown>) }
        : {};
}

function applyRestartCommand(
    config: OpenClawConfig,
    options?: OpenClawConfigWriteOptions,
): void {
    const commands = cloneConfigCommands(config);
    if (options?.requestRestart === false) {
        delete commands.restart;
        if (Object.keys(commands).length > 0) {
            config.commands = commands;
        } else {
            delete config.commands;
        }
        return;
    }

    commands.restart = true;
    config.commands = commands;
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

function hasConfiguredNamedAccounts(
    channelType: string,
    section: AccountScopedChannelSection | undefined
): boolean {
    return resolveConfiguredAccounts(section).some(
        ({ accountId, config: accountConfig }) =>
            accountId !== 'default' && hasConfiguredAccountConfig(channelType, accountConfig),
    );
}

function stripChannelSectionScaffolding(
    value: ChannelConfigData | undefined
): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
        return {};
    }
    return Object.fromEntries(
        Object.entries(value).filter(([key]) => !['enabled', 'name', 'accounts', 'defaultAccount'].includes(key))
    );
}

function hasMeaningfulSectionConfig(value: ChannelConfigData | undefined): boolean {
    return Object.keys(stripChannelSectionScaffolding(value)).length > 0;
}

function hasConfiguredAccountConfig(
    channelType: string,
    accountConfig: ChannelConfigData | undefined
): boolean {
    if (!accountConfig || accountConfig.enabled === false) {
        return false;
    }

    if (isWeChatRuntimeChannel(channelType) || channelType === 'whatsapp') {
        return true;
    }

    return hasMeaningfulSectionConfig(accountConfig);
}

function isImplicitlyConfiguredChannel(
    channelType: string,
    section: AccountScopedChannelSection | undefined
): boolean {
    return (channelType === WECHAT_RUNTIME_CHANNEL_ID || channelType === 'whatsapp') && section?.enabled !== false;
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

    if (normalizedPreferredAccountId && section?.accounts?.[normalizedPreferredAccountId]) {
        return { kind: 'account', accountId: normalizedPreferredAccountId };
    }

    if (
        normalizedPreferredAccountId === 'default' &&
        hasMeaningfulSectionConfig(section)
    ) {
        return { kind: 'top-level' };
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

function getAccountScopedTopLevelKeys(
    channelType: string,
    section: AccountScopedChannelSection
): string[] {
    return Object.entries(section)
        .filter(([key, value]) => key !== 'accounts' && value !== undefined)
        .filter(([key]) => !isSharedChannelSectionKey(channelType, key))
        .map(([key]) => key);
}

function extractAccountScopedTopLevelConfig(
    channelType: string,
    section: AccountScopedChannelSection
): ChannelConfigData {
    return Object.fromEntries(
        getAccountScopedTopLevelKeys(channelType, section)
            .map((key) => [key, section[key]])
            .filter(([, value]) => value !== undefined),
    );
}

function mirrorDefaultAccountConfigToTopLevel(
    channelType: string,
    section: AccountScopedChannelSection
): AccountScopedChannelSection {
    if (!TOP_LEVEL_DEFAULT_ACCOUNT_MIRROR_CHANNELS.has(channelType)) {
        return section;
    }

    const accounts = section.accounts;
    if (!accounts || typeof accounts !== 'object') {
        return section;
    }

    const defaultAccountId =
        typeof section.defaultAccount === 'string' && section.defaultAccount.trim()
            ? section.defaultAccount.trim()
            : 'default';
    const defaultAccountConfig = accounts[defaultAccountId] || accounts.default;
    if (!defaultAccountConfig || typeof defaultAccountConfig !== 'object') {
        return section;
    }

    let changed = false;
    const nextSection: AccountScopedChannelSection = { ...section };
    for (const [key, value] of Object.entries(defaultAccountConfig)) {
        if (value === undefined || isSharedChannelSectionKey(channelType, key)) {
            continue;
        }
        if (!(key in nextSection)) {
            nextSection[key] = value;
            changed = true;
        }
    }

    return changed ? nextSection : section;
}

function normalizeFeishuSection(
    section: AccountScopedChannelSection | undefined
): AccountScopedChannelSection | undefined {
    if (!section || typeof section !== 'object') {
        return section;
    }

    const hasNamedAccounts = resolveConfiguredAccounts(section).some(
        ({ accountId, config }) => accountId !== 'default' && hasConfiguredAccountConfig('feishu', config),
    );
    if (!hasNamedAccounts) {
        return section;
    }

    const topLevelAccountConfig = extractAccountScopedTopLevelConfig('feishu', section);
    if (Object.keys(topLevelAccountConfig).length === 0) {
        return section;
    }

    const nextAccounts = { ...(section.accounts || {}) };
    nextAccounts.default = {
        ...(nextAccounts.default || {}),
        ...topLevelAccountConfig,
        enabled: (nextAccounts.default as ChannelConfigData | undefined)?.enabled ?? section.enabled ?? true,
    };

    const nextSection = clearTopLevelAccountFields('feishu', {
        ...section,
        accounts: nextAccounts,
        defaultAccount:
            typeof section.defaultAccount === 'string' && section.defaultAccount.trim()
                ? section.defaultAccount
                : 'default',
    });

    if (!nextSection.defaultAccount) {
        nextSection.defaultAccount = 'default';
    }

    return nextSection;
}

function getConfiguredAccountIds(
    channelType: string,
    section: AccountScopedChannelSection | undefined
): string[] {
    if (!section || section.enabled === false) {
        return [];
    }

    const accountIds = resolveConfiguredAccounts(section)
        .filter(({ accountId }) => accountId !== 'default')
        .filter(({ config }) => hasConfiguredAccountConfig(channelType, config))
        .map(({ accountId }) => accountId);

    if (
        hasConfiguredAccountConfig(channelType, section.accounts?.default as ChannelConfigData | undefined)
        ||
        getAccountScopedTopLevelKeys(channelType, section).length > 0
        || isImplicitlyConfiguredChannel(channelType, section)
    ) {
        accountIds.unshift('default');
    }

    return Array.from(new Set(accountIds));
}

function normalizeChannelSectionForRuntime(
    channelType: string,
    section: AccountScopedChannelSection | undefined
): AccountScopedChannelSection | undefined {
    let nextSection = channelType === 'feishu'
        ? normalizeFeishuSection(section)
        : section;
    if (!nextSection || typeof nextSection !== 'object') {
        return nextSection;
    }

    nextSection = mirrorDefaultAccountConfigToTopLevel(channelType, nextSection);
    if (CHANNELS_OMIT_DEFAULT_ACCOUNT_KEY.has(channelType) && 'defaultAccount' in nextSection) {
        const strippedSection = { ...nextSection };
        delete strippedSection.defaultAccount;
        return strippedSection;
    }
    return nextSection;
}

function hasConfiguredChannelState(
    channelType: string,
    section: AccountScopedChannelSection | undefined
): boolean {
    return getConfiguredAccountIds(channelType, section).length > 0;
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

export async function readOpenClawConfig(): Promise<OpenClawConfig> {
    try {
        const draftConfig = getChannelDraftConfigSnapshot<OpenClawConfig>();
        if (draftConfig) {
            return draftConfig;
        }
        return await readOpenClawConfigRecord<OpenClawConfig>();
    } catch (error) {
        logger.error('Failed to read OpenClaw config', error);
        console.error('Failed to read OpenClaw config:', error);
        return {};
    }
}

export async function readOpenClawConfigSnapshot(): Promise<OpenClawConfig> {
    try {
        const draftConfig = getChannelDraftConfigSnapshot<OpenClawConfig>();
        if (draftConfig) {
            return draftConfig;
        }
        return await readOpenClawConfigRecordRaw<OpenClawConfig>();
    } catch (error) {
        logger.error('Failed to read OpenClaw config snapshot', error);
        console.error('Failed to read OpenClaw config snapshot:', error);
        return {};
    }
}

export async function writeOpenClawConfig(config: OpenClawConfig): Promise<void> {
    try {
        // Read current content BEFORE sanitization so we can compare the true before/after.
        const currentConfig = await readOpenClawConfigRecordRaw().catch(() => null);

        sanitizeKnownInvalidOpenClawKeys(config as unknown as Record<string, unknown>);

        // Only set commands.restart = true if the config content actually changed.
        const nextContent = JSON.stringify(config, null, 2);
        const currentContent = currentConfig ? JSON.stringify(currentConfig, null, 2) : null;

        if (currentContent !== nextContent) {
            applyRestartCommand(config);
        }

        await writeOpenClawConfigRecord(config as unknown as Record<string, unknown>);
    } catch (error) {
        logger.error('Failed to write OpenClaw config', error);
        console.error('Failed to write OpenClaw config:', error);
        throw error;
    }
}

export async function updateOpenClawConfig<T>(
    updater: (config: OpenClawConfig) => Promise<T> | T,
    options?: OpenClawConfigWriteOptions,
): Promise<T> {
    const result = await updateOpenClawConfigRecord(async (config) => {
        const typedConfig = config as OpenClawConfig;
        const updaterResult = await updater(typedConfig);
        if (updaterResult === false) {
            // No changes — skip writing commands.restart so the gateway is not
            // spuriously restarted on every preflight repair run.
            return updaterResult;
        }

        sanitizeKnownInvalidOpenClawKeys(typedConfig as unknown as Record<string, unknown>);
        applyRestartCommand(typedConfig, options);

        return updaterResult;
    });
    return result;
}

// ── Channel operations ───────────────────────────────────────────

export async function saveChannelConfig(
    channelType: string,
    config: ChannelConfigData
): Promise<void> {
    await beginChannelDraftSession();
    const runtimeChannelType = toRuntimeChannelType(channelType);
    const removedWeChatAccountIds = new Set<string>();
    const preferredAccountId =
        typeof config.__accountId === 'string' && config.__accountId.trim()
            ? config.__accountId.trim()
            : undefined;

    await updateChannelDraftConfig(async (currentConfig) => {
        migrateLegacyWechatSection(currentConfig);

        if (isChinaChannelsManagedChannel(runtimeChannelType)) {
            ensurePluginEnabled(currentConfig, CHINA_CHANNEL_PLUGIN_IDS[runtimeChannelType], {
                createEntry: true,
                createAllowlist: true,
            });
            removePluginIds(currentConfig, getLegacyChannelPluginIds(runtimeChannelType));
        }

        if (runtimeChannelType === 'feishu') {
            const feishuPluginId = await resolveFeishuPluginId();
            removePluginIds(
                currentConfig,
                FEISHU_PLUGIN_ID_CANDIDATES.filter((pluginId) => pluginId !== feishuPluginId),
            );
            ensurePluginEnabled(currentConfig, feishuPluginId, {
                createEntry: true,
                createAllowlist: true,
            });
        }

        if (runtimeChannelType === WECHAT_RUNTIME_CHANNEL_ID) {
            ensurePluginEnabled(currentConfig, WECHAT_RUNTIME_CHANNEL_ID, {
                createEntry: true,
                createAllowlist: true,
            });
        }

        // Plugin-based channels (e.g. WhatsApp) go under plugins.entries, not channels.
        if (PLUGIN_CHANNELS.includes(runtimeChannelType)) {
            if (!currentConfig.plugins) {
                currentConfig.plugins = {};
            }
            if (!currentConfig.plugins.entries) {
                currentConfig.plugins.entries = {};
            }
            currentConfig.plugins.entries[runtimeChannelType] = {
                ...currentConfig.plugins.entries[runtimeChannelType],
                enabled: config.enabled ?? true,
            };
            logger.info('Plugin channel config saved', {
                channelType: runtimeChannelType,
                configFile: CONFIG_FILE,
                path: `plugins.entries.${runtimeChannelType}`,
            });
            console.log(`Saved plugin channel config for ${runtimeChannelType}`);
            return;
        }

        if (!currentConfig.channels) {
            currentConfig.channels = {};
        }

        const existingSection = normalizeChannelSectionForRuntime(
            runtimeChannelType,
            currentConfig.channels[runtimeChannelType] as AccountScopedChannelSection | undefined,
        ) || {};

        const normalizedPreferredAccountId =
            typeof preferredAccountId === 'string' && preferredAccountId.trim()
                ? preferredAccountId.trim()
                : '';

        const editableSource =
            normalizedPreferredAccountId && normalizedPreferredAccountId !== 'default'
                ? { kind: 'account' as const, accountId: normalizedPreferredAccountId }
                : resolveEditableChannelSource(currentConfig, runtimeChannelType, preferredAccountId);

        const existingEditableConfig =
            editableSource.kind === 'account'
                ? ((existingSection.accounts || {})[editableSource.accountId] as ChannelConfigData | undefined)
                : existingSection;

        // Transform config to match OpenClaw expected format.
        let transformedConfig: ChannelConfigData = { ...config };
        delete transformedConfig.__accountId;

        if (runtimeChannelType === 'discord') {
            transformedConfig = transformDiscordChannelConfig(config, existingEditableConfig);
        }

        if (runtimeChannelType === 'telegram') {
            transformedConfig = transformTelegramChannelConfig(config, existingEditableConfig);
        }

        if (runtimeChannelType === 'feishu' || runtimeChannelType === 'wecom') {
            const existingConfig = existingEditableConfig || currentConfig.channels[runtimeChannelType] || {};
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

        if (editableSource.kind === 'account') {
            const accounts = { ...(existingSection.accounts || {}) };
            const existingAccount = (accounts[editableSource.accountId] as ChannelConfigData | undefined) || {};
            const nextAccountConfig: ChannelConfigData = {
                ...existingAccount,
                ...transformedConfig,
                enabled: transformedConfig.enabled ?? true,
            };
            const nextAccounts =
                isWeChatRuntimeChannel(runtimeChannelType)
                    ? { [editableSource.accountId]: nextAccountConfig }
                    : {
                        ...accounts,
                        [editableSource.accountId]: nextAccountConfig,
                    };

            if (isWeChatRuntimeChannel(runtimeChannelType)) {
                for (const existingAccountId of Object.keys(accounts)) {
                    if (existingAccountId !== editableSource.accountId) {
                        removedWeChatAccountIds.add(existingAccountId);
                    }
                }
            }

            let nextSection: AccountScopedChannelSection = {
                ...existingSection,
                enabled: transformedConfig.enabled ?? true,
                accounts: nextAccounts,
            };

            if (
                runtimeChannelType !== 'feishu'
                && hasMeaningfulSectionConfig(existingSection)
                && configsShareComparableValues(existingSection, nextAccountConfig)
            ) {
                nextSection = removeTopLevelCredentialFields(nextSection);
                if (!nextSection.defaultAccount && Object.keys(nextAccounts).length === 1) {
                    nextSection.defaultAccount = editableSource.accountId;
                }
            }

            if (
                !nextSection.defaultAccount
                && !hasMeaningfulSectionConfig(existingSection)
                && Object.keys(nextAccounts).length === 1
            ) {
                nextSection.defaultAccount = editableSource.accountId;
            }

            if (isWeChatRuntimeChannel(runtimeChannelType)) {
                nextSection.defaultAccount = editableSource.accountId;
            }

            currentConfig.channels[runtimeChannelType] =
                normalizeChannelSectionForRuntime(runtimeChannelType, nextSection) || nextSection;
        } else {
            currentConfig.channels[runtimeChannelType] =
                normalizeChannelSectionForRuntime(runtimeChannelType, {
                    ...existingSection,
                    ...transformedConfig,
                    enabled: transformedConfig.enabled ?? true,
                }) || {
                    ...existingSection,
                    ...transformedConfig,
                    enabled: transformedConfig.enabled ?? true,
                };
        }

        logger.info('Channel config saved', {
            channelType: runtimeChannelType,
            configFile: CONFIG_FILE,
            rawKeys: Object.keys(config),
            transformedKeys: Object.keys(transformedConfig),
            enabled: currentConfig.channels[runtimeChannelType]?.enabled,
        });
        console.log(`Saved channel config for ${runtimeChannelType}`);
    });

    if (isWeChatRuntimeChannel(runtimeChannelType) && removedWeChatAccountIds.size > 0) {
        const stagedCleanupTargets = new Set<string>();
        for (const removedAccountId of removedWeChatAccountIds) {
            const statePaths = await getWeChatAccountStatePaths(removedAccountId);
            for (const filePath of statePaths) {
                stagedCleanupTargets.add(filePath);
            }
        }
        await stageChannelRemovedPaths(stagedCleanupTargets);
    }
}

export async function getChannelConfig(
    channelType: string,
    preferredAccountId?: string | null
): Promise<ChannelConfigData | undefined> {
    const runtimeChannelType = toRuntimeChannelType(channelType);
    const config = await readOpenClawConfig();
    migrateLegacyWechatSection(config);
    if (config.channels?.[runtimeChannelType]) {
        const section = normalizeChannelSectionForRuntime(
            runtimeChannelType,
            config.channels[runtimeChannelType] as AccountScopedChannelSection | undefined,
        );
        if (!section) return undefined;
        config.channels[runtimeChannelType] = section;
        const source = resolveEditableChannelSource(config, runtimeChannelType, preferredAccountId);
        if (source.kind === 'account') {
            return section.accounts?.[source.accountId];
        }
    }
    return config.channels?.[runtimeChannelType];
}

export async function getChannelFormValues(
    channelType: string,
    preferredAccountId?: string | null
): Promise<Record<string, string> | undefined> {
    const runtimeChannelType = toRuntimeChannelType(channelType);
    const config = await readOpenClawConfig();
    migrateLegacyWechatSection(config);
    if (config.channels?.[runtimeChannelType]) {
        config.channels[runtimeChannelType] = normalizeChannelSectionForRuntime(
            runtimeChannelType,
            config.channels[runtimeChannelType] as AccountScopedChannelSection | undefined,
        ) as ChannelConfigData;
    }
    const source = resolveEditableChannelSource(config, runtimeChannelType, preferredAccountId);
    const saved = await getChannelConfig(channelType, preferredAccountId);
    if (!saved) return undefined;

    const values: Record<string, string> = {};

    if (runtimeChannelType === 'discord') {
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
    } else if (runtimeChannelType === 'telegram') {
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
    await beginChannelDraftSession();
    const runtimeChannelType = toRuntimeChannelType(channelType);
    let deletedWeChatAccountId: string | undefined;
    let clearAllWeChatState = false;
    let removeChinaManagedPluginMirror = false;
    const configChanged = await updateChannelDraftConfig(async (currentConfig) => {
    migrateLegacyWechatSection(currentConfig);
    let changed = false;
    let removedScopedAccountId: string | undefined;

    if (currentConfig.channels?.[runtimeChannelType]) {
        const section = normalizeChannelSectionForRuntime(
            runtimeChannelType,
            currentConfig.channels[runtimeChannelType] as AccountScopedChannelSection | undefined,
        );
        if (section) {
            currentConfig.channels[runtimeChannelType] = section;
        }
        const source = resolveEditableChannelSource(currentConfig, runtimeChannelType, preferredAccountId);
        if (section && source.kind === 'account' && section.accounts?.[source.accountId]) {
            const accounts = { ...section.accounts };
            const accountConfig = accounts[source.accountId] as ChannelConfigData | undefined;
            delete accounts[source.accountId];
            removedScopedAccountId = source.accountId;
            const remainingAccounts = Object.keys(accounts);
            let nextSection: AccountScopedChannelSection = {
                ...section,
                ...(remainingAccounts.length > 0 ? { accounts } : {}),
            };
            if (remainingAccounts.length === 0) {
                delete nextSection.accounts;
            }
            if (nextSection.defaultAccount === source.accountId) {
                delete nextSection.defaultAccount;
            }
            if (configsShareComparableValues(section, accountConfig)) {
                nextSection = removeTopLevelCredentialFields(nextSection);
            }
            if (remainingAccounts.length === 0 && !hasMeaningfulSectionConfig(nextSection)) {
                delete currentConfig.channels[runtimeChannelType];
            } else {
                currentConfig.channels[runtimeChannelType] =
                    normalizeChannelSectionForRuntime(runtimeChannelType, nextSection) || nextSection;
            }
        } else {
            if (section?.accounts && Object.keys(section.accounts).length > 0) {
                const nextSection = clearTopLevelAccountFields(runtimeChannelType, section);
                if (nextSection.defaultAccount === 'default') {
                    delete nextSection.defaultAccount;
                }
                if (!nextSection.accounts || Object.keys(nextSection.accounts).length === 0) {
                    delete currentConfig.channels[runtimeChannelType];
                } else {
                    currentConfig.channels[runtimeChannelType] =
                        normalizeChannelSectionForRuntime(runtimeChannelType, nextSection) || nextSection;
                }
            } else {
                delete currentConfig.channels[runtimeChannelType];
            }
        }
        changed = true;
        console.log(`Deleted channel config for ${runtimeChannelType}`);
    }

    if (isWeChatRuntimeChannel(runtimeChannelType)) {
        deletedWeChatAccountId = removedScopedAccountId;
        clearAllWeChatState = !currentConfig.channels?.[runtimeChannelType];
    }

    if (PLUGIN_CHANNELS.includes(runtimeChannelType)) {
        if (currentConfig.plugins?.entries?.[runtimeChannelType]) {
            delete currentConfig.plugins.entries[runtimeChannelType];
            if (Object.keys(currentConfig.plugins.entries).length === 0) {
                delete currentConfig.plugins.entries;
            }
            if (currentConfig.plugins && Object.keys(currentConfig.plugins).length === 0) {
                delete currentConfig.plugins;
            }
            changed = true;
            console.log(`Deleted plugin channel config for ${runtimeChannelType}`);
        }
    }

    const hasRemainingChannelConfig =
        runtimeChannelType === 'feishu'
            ? hasConfiguredChannelState(
                runtimeChannelType,
                currentConfig.channels?.[runtimeChannelType] as AccountScopedChannelSection | undefined,
            )
            : Boolean(currentConfig.channels?.[runtimeChannelType]);

    const shouldRemovePluginAllowlist =
        isWeChatRuntimeChannel(runtimeChannelType)
            ? clearAllWeChatState
            : isChinaChannelsManagedChannel(runtimeChannelType)
                ? !hasConfiguredChinaManagedChannel(currentConfig)
                : !hasRemainingChannelConfig;
    if (shouldRemovePluginAllowlist) {
        const pluginAllowIds = [
            ...getChannelPluginAllowIds(runtimeChannelType),
            ...getLegacyChannelPluginIds(runtimeChannelType),
        ];
        if (removePluginIds(currentConfig, pluginAllowIds)) {
            changed = true;
        }
    }

    if (runtimeChannelType === 'feishu') {
        const feishuPluginId = await resolveFeishuPluginId();
        const staleFeishuPluginIds = FEISHU_PLUGIN_ID_CANDIDATES.filter((pluginId) => pluginId !== feishuPluginId);
        if (removePluginIds(currentConfig, staleFeishuPluginIds)) {
            changed = true;
        }
    }

    if (isChinaChannelsManagedChannel(runtimeChannelType)) {
        if (removePluginIds(currentConfig, getLegacyChannelPluginIds(runtimeChannelType))) {
            changed = true;
        }
    }

    if (runtimeChannelType === 'qqbot') {
        if (removePluginIds(currentConfig, QQBOT_LEGACY_PLUGIN_IDS)) {
            changed = true;
        }
        if (!hasConfiguredChinaManagedChannel(currentConfig)) {
            if (removePluginIds(currentConfig, [LEGACY_CHINA_CHANNEL_PLUGIN_ID, ...Object.values(CHINA_CHANNEL_PLUGIN_IDS)])) {
                changed = true;
            }
            removeChinaManagedPluginMirror = true;
        }
    }

    pruneEmptyPluginsConfig(currentConfig);

    return changed;
    });

    const stagedCleanupTargets = new Set<string>();

    if (configChanged && runtimeChannelType === 'whatsapp') {
        stagedCleanupTargets.add(join(resolveOpenClawDir(), 'credentials', 'whatsapp'));
    }

    if (configChanged && runtimeChannelType === 'qqbot') {
        for (const statePath of await getQQBotAccountStatePaths(preferredAccountId ?? undefined)) {
            stagedCleanupTargets.add(statePath);
        }
    }

    if (removeChinaManagedPluginMirror) {
        stagedCleanupTargets.add(join(EXTENSIONS_DIR, LEGACY_CHINA_CHANNEL_PLUGIN_ID));
    }

    if (isWeChatRuntimeChannel(runtimeChannelType) && clearAllWeChatState) {
        stagedCleanupTargets.add(join(resolveOpenClawDir(), 'openclaw-weixin'));
        stagedCleanupTargets.add(join(resolveOpenClawDir(), 'credentials', 'openclaw-weixin'));
        stagedCleanupTargets.add(join(resolveOpenClawDir(), 'agents', 'default', 'sessions', '.openclaw-weixin-sync'));
        stagedCleanupTargets.add(join(resolveOpenClawDir(), 'extensions', 'openclaw-weixin'));

        try {
            const credentialsDir = join(resolveOpenClawDir(), 'credentials');
            if (await fileExists(credentialsDir)) {
                const candidates = await readdir(credentialsDir);
                for (const name of candidates) {
                    if (name.startsWith('openclaw-weixin-') && name.endsWith('-allowFrom.json')) {
                        stagedCleanupTargets.add(join(credentialsDir, name));
                    }
                }
            }
        } catch (error) {
            console.error('Failed to enumerate WeChat allowFrom files for staged cleanup:', error);
        }
    } else if (isWeChatRuntimeChannel(runtimeChannelType) && deletedWeChatAccountId) {
        const statePaths = await getWeChatAccountStatePaths(deletedWeChatAccountId);
        for (const filePath of statePaths) {
            stagedCleanupTargets.add(filePath);
        }
    }

    await stageChannelRemovedPaths(stagedCleanupTargets);
}

export async function cleanupDanglingWeChatPluginState(): Promise<{ cleanedDanglingState: boolean }> {
    let cleanedDanglingState = false;
    const hasPersistedState = await hasPersistedWeChatAccountState();

    await updateOpenClawConfig(async (currentConfig) => {
        migrateLegacyWechatSection(currentConfig);
        const section = currentConfig.channels?.[WECHAT_RUNTIME_CHANNEL_ID] as AccountScopedChannelSection | undefined;
        const hasConfiguredWeChatAccounts =
            Boolean(section)
            && section.enabled !== false
            && (
                getAccountScopedTopLevelKeys(WECHAT_RUNTIME_CHANNEL_ID, section).length > 0
                || resolveConfiguredAccounts(section).some(({ config }) => hasConfiguredAccountConfig(WECHAT_RUNTIME_CHANNEL_ID, config))
                || isImplicitlyConfiguredChannel(WECHAT_RUNTIME_CHANNEL_ID, section)
            );

        if (hasConfiguredWeChatAccounts || hasPersistedState) {
            return false;
        }

        if (removePluginIds(currentConfig, [WECHAT_RUNTIME_CHANNEL_ID])) {
            cleanedDanglingState = true;
        }

        const installs =
            currentConfig.plugins?.installs && typeof currentConfig.plugins.installs === 'object'
                ? currentConfig.plugins.installs as Record<string, unknown>
                : undefined;
        if (installs && WECHAT_RUNTIME_CHANNEL_ID in installs) {
            delete installs[WECHAT_RUNTIME_CHANNEL_ID];
            cleanedDanglingState = true;
            if (Object.keys(installs).length === 0) {
                if (currentConfig.plugins) {
                    delete currentConfig.plugins.installs;
                }
            } else if (currentConfig.plugins) {
                currentConfig.plugins.installs = installs;
            }
        }

        if (section && !hasConfiguredWeChatAccounts) {
            delete currentConfig.channels?.[WECHAT_RUNTIME_CHANNEL_ID];
            cleanedDanglingState = true;
            if (currentConfig.channels && Object.keys(currentConfig.channels).length === 0) {
                delete currentConfig.channels;
            }
        }

        pruneEmptyPluginsConfig(currentConfig);

        return cleanedDanglingState;
    }, NO_RESTART_CONFIG_WRITE);

    if (cleanedDanglingState) {
        const cleanupTargets = [
            join(resolveOpenClawDir(), 'openclaw-weixin'),
            join(resolveOpenClawDir(), 'credentials', 'openclaw-weixin'),
            join(resolveOpenClawDir(), 'agents', 'default', 'sessions', '.openclaw-weixin-sync'),
            join(resolveOpenClawDir(), 'extensions', 'openclaw-weixin'),
        ];

        for (const target of cleanupTargets) {
            try {
                if (await fileExists(target)) {
                    await rm(target, { recursive: true, force: true });
                }
            } catch (error) {
                console.error(`Failed to delete dangling WeChat state at ${target}:`, error);
            }
        }
    }

    return { cleanedDanglingState };
}

export async function cleanupLegacyChannelPlugins(): Promise<{ cleaned: boolean }> {
    let cleaned = false;

    await updateOpenClawConfig(async (currentConfig) => {
        if (removePluginIds(currentConfig, LEGACY_CHANNEL_PLUGIN_IDS)) {
            cleaned = true;
        }

        const installs =
            currentConfig.plugins?.installs && typeof currentConfig.plugins.installs === 'object'
                ? currentConfig.plugins.installs as Record<string, unknown>
                : undefined;

        if (installs) {
            for (const pluginId of LEGACY_CHANNEL_PLUGIN_IDS) {
                if (pluginId in installs) {
                    delete installs[pluginId];
                    cleaned = true;
                }
            }

            if (Object.keys(installs).length === 0) {
                if (currentConfig.plugins) {
                    delete currentConfig.plugins.installs;
                }
            } else if (currentConfig.plugins) {
                currentConfig.plugins.installs = installs;
            }
        }

        pruneEmptyPluginsConfig(currentConfig);

        return cleaned;
    }, NO_RESTART_CONFIG_WRITE);

    for (const pluginId of LEGACY_CHANNEL_PLUGIN_IDS) {
        const pluginDir = join(EXTENSIONS_DIR, pluginId);
        try {
            if (await fileExists(pluginDir)) {
                await rm(pluginDir, { recursive: true, force: true });
                cleaned = true;
            }
        } catch (error) {
            console.error(`Failed to delete legacy channel plugin at ${pluginDir}:`, error);
        }
    }

    for (const pluginId of OFFICIAL_BUNDLED_PLUGIN_MIRROR_IDS) {
        const pluginDir = join(EXTENSIONS_DIR, pluginId);
        try {
            if (await fileExists(pluginDir)) {
                await rm(pluginDir, { recursive: true, force: true });
                cleaned = true;
            }
        } catch (error) {
            console.error(`Failed to delete bundled plugin mirror at ${pluginDir}:`, error);
        }
    }

    return { cleaned };
}

export async function cleanupInvalidManagedChannelPlugins(): Promise<{ cleaned: boolean; removedPluginIds: string[] }> {
    let cleaned = false;
    const removedPluginIds: string[] = [];

    for (const pluginId of MANAGED_CHANNEL_PLUGIN_IDS) {
        const pluginDir = join(EXTENSIONS_DIR, pluginId);
        const manifestPath = join(pluginDir, 'openclaw.plugin.json');

        try {
            if (!(await fileExists(manifestPath))) {
                continue;
            }

            let rawManifest: unknown;
            try {
                rawManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
            } catch {
                rawManifest = null;
            }

            const configSchema =
                rawManifest && typeof rawManifest === 'object' && !Array.isArray(rawManifest)
                    ? (rawManifest as Record<string, unknown>).configSchema
                    : undefined;

            const hasInvalidManifest =
                !configSchema || typeof configSchema !== 'object' || Array.isArray(configSchema);
            const hasIncompatibleSdkImports = hasIncompatibleManagedPluginSdkImports(pluginDir);

            if (hasInvalidManifest || hasIncompatibleSdkImports) {
                await rm(pluginDir, { recursive: true, force: true });
                cleaned = true;
                removedPluginIds.push(pluginId);
            }
        } catch (error) {
            console.error(`Failed to validate managed channel plugin at ${pluginDir}:`, error);
        }
    }

    return { cleaned, removedPluginIds };
}

export async function repairChannelConfigConsistency(): Promise<{ repaired: boolean }> {
    let repaired = false;
    let removeChinaManagedPluginMirror = false;

    await updateOpenClawConfig(async (currentConfig) => {
        migrateLegacyWechatSection(currentConfig);

        if (currentConfig.channels && typeof currentConfig.channels === 'object') {
            for (const [channelType, rawSection] of Object.entries(currentConfig.channels)) {
                const section = rawSection as AccountScopedChannelSection | undefined;
                if (!section || typeof section !== 'object') {
                    continue;
                }

                let nextSection: AccountScopedChannelSection = { ...section };
                let sectionChanged = false;

                const normalizedSection = normalizeChannelSectionForRuntime(channelType, nextSection);
                if (normalizedSection && normalizedSection !== nextSection) {
                    nextSection = normalizedSection;
                    sectionChanged = true;
                }

                if (nextSection.accounts && typeof nextSection.accounts === 'object' && Object.keys(nextSection.accounts).length === 0) {
                    delete nextSection.accounts;
                    sectionChanged = true;
                }

                const configuredAccountIds = getConfiguredAccountIds(channelType, nextSection);
                const hasDefaultTopLevelAccount = configuredAccountIds.includes('default');
                const namedConfiguredAccountIds = configuredAccountIds.filter((accountId) => accountId !== 'default');
                const explicitDefaultAccount =
                    typeof nextSection.defaultAccount === 'string' && nextSection.defaultAccount.trim()
                        ? nextSection.defaultAccount.trim()
                        : undefined;

                if (explicitDefaultAccount) {
                    const isValidDefaultAccount =
                        explicitDefaultAccount === 'default'
                            ? hasDefaultTopLevelAccount
                            : configuredAccountIds.includes(explicitDefaultAccount);
                    if (!isValidDefaultAccount) {
                        delete nextSection.defaultAccount;
                        sectionChanged = true;
                    }
                }

                const normalizedDefaultAccount =
                    typeof nextSection.defaultAccount === 'string' && nextSection.defaultAccount.trim()
                        ? nextSection.defaultAccount.trim()
                        : undefined;
                if (!normalizedDefaultAccount && !hasDefaultTopLevelAccount && namedConfiguredAccountIds.length === 1) {
                    nextSection.defaultAccount = namedConfiguredAccountIds[0];
                    sectionChanged = true;
                }

                if (nextSection.enabled === false && configuredAccountIds.length > 0) {
                    nextSection.enabled = true;
                    sectionChanged = true;
                }

                if (sectionChanged) {
                    currentConfig.channels[channelType] = nextSection;
                    repaired = true;
                }
            }
        }

        const staleAllowIds = new Set(
            Object.keys(CHANNEL_PLUGIN_ALLOWLIST_IDS)
                .filter((channelType) => !hasConfiguredChannelState(channelType, currentConfig.channels?.[channelType] as AccountScopedChannelSection | undefined))
                .flatMap((channelType) => getChannelPluginAllowIds(channelType)),
        );

        if (!hasConfiguredChannelState('feishu', currentConfig.channels?.feishu as AccountScopedChannelSection | undefined)) {
            for (const pluginId of getChannelPluginAllowIds('feishu')) {
                staleAllowIds.add(pluginId);
            }
        }

        for (const channelType of CHINA_CHANNEL_TYPES) {
            if (!hasConfiguredChannelState(channelType, currentConfig.channels?.[channelType] as AccountScopedChannelSection | undefined)) {
                for (const pluginId of getChannelPluginAllowIds(channelType)) {
                    staleAllowIds.add(pluginId);
                }
                for (const pluginId of getLegacyChannelPluginIds(channelType)) {
                    staleAllowIds.add(pluginId);
                }
            }
        }
        staleAllowIds.add(LEGACY_CHINA_CHANNEL_PLUGIN_ID);

        if (staleAllowIds.size > 0 && Array.isArray(currentConfig.plugins?.allow)) {
            const nextAllow = (currentConfig.plugins.allow as string[]).filter((pluginId) => !staleAllowIds.has(pluginId));
            if (nextAllow.length !== currentConfig.plugins.allow.length) {
                if (nextAllow.length > 0) {
                    currentConfig.plugins.allow = nextAllow;
                } else if (currentConfig.plugins) {
                    delete currentConfig.plugins.allow;
                }
                pruneEmptyPluginsConfig(currentConfig);
                repaired = true;
            }
        }

        if (!hasConfiguredChannelState('feishu', currentConfig.channels?.feishu as AccountScopedChannelSection | undefined)) {
            if (removePluginIds(currentConfig, FEISHU_PLUGIN_ID_CANDIDATES)) {
                repaired = true;
            }
        }

        if (hasConfiguredChannelState(WECHAT_RUNTIME_CHANNEL_ID, currentConfig.channels?.[WECHAT_RUNTIME_CHANNEL_ID] as AccountScopedChannelSection | undefined)) {
            const beforeAllow = JSON.stringify(currentConfig.plugins?.allow ?? null);
            const beforeEntry = JSON.stringify(currentConfig.plugins?.entries?.[WECHAT_RUNTIME_CHANNEL_ID] ?? null);
            ensurePluginEnabled(currentConfig, WECHAT_RUNTIME_CHANNEL_ID, {
                createEntry: true,
                createAllowlist: true,
            });
            const afterAllow = JSON.stringify(currentConfig.plugins?.allow ?? null);
            const afterEntry = JSON.stringify(currentConfig.plugins?.entries?.[WECHAT_RUNTIME_CHANNEL_ID] ?? null);
            if (beforeAllow !== afterAllow || beforeEntry !== afterEntry) {
                repaired = true;
            }
        } else if (removePluginIds(currentConfig, [WECHAT_RUNTIME_CHANNEL_ID])) {
            repaired = true;
        }

        if (hasConfiguredChannelState('qqbot', currentConfig.channels?.qqbot as AccountScopedChannelSection | undefined)) {
            const beforeAllow = JSON.stringify(currentConfig.plugins?.allow ?? null);
            const beforeEntry = JSON.stringify(currentConfig.plugins?.entries?.qqbot ?? null);
            ensurePluginEnabled(currentConfig, 'qqbot');
            if (currentConfig.plugins?.entries?.qqbot) {
                delete currentConfig.plugins.entries.qqbot;
            }
            const afterAllow = JSON.stringify(currentConfig.plugins?.allow ?? null);
            const afterEntry = JSON.stringify(currentConfig.plugins?.entries?.qqbot ?? null);
            if (beforeAllow !== afterAllow || beforeEntry !== afterEntry) {
                repaired = true;
            }
        } else if (removePluginIds(currentConfig, ['qqbot', ...QQBOT_LEGACY_PLUGIN_IDS])) {
            repaired = true;
        }

        if (ensureConfiguredBuiltInChannelsAllowed(currentConfig)) {
            repaired = true;
        }

        if (hasConfiguredChinaManagedChannel(currentConfig)) {
            for (const channelType of CHINA_CHANNEL_TYPES) {
                if (hasConfiguredChannelState(channelType, currentConfig.channels?.[channelType] as AccountScopedChannelSection | undefined)) {
                    const beforeAllow = JSON.stringify(currentConfig.plugins?.allow ?? null);
                    const beforeEntry = JSON.stringify(currentConfig.plugins?.entries?.[CHINA_CHANNEL_PLUGIN_IDS[channelType]] ?? null);
                    ensurePluginEnabled(currentConfig, CHINA_CHANNEL_PLUGIN_IDS[channelType], {
                        createEntry: true,
                        createAllowlist: true,
                    });
                    const afterAllow = JSON.stringify(currentConfig.plugins?.allow ?? null);
                    const afterEntry = JSON.stringify(currentConfig.plugins?.entries?.[CHINA_CHANNEL_PLUGIN_IDS[channelType]] ?? null);
                    if (beforeAllow !== afterAllow || beforeEntry !== afterEntry) {
                        repaired = true;
                    }
                }
                if (removePluginIds(currentConfig, getLegacyChannelPluginIds(channelType))) {
                    repaired = true;
                }
            }
        } else if (removePluginIds(currentConfig, [
            LEGACY_CHINA_CHANNEL_PLUGIN_ID,
            ...Object.values(CHINA_CHANNEL_PLUGIN_IDS),
            ...CHINA_CHANNEL_TYPES.flatMap((channelType) => getLegacyChannelPluginIds(channelType)),
        ])) {
            repaired = true;
            removeChinaManagedPluginMirror = true;
        }

        if (ensureDefaultBindingsForConfiguredChannels(currentConfig)) {
            repaired = true;
        }

        pruneEmptyPluginsConfig(currentConfig);

        return repaired;
    }, NO_RESTART_CONFIG_WRITE);

    if (removeChinaManagedPluginMirror) {
        const pluginDir = join(EXTENSIONS_DIR, LEGACY_CHINA_CHANNEL_PLUGIN_ID);
        try {
            if (await fileExists(pluginDir)) {
                await rm(pluginDir, { recursive: true, force: true });
                repaired = true;
            }
        } catch (error) {
            console.error(`Failed to delete stale managed channel plugin mirror at ${pluginDir}:`, error);
        }
    }

    return { repaired };
}

export async function listConfiguredChannels(options?: { includeCli?: boolean }): Promise<string[]> {
    await migrateQQBotSessionAccountsToConfig().catch(() => false);
    const config = await readOpenClawConfigSnapshot();
    migrateLegacyWechatSection(config);
    return listConfiguredChannelsFromConfig(config, options);
}

export function listConfiguredChannelsFromConfig(
    config: Record<string, unknown>,
    options?: { includeCli?: boolean },
): string[] {
    const channels = new Set<string>();
    const includeCli = options?.includeCli ?? process.platform !== 'win32';

    if (includeCli) {
        // Note: CLI discovery must be done before calling this function.
        // When called from inside an updater callback, pass includeCli=false
        // to avoid awaiting a pending CLI call while holding the config write chain.
    }

    if (config.channels && typeof config.channels === 'object') {
        for (const [channelType, rawSection] of Object.entries(config.channels)) {
            const section = rawSection as AccountScopedChannelSection | undefined;
            if (!section || section.enabled === false) continue;
            const hasTopLevelConfig = hasMeaningfulSectionConfig(section);
            const hasConfiguredAccounts = resolveConfiguredAccounts(section).some(
                ({ config: accountConfig }) => hasConfiguredAccountConfig(channelType, accountConfig)
            );
            if (hasTopLevelConfig || hasConfiguredAccounts || isImplicitlyConfiguredChannel(channelType, section)) {
                channels.add(toUiChannelType(channelType));
            }
        }
    }

    return Array.from(channels);
}

export async function listConfiguredChannelAccounts(options?: { includeCli?: boolean }): Promise<Record<string, string[]>> {
    await migrateQQBotSessionAccountsToConfig().catch(() => false);
    const config = await readOpenClawConfigSnapshot();
    migrateLegacyWechatSection(config);
    return listConfiguredChannelAccountsFromConfig(config, options);
}

export function listConfiguredChannelAccountsFromConfig(
    config: Record<string, unknown>,
    options?: { includeCli?: boolean },
): Record<string, string[]> {
    const result: Record<string, string[]> = {};

    for (const channelType of listConfiguredChannelsFromConfig(config, options)) {
        const runtimeChannelType = toRuntimeChannelType(channelType);
        const section = config.channels?.[runtimeChannelType] as AccountScopedChannelSection | undefined;
        const normalizedSection = normalizeChannelSectionForRuntime(runtimeChannelType, section);
        const effectiveSection = normalizedSection || section;
        const accountIds = new Set<string>();
        const hasNamedAccounts = hasConfiguredNamedAccounts(runtimeChannelType, effectiveSection);

        if (effectiveSection && effectiveSection.enabled !== false) {
            if (hasConfiguredAccountConfig(runtimeChannelType, effectiveSection.accounts?.default as ChannelConfigData | undefined)) {
                accountIds.add('default');
            }
            if (!hasNamedAccounts && getAccountScopedTopLevelKeys(runtimeChannelType, effectiveSection).length > 0) {
                accountIds.add('default');
            }
            for (const { accountId, config: accountConfig } of resolveConfiguredAccounts(effectiveSection)) {
                if (accountId === 'default') continue;
                if (hasConfiguredAccountConfig(runtimeChannelType, accountConfig)) {
                    accountIds.add(accountId);
                }
            }
            if (isImplicitlyConfiguredChannel(runtimeChannelType, effectiveSection) && accountIds.size === 0) {
                accountIds.add('default');
            }
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

export async function listConfiguredChannelGroups(options?: { includeCli?: boolean }): Promise<ConfiguredChannelGroupSnapshot[]> {
    await migrateQQBotSessionAccountsToConfig().catch(() => false);
    const config = await readOpenClawConfigSnapshot();
    migrateLegacyWechatSection(config);
    return listConfiguredChannelGroupsFromConfig(config, options);
}

export function listConfiguredChannelGroupsFromConfig(
    config: Record<string, unknown>,
    options?: { includeCli?: boolean },
): ConfiguredChannelGroupSnapshot[] {
    const groups: ConfiguredChannelGroupSnapshot[] = [];
    const channelTypes = listConfiguredChannelsFromConfig(config, options);

    for (const channelType of channelTypes) {
        const runtimeChannelType = toRuntimeChannelType(channelType);
        const section = normalizeChannelSectionForRuntime(
            runtimeChannelType,
            (config.channels as Record<string, AccountScopedChannelSection | undefined> | undefined)?.[runtimeChannelType],
        );
        const accounts = new Map<string, ConfiguredChannelGroupSnapshot['accounts'][number]>();
        const explicitDefaultAccountId =
            typeof section?.defaultAccount === 'string' && section.defaultAccount.trim()
                ? section.defaultAccount.trim()
                : undefined;
        const hasNamedAccounts = hasConfiguredNamedAccounts(runtimeChannelType, section);

        if (
            section &&
            section.enabled !== false &&
            !hasNamedAccounts &&
            getAccountScopedTopLevelKeys(runtimeChannelType, section).length > 0
        ) {
            accounts.set('default', {
                accountId: 'default',
                isDefaultAccount: explicitDefaultAccountId ? explicitDefaultAccountId === 'default' : true,
                configured: true,
            });
        }

        if (section && section.enabled !== false) {
            if (hasConfiguredAccountConfig(runtimeChannelType, section.accounts?.default as ChannelConfigData | undefined)) {
                accounts.set('default', {
                    accountId: 'default',
                    isDefaultAccount: explicitDefaultAccountId ? explicitDefaultAccountId === 'default' : true,
                    configured: true,
                });
            }
            for (const { accountId, config: accountConfig } of resolveConfiguredAccounts(section)) {
                if (accountId === 'default') continue;
                if (!hasConfiguredAccountConfig(runtimeChannelType, accountConfig)) continue;
                accounts.set(accountId, {
                    accountId,
                    isDefaultAccount: explicitDefaultAccountId
                        ? explicitDefaultAccountId === accountId
                        : accountId === 'default',
                    configured: true,
                });
            }
            if (isImplicitlyConfiguredChannel(runtimeChannelType, section) && accounts.size === 0) {
                accounts.set('default', {
                    accountId: 'default',
                    isDefaultAccount: explicitDefaultAccountId ? explicitDefaultAccountId === 'default' : true,
                    configured: true,
                });
            }
        }

        const sortedAccounts = Array.from(accounts.values()).sort((left, right) => {
            if (left.isDefaultAccount !== right.isDefaultAccount) {
                return left.isDefaultAccount ? -1 : 1;
            }
            return left.accountId.localeCompare(right.accountId);
        });

        if (
            isWeChatRuntimeChannel(runtimeChannelType)
            && !explicitDefaultAccountId
            && sortedAccounts.length === 1
            && sortedAccounts[0].accountId !== 'default'
            && !sortedAccounts[0].isDefaultAccount
        ) {
            sortedAccounts[0] = {
                ...sortedAccounts[0],
                isDefaultAccount: true,
            };
        }

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
    await beginChannelDraftSession();
    const runtimeChannelType = toRuntimeChannelType(channelType);
    await updateChannelDraftConfig(async (currentConfig) => {
        migrateLegacyWechatSection(currentConfig);
        if (PLUGIN_CHANNELS.includes(runtimeChannelType)) {
            if (!currentConfig.plugins) currentConfig.plugins = {};
            if (!currentConfig.plugins.entries) currentConfig.plugins.entries = {};
            if (!currentConfig.plugins.entries[runtimeChannelType]) currentConfig.plugins.entries[runtimeChannelType] = {};
            currentConfig.plugins.entries[runtimeChannelType].enabled = enabled;
            return;
        }

        if (!currentConfig.channels) currentConfig.channels = {};
        if (!currentConfig.channels[runtimeChannelType]) currentConfig.channels[runtimeChannelType] = {};
        const section = currentConfig.channels[runtimeChannelType] as AccountScopedChannelSection;
        const source = resolveEditableChannelSource(currentConfig, runtimeChannelType, preferredAccountId);
        if (source.kind === 'account') {
            const accounts = { ...(section.accounts || {}) };
            const accountSection = { ...((accounts[source.accountId] as ChannelConfigData | undefined) || {}) };
            accountSection.enabled = enabled;
            accounts[source.accountId] = accountSection;
            currentConfig.channels[runtimeChannelType] = {
                ...section,
                enabled,
                accounts,
            };
        } else {
            currentConfig.channels[runtimeChannelType].enabled = enabled;
        }
    });
    console.log(`Set channel ${runtimeChannelType} enabled: ${enabled}`);
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
        case 'feishu':
            return validateFeishuCredentials(config);
        case 'wecom':
            return validateWeComCredentials(config);
        case 'qqbot':
            return validateQQBotCredentials(config);
        case 'discord':
            return validateDiscordCredentials(config);
        case 'telegram':
            return validateTelegramCredentials(config);
        default:
            return { valid: true, errors: [], warnings: ['No online validation available for this channel type.'] };
    }
}

function resolveFeishuOpenApiBase(domainValue: string | undefined): string {
    const normalized = domainValue?.trim().toLowerCase();
    if (normalized === 'lark') {
        return 'https://open.larksuite.com';
    }
    if (normalized && /^https:\/\//.test(normalized)) {
        return normalized.replace(/\/+$/, '');
    }
    return 'https://open.feishu.cn';
}

async function validateFeishuCredentials(
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    const appId = config.appId?.trim();
    const appSecret = config.appSecret?.trim();
    const domain = config.domain?.trim() || 'feishu';

    if (!appId) {
        return { valid: false, errors: ['App ID is required'], warnings: [] };
    }

    if (!appSecret) {
        return { valid: false, errors: ['App Secret is required'], warnings: [] };
    }

    const apiBaseUrl = resolveFeishuOpenApiBase(domain);

    try {
        const response = await proxyAwareFetch(`${apiBaseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                app_id: appId,
                app_secret: appSecret,
            }),
        });

        const data = (await response.json().catch(() => ({}))) as {
            code?: number;
            msg?: string;
            tenant_access_token?: string;
            expire?: number;
        };

        if (
            response.ok
            && data.code === 0
            && typeof data.tenant_access_token === 'string'
            && data.tenant_access_token.trim()
        ) {
            return {
                valid: true,
                errors: [],
                warnings: [],
                details: {
                    appId,
                    domain,
                    tokenTtlSeconds: String(data.expire ?? ''),
                },
            };
        }

        return {
            valid: false,
            errors: [
                typeof data.msg === 'string' && data.msg.trim()
                    ? data.msg.trim()
                    : `Feishu/Lark API returned ${response.status}`,
            ],
            warnings: [],
        };
    } catch (error) {
        return {
            valid: false,
            errors: [`Unable to validate Feishu/Lark credentials online: ${error instanceof Error ? error.message : String(error)}`],
            warnings: [],
        };
    }
}

async function validateQQBotCredentials(
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    const appId = config.appId?.trim();
    const clientSecret = config.clientSecret?.trim();

    if (!appId) {
        return { valid: false, errors: ['App ID is required'], warnings: [] };
    }

    if (!clientSecret) {
        return { valid: false, errors: ['Client Secret is required'], warnings: [] };
    }

    try {
        const response = await proxyAwareFetch('https://bots.qq.com/app/getAppAccessToken', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ appId, clientSecret }),
        });
        const data = (await response.json().catch(() => ({}))) as {
            access_token?: string;
            expires_in?: number;
            code?: number;
            message?: string;
        };

        if (response.ok && typeof data.access_token === 'string' && data.access_token.trim()) {
            return {
                valid: true,
                errors: [],
                warnings: [],
                details: {
                    appId,
                    tokenTtlSeconds: String(data.expires_in ?? ''),
                },
            };
        }

        const code = typeof data.code === 'number' ? data.code : undefined;
        const message = typeof data.message === 'string' ? data.message : '';
        if (code === 100016 || /invalid appid or secret/i.test(message)) {
            return {
                valid: false,
                errors: ['Invalid QQ Bot App ID or Client Secret. Please verify the credentials and try again.'],
                warnings: [],
            };
        }

        return {
            valid: false,
            errors: [
                message || `QQ Bot API returned ${response.status}`,
            ],
            warnings: [],
        };
    } catch (error) {
        return {
            valid: false,
            errors: [`Unable to validate QQ Bot credentials online: ${error instanceof Error ? error.message : String(error)}`],
            warnings: [],
        };
    }
}

async function validateWeComCredentials(
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    const botId = config.botId?.trim();
    const secret = config.secret?.trim();

    if (!botId) {
        return { valid: false, errors: ['Bot ID is required'], warnings: [] };
    }

    if (!secret) {
        return { valid: false, errors: ['App Secret is required'], warnings: [] };
    }

    try {
        const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken');
        url.searchParams.set('corpid', botId);
        url.searchParams.set('corpsecret', secret);

        const response = await proxyAwareFetch(url.toString());
        const data = (await response.json().catch(() => ({}))) as {
            errcode?: number;
            errmsg?: string;
            access_token?: string;
            expires_in?: number;
        };
        const errcode = typeof data.errcode === 'number' ? data.errcode : undefined;
        const errmsg = typeof data.errmsg === 'string' ? data.errmsg : '';

        if (response.ok && errcode === 0 && data.access_token) {
            return {
                valid: true,
                errors: [],
                warnings: [],
                details: {
                    corpId: botId,
                    tokenTtlSeconds: String(data.expires_in ?? ''),
                },
            };
        }

        // The incident log shows this exact failure mode. Block saves when
        // WeCom explicitly says the secret is invalid.
        if (errcode === 600041 || /invalid secret/i.test(errmsg)) {
            return {
                valid: false,
                errors: ['Invalid WeCom App Secret. Please verify the Secret and try again.'],
                warnings: [],
            };
        }

        // The UI currently allows either Corp ID or a bot-specific ID.
        // The gettoken API only definitively validates the Corp ID form, so
        // treat other API errors as advisory instead of hard-blocking saves.
        const advisory = errmsg || `WeCom API returned errcode ${String(errcode ?? response.status)}`;
        return {
            valid: true,
            errors: [],
            warnings: [
                `Online verification only supports the WeCom Corp ID + Secret flow. This Bot ID could not be fully verified online (${advisory}), but it can still work at runtime after save.`,
            ],
        };
    } catch (error) {
        return {
            valid: true,
            errors: [],
            warnings: [
                `Online WeCom verification is unavailable right now (${error instanceof Error ? error.message : String(error)}). The Gateway will perform the final runtime check after save.`,
            ],
        };
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
