import type { UsageSnapshot } from './contracts';

export interface ModelTurn {
  systemPrompt?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
  model: { provider: string; id: string; apiKey?: string; baseUrl?: string; api?: string; headers?: Record<string, string> };
}

export interface ModelCancellationSignal {
  readonly aborted: boolean;
}

export class MutableCancellationSignal implements ModelCancellationSignal {
  private cancelled = false;
  get aborted(): boolean { return this.cancelled; }
  abort(): void { this.cancelled = true; }
}

export type ModelStreamEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'reasoning.delta'; text: string }
  | { type: 'tool.call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'usage'; usage: UsageSnapshot }
  | { type: 'complete'; message: string }
  | { type: 'error'; code: string; message: string };

export interface ModelAdapter {
  stream(turn: ModelTurn, signal: ModelCancellationSignal): AsyncIterable<ModelStreamEvent>;
}
