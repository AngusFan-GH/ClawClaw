import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClawCoreRuntime } from '@backend/core/runtime';
import { FakeSecretBridge } from '@backend/core/native/secret-bridge';
import type {
  ModelAdapter,
  ModelCancellationSignal,
  ModelStreamEvent,
  ModelTurn,
} from '@backend/core/model-adapter';

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'clawcore-test-'));
}

export type FetchImpl = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

export interface Harness {
  dataDir: string;
  secrets: FakeSecretBridge;
  rt: ClawCoreRuntime;
  model: ScriptedModel;
}

export async function makeHarness(options: { script?: ModelScript; fetchImpl?: FetchImpl } = {}): Promise<Harness> {
  const dataDir = tempDir();
  const secrets = new FakeSecretBridge();
  const model = new ScriptedModel(options.script ?? defaultScript);
  const rt = new ClawCoreRuntime({
    dataDir,
    secretBridge: secrets,
    model,
    fetchImpl: options.fetchImpl as never,
    bundledSkillsRoot: join(dataDir, 'skills'),
  });
  await rt.initialize();
  return { dataDir, secrets, rt, model };
}

export interface ScriptContext {
  turn: ModelTurn;
  turnIndex: number;
}
export type ModelScript = (ctx: ScriptContext) => ModelStreamEvent[] | AsyncIterable<ModelStreamEvent>;

export function defaultScript(ctx: ScriptContext): ModelStreamEvent[] {
  const hasToolResult = ctx.turn.messages.some(m => m.role === 'tool');
  if (!hasToolResult) {
    return [{ type: 'complete', message: 'hello', toolCalls: [], stopReason: 'stop' }];
  }
  return [{ type: 'complete', message: 'tool acknowledged', toolCalls: [], stopReason: 'stop' }];
}

export class ScriptedModel implements ModelAdapter {
  turnCount = 0;
  lastTurn: ModelTurn | undefined;
  constructor(private readonly script: ModelScript) {}
  setScript(script: ModelScript): void {
    this.script = script;
  }
  async *stream(turn: ModelTurn, _signal: ModelCancellationSignal): AsyncIterable<ModelStreamEvent> {
    this.lastTurn = turn;
    const produced = this.script({ turn, turnIndex: this.turnCount++ });
    for await (const event of produced as AsyncIterable<ModelStreamEvent>) yield event;
  }
}

export async function settled(rt: ClawCoreRuntime, runId: string): Promise<void> {
  await rt.whenSettled(runId);
  // allow microtasks (event persistence, etc.)
  await new Promise(r => setTimeout(r, 2));
}
