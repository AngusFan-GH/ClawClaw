# ClawClaw 代码修复方案

> 对应：`docs/code-review-report.md`
> 修复时间：2026-03-29

---

## 修复索引

| ID | 问题 | 涉及文件 | 复杂度 |
|----|------|---------|--------|
| [CR-3](#cr-3-handlechatevent-丢失-sessionkey) | `handleChatEvent` 丢失 `sessionKey` | `src/stores/gateway.ts` | 低 |
| [HR-1](#hr-1-sendmessage-乐观更新失败无回滚) | `sendMessage` 乐观更新失败无回滚 | `src/stores/chat.ts` | 低 |
| [HR-2](#hr-2-image-cache-json-解析错误静默吞噬) | Image Cache JSON 解析错误静默吞噬 | `src/stores/chat.ts` | 低 |
| [CR-2](#cr-2-unified_channels-死代码) | `UNIFIED_CHANNELS` 死代码 | `src/lib/api-client.ts` | 低 |
| [HR-6](#hr-6-空-catch-块问题) | 空 `catch` 块批量修复 | 多文件 | 中 |
| [HR-3](#hr-3-wechat-子进程无清理) | WeChat 子进程无清理 | `electron/api/routes/channels.ts` | 中 |
| [HR-4](#hr-4-reconnecttimer-定时器竞态) | `reconnectTimer` 定时器竞态 | `electron/gateway/manager.ts` | 中 |
| [HR-5](#hr-5-设备身份信任破坏未重新生成密钥) | 设备身份信任破坏未重新生成密钥 | `electron/gateway/device-identity.ts` | 中 |
| [MR-1](#mr-1-withtimeout-超时时静默返回默认值) | `withTimeout` 超时时静默返回默认值 | `electron/gateway/config-sync.ts` | 中 |
| [MR-3](#mr-3-渠道状态映射不一致) | 渠道状态映射不一致 | `electron/api/routes/channels.ts` | 低 |

---

## CR-3. `handleChatEvent` 丢失 `sessionKey`

**文件**: `src/stores/gateway.ts`
**严重度**: 🔴 Critical

### 问题

当 `gateway:chat-message` SSE 事件到达时，代码分两个分支处理，但第一个分支（`payload.state` 存在时）丢失了 `sessionKey`。

### 当前代码

```typescript
// src/stores/gateway.ts:133-151
function handleGatewayChatMessage(data: unknown): void {
  import('./chat').then(({ useChatStore }) => {
    const chatData = data as Record<string, unknown>;
    const payload = ('message' in chatData && typeof chatData.message === 'object')
      ? chatData.message as Record<string, unknown>
      : chatData;

    if (payload.state) {
      // ❌ 问题：sessionKey 可能只存在于 chatData 顶层，没有透传
      useChatStore.getState().handleChatEvent(payload);
      return;
    }

    useChatStore.getState().handleChatEvent({
      state: 'final',
      message: payload,
      runId: chatData.runId ?? payload.runId,
      // ❌ 这里也缺少 sessionKey
    });
  }).catch(() => {});
}
```

OpenClaw `chat:message` 事件的实际结构是：
```typescript
// { event: 'chat:message', payload: { state, message, runId, sessionKey } }
// data 是整个 event frame，所以 chatData = payload
// sessionKey 存在于 chatData 顶层
```

### 修复方案

```typescript
// src/stores/gateway.ts:133-151
function handleGatewayChatMessage(data: unknown): void {
  import('./chat').then(({ useChatStore }) => {
    const chatData = data as Record<string, unknown>;
    const payload = ('message' in chatData && typeof chatData.message === 'object')
      ? chatData.message as Record<string, unknown>
      : chatData;

    if (payload.state) {
      // ✅ 透传所有顶层字段（包含 sessionKey）
      useChatStore.getState().handleChatEvent({
        ...payload,
        runId: chatData.runId ?? payload.runId,
        sessionKey: chatData.sessionKey ?? payload.sessionKey,
      });
      return;
    }

    useChatStore.getState().handleChatEvent({
      state: 'final',
      message: payload,
      runId: chatData.runId ?? payload.runId,
      sessionKey: chatData.sessionKey ?? payload.sessionKey,
    });
  }).catch(() => {});
}
```

**要点**：OpenClaw 的 `chat:message` 事件中，`sessionKey` 存在于 `payload` 顶层（即 `chatData` 本身），`message` 字段是子对象。修复后确保所有字段都被正确透传。

---

## HR-1. `sendMessage` 乐观更新失败无回滚

**文件**: `src/stores/chat.ts`
**严重度**: 🟠 High

### 问题

`sendMessage` 在发送前乐观地将用户消息立即加入 UI（`messages[]`），但 RPC 失败后没有回滚这条消息。

### 当前代码（第 2351-2465 行）

```typescript
// src/stores/chat.ts:2271-2300 — 乐观添加用户消息
const userMsg: RawMessage = { role: 'user', content: trimmed, id: crypto.randomUUID(), ... };
set((s) => ({
  messages: [...s.messages, userMsg],  // ← 立即显示
  sending: true,
  ...
}));

try {
  result = await executeSend(...);

  if (!result.success) {
    clearHistoryPoll();
    // ❌ 只设置 error，没有移除 userMsg
    set({ error: result.error || 'Failed to send message', sending: false, ...resetToolStreamState(get()) });
  }
} catch (err) {
  clearHistoryPoll();
  // ❌ 同样只设置 error，没有回滚
  set({ error: String(err), sending: false, ...resetToolStreamState(get()) });
}
```

### 修复方案

核心思路：在乐观添加时记录 `userMsgId`，失败时用它过滤掉。

**第一步**：在乐观更新前提取 `userMsgId`

```typescript
// src/stores/chat.ts:2271-2300
// 确保 userMsg 在 set 之前有稳定的 ID 引用
const userMsg: RawMessage = {
  role: 'user',
  content: trimmed || (attachments?.length ? '(file attached)' : ''),
  timestamp: nowMs / 1000,
  id: crypto.randomUUID(),
  _attachedFiles: attachments?.map((a) => ({ ... })),
};
// ✅ 注意：ID 已经在对象创建时固定（crypto.randomUUID() 在作用域顶部）
```

**第二步**：修改失败处理逻辑（两处）

找到第 2456-2465 行的失败处理：

```typescript
// ❌ 当前代码 (行 2456-2465)
if (!result.success) {
  clearHistoryPoll();
  set({ error: result.error || 'Failed to send message', sending: false, ...resetToolStreamState(get()) });
} else if (result.result?.runId) {
  set({ activeRunId: result.result.runId });
}
} catch (err) {
  clearHistoryPoll();
  set({ error: String(err), sending: false, ...resetToolStreamState(get()) });
}
```

替换为：

```typescript
// ✅ 修复后 (行 2456-2465)
if (!result.success) {
  clearHistoryPoll();
  // 回滚乐观添加的用户消息
  set((s) => ({
    messages: s.messages.filter((m) => m.id !== userMsg.id),
    error: result.error || 'Failed to send message',
    sending: false,
    activeRunId: null,
    ...resetToolStreamState(get()),
  }));
} else if (result.result?.runId) {
  set({ activeRunId: result.result.runId });
}
} catch (err) {
  clearHistoryPoll();
  // 回滚乐观添加的用户消息
  set((s) => ({
    messages: s.messages.filter((m) => m.id !== userMsg.id),
    error: String(err),
    sending: false,
    activeRunId: null,
    ...resetToolStreamState(get()),
  }));
}
```

**第三步**：确保 `userMsg.id` 在整个 `sendMessage` 函数作用域内可访问（已满足，上例中 `userMsg` 定义在函数顶部）。

---

## HR-2. Image Cache JSON 解析错误静默吞噬

**文件**: `src/stores/chat.ts`
**严重度**: 🟠 High

### 问题

当 localStorage 中的 Image Cache 数据损坏时，`JSON.parse()` 失败后返回空 Map，但坏数据仍在 localStorage 中，下次调用继续失败。

### 当前代码（第 506-529 行）

```typescript
// src/stores/chat.ts:506-529
function loadImageCache(): Map<string, AttachedFileMeta> {
  try {
    const raw = localStorage.getItem(IMAGE_CACHE_KEY);
    if (raw) {
      const entries = JSON.parse(raw) as Array<[string, AttachedFileMeta]>;
      return new Map(entries);
    }
  } catch {
    /* ignore parse errors */  // ❌ 错误被丢弃，坏数据未清除
  }
  return new Map();  // 返回空 Map，但坏数据下次还会被读取
}

function saveImageCache(cache: Map<string, AttachedFileMeta>): void {
  try {
    const entries = Array.from(cache.entries());
    const trimmed =
      entries.length > IMAGE_CACHE_MAX ? entries.slice(entries.length - IMAGE_CACHE_MAX) : entries;
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota errors */  // ❌ 配额错误静默，用户不知道缓存失败
  }
}
```

### 修复方案

```typescript
// src/stores/chat.ts:506-529

function loadImageCache(): Map<string, AttachedFileMeta> {
  const raw = localStorage.getItem(IMAGE_CACHE_KEY);
  if (!raw) return new Map();

  try {
    const entries = JSON.parse(raw) as Array<[string, AttachedFileMeta]>;
    if (!Array.isArray(entries)) throw new Error('Cache entries must be an array');
    return new Map(entries);
  } catch (err) {
    // ✅ 数据损坏，清除坏数据并返回空 Map
    console.warn('[loadImageCache] Corrupted cache data, clearing:', err);
    try {
      localStorage.removeItem(IMAGE_CACHE_KEY);
    } catch {
      // ignore cleanup failure
    }
    return new Map();
  }
}

function saveImageCache(cache: Map<string, AttachedFileMeta>): void {
  try {
    const entries = Array.from(cache.entries());
    const trimmed =
      entries.length > IMAGE_CACHE_MAX ? entries.slice(entries.length - IMAGE_CACHE_MAX) : entries;
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    // ✅ 配额错误记录日志，用户可见
    console.warn('[saveImageCache] Failed to persist image cache (quota exceeded?):', err);
  }
}
```

---

## CR-2. `UNIFIED_CHANNELS` 死代码

**文件**: `src/lib/api-client.ts`
**严重度**: 🔴 Critical

### 问题

`UNIFIED_CHANNELS` 定义了 35+ 个通道，但 `resolveTransportOrder()` 从未使用它。需要确认设计意图并清理。

### 方案 A（推荐）：删除死代码

如果这些通道确实应该走 IPC，则删除 `UNIFIED_CHANNELS`：

```typescript
// ❌ 删除第 44-78 行的 UNIFIED_CHANNELS 定义

// ✅ 或者，如果要使用它，应该在 resolveTransportOrder 中应用：
function resolveTransportOrder(channel: string): TransportKind[] {
  // 如果通道在 UNIFIED_CHANNELS 中，优先尝试 ws
  if (UNIFIED_CHANNELS.has(channel)) {
    return ['ws', 'ipc'];
  }

  const matchedRule = transportConfig.rules.find((rule) => isRuleMatch(rule.matcher, channel));
  return matchedRule?.order ?? ['ipc'];
}
```

### 方案 B（谨慎采用）：为死代码赋予实际功能

如果设计意图是让这些通道优先尝试 WS 传输，则将 `UNIFIED_CHANNELS` 集成到 `resolveTransportOrder` 中：

```typescript
// src/lib/api-client.ts:221-234
function resolveTransportOrder(channel: string): TransportKind[] {
  // UNIFIED_CHANNELS 中的通道优先尝试 WS
  if (UNIFIED_CHANNELS.has(channel)) {
    const wsEnabled = transportConfig.enabled.ws;
    const ipcEnabled = true;
    const order: TransportKind[] = [];
    if (wsEnabled) order.push('ws');
    order.push('ipc');
    return order;
  }

  const matchedRule = transportConfig.rules.find((rule) => isRuleMatch(rule.matcher, channel));
  const order = matchedRule?.order ?? ['ipc'];

  return order.filter((kind) => {
    if (kind === 'ipc') return true;
    const backoffUntil = transportBackoffUntil[kind];
    if (typeof backoffUntil === 'number' && backoffUntil > Date.now()) {
      return false;
    }
    return transportConfig.enabled[kind];
  });
}
```

**建议**：先确认 `UNIFIED_CHANNELS` 的原始设计意图。如果不确定，优先采用**方案 A（删除）**，避免引入意外的传输行为变化。

---

## HR-6. 空 `catch` 块批量修复

**文件**: 多文件
**严重度**: 🟠 High

### 修复策略

用以下模式替换空 `catch` 块，按风险等级选择：

```typescript
// 低风险（外围已有防御）：记录警告但不中断
try { ... } catch (err) {
  console.warn('[FunctionName] Operation failed, continuing:', err);
}

// 中风险（可能影响功能）：记录并通知
try { ... } catch (err) {
  console.error('[FunctionName] Operation failed:', err);
  // 如果是 UI 相关，考虑 toast.error('...')
}

// 高风险（数据完整性）：抛出或回滚
try { ... } catch (err) {
  console.error('[FunctionName] Critical failure:', err);
  throw err;  // 或执行回滚逻辑
}
```

### 具体修复位置

**`src/stores/chat.ts`**

| 行号 | 当前 | 修复 |
|------|------|------|
| 513 | `catch { /* ignore */ }` | `catch (err) { console.warn('[loadImageCache] Parse failed:', err); }` |
| 526 | `catch { /* ignore */ }` | `catch (err) { console.warn('[saveImageCache] Write failed:', err); }` |
| 945 | `catch (err) { return false; }` | `catch (err) { console.warn('[loadMissingPreviews] Failed:', err); return false; }` |
| 357 | `catch { return DEFAULT; }` | `catch (err) { console.warn('[persistSessionKey] Failed:', err); return DEFAULT; }` |

**`src/stores/chat.ts:506-529` 的完整修复**（见 HR-2 部分）

**`electron/utils/channel-config.ts`**

| 行号 | 当前 | 修复 |
|------|------|------|
| 285 | `catch { /* ignore and try next */ }` | `catch { /* no manifest in this location, try next */ }`（保留但加注释） |
| ~500 | 子进程调用 | 添加 `console.warn('[validateChannelConfig] CLI validation failed:', err)` |

**`electron/gateway/config-sync.ts`**

| 行号 | 当前 | 修复 |
|------|------|------|
| ~40 | `catch { /* ignore */ }` | `catch (err) { logger.warn('Bootstrap repair skipped:', err); }` |

**`electron/gateway/manager.ts`**

| 行号 | 当前 | 修复 |
|------|------|------|
| ~780 | `catch (err) { logger.warn('reload fallback to restart:', err); }` | 保留（已有日志） |

---

## HR-3. WeChat 子进程无清理

**文件**: `electron/api/routes/channels.ts`
**严重度**: 🟠 High

### 问题

WeChat 插件安装时 `spawn` 的子进程没有超时 kill，也没有在出错时清理。

### 当前代码（第 470-527 行）

```typescript
// electron/api/routes/channels.ts:470-527
async function ensureWeChatPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  const bundledResult = ensureBundledPluginInstalled('openclaw-weixin', 'WeChat');
  if (bundledResult.installed) return bundledResult;

  const pluginManifest = join(homedir(), '.openclaw', 'extensions', 'openclaw-weixin', 'openclaw.plugin.json');
  const cliArgs = existsSync(pluginManifest)
    ? ['plugins', 'update', 'openclaw-weixin']
    : ['plugins', 'install', WECHAT_PLUGIN_SPEC];
  const spawnConfig = getOpenClawCliSpawnConfig(cliArgs);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(spawnConfig.command, spawnConfig.args, {
        cwd: spawnConfig.cwd, env: spawnConfig.env,
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk); });

      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0) { resolve(); return; }
        reject(new Error(stderr.trim() || `Failed with ${signal ? `signal ${signal}` : `code ${code}`}.`));
      });
      // ❌ 没有超时清理
    });
    // ...
  } catch (error) {
    // 子进程已经 resolve/reject，但不会有清理
  }
}
```

### 修复方案

```typescript
// electron/api/routes/channels.ts:470-527
async function ensureWeChatPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  const bundledResult = ensureBundledPluginInstalled('openclaw-weixin', 'WeChat');
  if (bundledResult.installed) return bundledResult;

  const pluginManifest = join(homedir(), '.openclaw', 'extensions', 'openclaw-weixin', 'openclaw.plugin.json');
  const cliArgs = existsSync(pluginManifest)
    ? ['plugins', 'update', 'openclaw-weixin']
    : ['plugins', 'install', WECHAT_PLUGIN_SPEC];
  const spawnConfig = getOpenClawCliSpawnConfig(cliArgs);

  const INSTALL_TIMEOUT_MS = 120_000;  // 2分钟超时

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(spawnConfig.command, spawnConfig.args, {
        cwd: spawnConfig.cwd, env: spawnConfig.env,
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });

      // ✅ 超时定时器
      const killTimer = setTimeout(() => {
        console.warn('[ensureWeChatPluginInstalled] Process timed out, killing child');
        child.kill('SIGTERM');
      }, INSTALL_TIMEOUT_MS);

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk); });

      child.once('error', (err) => {
        clearTimeout(killTimer);
        reject(err);
      });

      child.once('close', (code, signal) => {
        clearTimeout(killTimer);
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(
          stderr.trim()
            || `WeChat plugin install failed with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`,
        ));
      });
    });

    if (existsSync(pluginManifest)) {
      repairManagedPluginSdkImports(join(homedir(), '.openclaw', 'extensions', 'openclaw-weixin'));
      return { installed: true, warning: bundledResult.warning };
    }

    return {
      installed: false,
      warning: 'WeChat plugin install completed, but manifest was not found afterwards.',
    };
  } catch (error) {
    return {
      installed: false,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}
```

---

## HR-4. `reconnectTimer` 定时器竞态

**文件**: `electron/gateway/manager.ts`
**严重度**: 🟠 High

### 问题

`reconnectTimer` 在 `setTimeout` 异步回调执行时被设置为 `null`，如果 `this.start()` 抛出未捕获异常，代码路径不够清晰。

### 当前代码（第 1090-1108 行）

```typescript
// electron/gateway/manager.ts:1090-1108
this.reconnectTimer = setTimeout(async () => {
  this.reconnectTimer = null;  // ❌ 在异步回调中设置，逻辑不清晰
  const skipReason = getReconnectSkipReason({...});
  if (skipReason) {
    logger.debug(`Skipping fast reconnect: ${skipReason}`);
    return;
  }
  try {
    await this.start();
    this.reconnectAttempts = 0;
  } catch (error) {
    logger.error('Fast reconnect failed:', error);
    this.scheduleReconnect();  // 创建新定时器
  }
}, delay);
```

### 修复方案

添加一个 `inFlight` 标志位，防止重入：

```typescript
// electron/gateway/manager.ts:1088-1110
let reconnectInFlight = false;  // ✅ 新增：防止重入标志

this.reconnectTimer = setTimeout(async () => {
  if (reconnectInFlight) {
    logger.debug('Reconnect already in flight, skipping');
    return;
  }
  reconnectInFlight = true;

  try {
    const skipReason = getReconnectSkipReason({
      scheduledEpoch,
      currentEpoch: this.lifecycleController.getCurrentEpoch(),
      shouldReconnect: this.shouldReconnect,
    });
    if (skipReason) {
      logger.debug(`Skipping fast reconnect: ${skipReason}`);
      return;
    }
    try {
      await this.start();
      this.reconnectAttempts = 0;
    } catch (error) {
      logger.error('Fast reconnect failed:', error);
      this.scheduleReconnect();
    }
  } finally {
    reconnectInFlight = false;  // ✅ 确保标志在所有路径重置
    this.reconnectTimer = null;
  }
}, delay);
```

---

## HR-5. 设备身份信任破坏未重新生成密钥

**文件**: `electron/gateway/device-identity.ts`
**严重度**: 🟠 High

### 问题

当存储的 `deviceId` 与公钥派生的 ID 不一致时，代码更新 ID 但继续使用原私钥。

### 当前代码

```typescript
// electron/gateway/device-identity.ts
if (derivedId && derivedId !== parsed.deviceId) {
  // 私钥和公钥不匹配，数据被破坏或篡改
  const updated = { ...parsed, deviceId: derivedId };
  await writeFile(filePath, JSON.stringify(updated, null, 2), { mode: 0o600 });
  return {
    deviceId: derivedId,
    publicKeyPem: parsed.publicKeyPem,    // ❌ 继续使用原私钥
    privateKeyPem: parsed.privateKeyPem,  // ❌ 可能已被篡改
  };
}
```

### 修复方案

```typescript
// electron/gateway/device-identity.ts
if (derivedId && derivedId !== parsed.deviceId) {
  logger.warn(
    `[DeviceIdentity] Stored deviceId mismatch: stored=${parsed.deviceId}, derived=${derivedId}. ` +
    'Regenerating key pair to ensure security.'
  );
  // ✅ 检测到不一致时，重新生成整个密钥对
  const newKeyPair = await generateKeyPair();
  await writeFile(filePath, JSON.stringify(newKeyPair, null, 2), { mode: 0o600 });
  return newKeyPair;
}
```

完整 `generateKeyPair()` 函数参考（从同文件获取）：

```typescript
async function generateKeyPair(): Promise<{ deviceId: string; publicKeyPem: string; privateKeyPem: string }> {
  return new Promise((resolve, reject) => {
    const keyObject = crypto.generateKeyPair('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }, (err, publicKey, privateKey) => {
      if (err) { reject(err); return; }
      const publicKeyPem = publicKey as string;
      const privateKeyPem = privateKey as string;
      const deviceId = deriveDeviceId(publicKeyPem);
      resolve({ deviceId, publicKeyPem, privateKeyPem });
    });
  });
}
```

---

## MR-1. `withTimeout` 超时时静默返回默认值

**文件**: `electron/gateway/config-sync.ts`
**严重度**: 🟡 Medium

### 问题

对于非幂等操作（如配置写入），超时后静默返回 `fallback` 会导致数据部分写入后的静默丢失。

### 当前代码（第 92-114 行）

```typescript
// electron/gateway/config-sync.ts:92-114
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  fallback: T,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutHandle = setTimeout(() => {
          logger.warn(`${label} timed out after ${timeoutMs}ms; continuing with fallback`);
          resolve(fallback);  // ❌ 超时后静默返回 fallback
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
```

### 修复方案

提供两个重载：只读操作用 `withTimeout`，写入操作用 `withTimeoutOrThrow`：

```typescript
// electron/gateway/config-sync.ts

/**
 * 超时后抛出错误（适用于写入操作）。
 */
export async function withTimeoutOrThrow<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * 超时后返回默认值（仅适用于幂等的只读操作）。
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  fallback: T,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutHandle = setTimeout(() => {
          logger.warn(`${label} timed out after ${timeoutMs}ms; returning fallback`);
          resolve(fallback);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
```

**调用方变更**：将所有写入操作（涉及 `writeFile`/`store.set`/`auth add-key` 等）的 `withTimeout` 调用替换为 `withTimeoutOrThrow`。

---

## MR-3. 渠道状态映射不一致

**文件**: `electron/api/routes/channels.ts`
**严重度**: 🟡 Medium

### 问题

`mapAccountStatus()` 和 `normalizeAccountStatusForUi()` 处理状态值的逻辑有差异，导致某些状态在 UI 显示为 `'unknown'`。

### 修复方案

统一两个函数，合并到 `normalizeAccountStatusForUi`：

```typescript
// electron/api/routes/channels.ts
function normalizeAccountStatusForUi(status: string | undefined): AccountStatus {
  if (!status) return 'disconnected';
  const lower = status.toLowerCase();
  switch (lower) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'disconnected':
    case 'not_started':
    case 'none':
      return 'disconnected';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return 'unknown';
  }
}

// 删除 mapAccountStatus 函数，将所有调用替换为 normalizeAccountStatusForUi
```

---

## 总结

| 修复 ID | 改动量 | 需要测试的重点 |
|---------|--------|--------------|
| CR-3 | ~15 行 | 多 session 下聊天消息路由 |
| HR-1 | ~10 行 | 发送消息失败时 UI 回滚 |
| HR-2 | ~20 行 | 打开 Channels 页后 localStorage 缓存加载 |
| CR-2 | 删除 ~35 行 | 无功能影响（清理死代码） |
| HR-6 | ~15 处 | 无功能影响（仅增加日志） |
| HR-3 | ~10 行 | WeChat 插件安装超时 |
| HR-4 | ~15 行 | Gateway 断线重连 |
| HR-5 | ~10 行 | 首次启动或设备 ID 损坏时 |
| MR-1 | ~30 行 | 配置同步超时场景 |
| MR-3 | ~15 行 | 渠道状态 UI 显示 |
