#!/usr/bin/env zx

/**
 * bundle-openclaw-plugins.mjs
 *
 * Build a self-contained mirror of OpenClaw third-party plugins for packaging.
 * Current plugins:
 *   - @openclaw-china/dingtalk -> build/openclaw-plugins/dingtalk
 *   - @openclaw-china/wecom -> build/openclaw-plugins/wecom
 *   - @larksuite/openclaw-lark -> build/openclaw-plugins/feishu
 *   - @openclaw/qqbot -> build/openclaw-plugins/qqbot
 *   - @openclaw/discord -> build/openclaw-plugins/discord
 *   - @openclaw/whatsapp -> build/openclaw-plugins/whatsapp
 *   - @tencent-weixin/openclaw-weixin -> build/openclaw-plugins/openclaw-weixin
 *
 * The output plugin directory contains:
 *   - plugin source files (index.ts, openclaw.plugin.json, package.json, ...)
 *   - plugin runtime node_modules/ (flattened direct + transitive deps)
 */

import 'zx/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pluginBundler from './openclaw-plugin-bundler.cjs';

const { bundlePluginMirror } = pluginBundler;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'build', 'openclaw-plugins');
const NODE_MODULES = path.join(ROOT, 'node_modules');

const PLUGINS = [
  { npmName: '@openclaw-china/dingtalk', pluginId: 'dingtalk' },
  { npmName: '@openclaw-china/wecom', pluginId: 'wecom' },
  { npmName: '@larksuite/openclaw-lark', pluginId: 'feishu' },
  { npmName: '@openclaw/qqbot', pluginId: 'qqbot' },
  { npmName: '@openclaw/discord', pluginId: 'discord' },
  { npmName: '@openclaw/whatsapp', pluginId: 'whatsapp' },
  { npmName: '@tencent-weixin/openclaw-weixin', pluginId: 'openclaw-weixin' },
];

function bundleOnePlugin({ npmName, pluginId }) {
  const outputDir = path.join(OUTPUT_ROOT, pluginId);

  echo`📦 Bundling plugin ${npmName} -> ${outputDir}`;
  const result = bundlePluginMirror({
    nodeModulesRoot: NODE_MODULES,
    npmName,
    destDir: outputDir,
    pluginLabel: pluginId,
    logger: {
      info: (message) => echo`   🔧 ${message}`,
      warn: (message) => echo`   ⚠️  ${message}`,
    },
  });
  echo`   ✅ ${pluginId}: copied ${result.copiedCount} deps (skipped dupes: ${result.skippedDupes}, preserved overrides: ${result.preservedOverrides})`;
}

echo`📦 Bundling OpenClaw plugin mirrors...`;
fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

for (const plugin of PLUGINS) {
  bundleOnePlugin(plugin);
}

echo`✅ Plugin mirrors ready: ${OUTPUT_ROOT}`;
