/**
 * The only tools shipped in this release. All are read-only and bounded:
 *  - core.time.getCurrentTime   (low risk, auto-approve)
 *  - core.artifact.readText     (medium risk, approval required)
 *  - core.fs.listDirectory      (medium risk, approval required)
 */
import { CoreError } from '../errors';
import { sha256 } from '../util';
import type { ParamSpec, ToolDefinition, ToolResult } from './types';

function invalid(message: string): never {
  throw new CoreError('TOOL_ARGUMENTS_INVALID', message);
}

function validateAgainst(params: ParamSpec[], args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) invalid('Tool arguments must be an object');
  const input = args as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const spec of params) {
    const value = input[spec.name];
    if (value === undefined || value === null) {
      if (spec.required) invalid(`Missing required parameter "${spec.name}"`);
      continue;
    }
    if (spec.type === 'string') {
      if (typeof value !== 'string') invalid(`Parameter "${spec.name}" must be a string`);
      if (spec.maxLength && value.length > spec.maxLength) invalid(`Parameter "${spec.name}" is too long`);
      out[spec.name] = value;
    } else if (spec.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`Parameter "${spec.name}" must be a number`);
      out[spec.name] = value;
    } else if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') invalid(`Parameter "${spec.name}" must be a boolean`);
      out[spec.name] = value;
    }
  }
  return out;
}

const getCurrentTime: ToolDefinition = {
  name: 'core.time.getCurrentTime',
  version: 1,
  description: 'Return the current date/time, optionally in an IANA timezone.',
  risk: 'low',
  approvalPolicy: 'auto',
  params: [{ name: 'timezone', type: 'string', maxLength: 64, description: 'IANA timezone, e.g. Asia/Shanghai' }],
  validate(args) {
    const parsed = validateAgainst(this.params, args);
    if (typeof parsed.timezone === 'string' && parsed.timezone) {
      try {
        Intl.DateTimeFormat('en-US', { timeZone: parsed.timezone });
      } catch {
        invalid('Unknown timezone');
      }
    }
    return parsed;
  },
  async execute(args, ctx) {
    const tz = typeof args.timezone === 'string' && args.timezone ? args.timezone : 'UTC';
    return {
      ok: true,
      output: {
        iso: ctx.now.toISOString(),
        timezone: tz,
        local: new Intl.DateTimeFormat('en-CA', { dateStyle: 'full', timeStyle: 'long', timeZone: tz }).format(ctx.now),
        unixSeconds: Math.floor(ctx.now.getTime() / 1000),
      } satisfies ToolResult['output'],
    };
  },
};

const readText: ToolDefinition = {
  name: 'core.artifact.readText',
  version: 1,
  description: 'Read a text artifact (by id or workspace-relative path). Returns a digest for binary input.',
  risk: 'medium',
  approvalPolicy: 'always',
  params: [
    { name: 'artifactId', type: 'string', maxLength: 128 },
    { name: 'path', type: 'string', maxLength: 512 },
  ],
  validate(args) {
    const parsed = validateAgainst(this.params, args);
    if (!parsed.artifactId && !parsed.path) invalid('Provide "artifactId" or "path"');
    return parsed;
  },
  async execute(args, ctx) {
    const ref = String(args.artifactId ?? args.path ?? '');
    try {
      const text = ctx.artifacts.readTextForTool(ctx.workspaceId, ref, ctx.maxArtifactReadBytes);
      const truncated = text.length >= ctx.maxArtifactReadBytes;
      return {
        ok: true,
        output: {
          ref,
          bytes: Buffer.byteLength(text, 'utf8'),
          truncated,
          sha256: sha256(text),
          text,
        },
      };
    } catch (error) {
      return { ok: false, errorCode: error instanceof CoreError ? error.code : 'TOOL_EXECUTION_FAILED', error: error instanceof Error ? error.message : 'read failed' };
    }
  },
};

const listDirectory: ToolDefinition = {
  name: 'core.fs.listDirectory',
  version: 1,
  description: 'List entries in a workspace artifact directory (workspace-relative path).',
  risk: 'medium',
  approvalPolicy: 'always',
  params: [{ name: 'path', type: 'string', maxLength: 512, description: 'Workspace-relative directory; defaults to the artifact root' }],
  validate(args) {
    return validateAgainst(this.params, args);
  },
  async execute(args, ctx) {
    const rel = typeof args.path === 'string' ? args.path : '.';
    try {
      const entries = ctx.artifacts.listDirectoryForTool(ctx.workspaceId, rel, ctx.maxListEntries);
      return { ok: true, output: { path: rel, entries, truncated: entries.length >= ctx.maxListEntries } };
    } catch (error) {
      return { ok: false, errorCode: error instanceof CoreError ? error.code : 'TOOL_EXECUTION_FAILED', error: error instanceof Error ? error.message : 'list failed' };
    }
  },
};

export const BUILTIN_TOOLS: ToolDefinition[] = [getCurrentTime, readText, listDirectory];
