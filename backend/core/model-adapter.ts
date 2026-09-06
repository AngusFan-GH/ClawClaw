import type { UsageSnapshot } from './contracts';

export interface ModelToolDescriptor {
  name: string;
  description: string;
  /** JSON Schema for the parameters object. */
  parameters: Record<string, unknown>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on assistant messages that requested tool calls. */
  toolCalls?: ModelToolCall[];
  /** Present on tool result messages. */
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

export interface ModelTurn {
  systemPrompt?: string;
  messages: ModelChatMessage[];
  model: { provider: string; id: string; apiKey?: string; baseUrl?: string; api?: string; headers?: Record<string, string> };
  tools?: ModelToolDescriptor[];
}

export interface ModelCancellationSignal {
  readonly aborted: boolean;
}

export class MutableCancellationSignal implements ModelCancellationSignal {
  private cancelled = false;
  get aborted(): boolean {
    return this.cancelled;
  }
  abort(): void {
    this.cancelled = true;
  }
}

export type ModelStreamEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'reasoning.delta'; text: string }
  | { type: 'tool.call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'usage'; usage: UsageSnapshot }
  | {
      type: 'complete';
      message: string;
      toolCalls: ModelToolCall[];
      stopReason: 'stop' | 'toolUse' | 'length' | 'error' | 'aborted';
    }
  | { type: 'error'; code: string; message: string };

export interface ModelAdapter {
  stream(turn: ModelTurn, signal: ModelCancellationSignal): AsyncIterable<ModelStreamEvent>;
}
