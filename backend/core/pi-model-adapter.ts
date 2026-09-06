import { stream, type Context, type Message, type Model, type Tool } from '@earendil-works/pi-ai';
import type { ModelAdapter, ModelCancellationSignal, ModelStreamEvent, ModelToolDescriptor, ModelTurn } from './model-adapter';

type SupportedApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

function toApi(value: string | undefined): SupportedApi {
  if (value === 'openai-responses' || value === 'anthropic-messages') return value;
  return 'openai-completions';
}

const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** Pi is a transport implementation only; ClawCore owns the agent loop and policy. */
export class PiModelAdapter implements ModelAdapter {
  async *stream(turn: ModelTurn, _signal: ModelCancellationSignal): AsyncIterable<ModelStreamEvent> {
    const api = toApi(turn.model.api);
    const model: Model<SupportedApi> = {
      id: turn.model.id,
      name: turn.model.id,
      api,
      provider: turn.model.provider,
      baseUrl: turn.model.baseUrl || 'https://api.openai.com/v1',
      reasoning: true,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    };
    const context: Context = {
      systemPrompt: turn.systemPrompt,
      messages: turn.messages.filter(m => m.role !== 'system').map(m => toPiMessage(m, api, turn)),
      tools: turn.tools?.map(toPiTool),
    };

    const collected = new Map<string, { name: string; arguments: Record<string, unknown> }>();

    for await (const event of stream(model, context, { apiKey: turn.model.apiKey, headers: turn.model.headers })) {
      switch (event.type) {
        case 'text_delta':
          yield { type: 'text.delta', text: event.delta };
          break;
        case 'thinking_delta':
          yield { type: 'reasoning.delta', text: event.delta };
          break;
        case 'toolcall_end':
          collected.set(event.toolCall.id, { name: event.toolCall.name, arguments: event.toolCall.arguments });
          yield { type: 'tool.call', id: event.toolCall.id, name: event.toolCall.name, arguments: event.toolCall.arguments };
          break;
        case 'done': {
          const text = event.message.content.filter(item => item.type === 'text').map(item => (item as { text: string }).text).join('');
          for (const item of event.message.content) {
            if (item.type === 'toolCall') collected.set(item.id, { name: item.name, arguments: item.arguments });
          }
          yield {
            type: 'usage',
            usage: {
              inputTokens: event.message.usage.input,
              outputTokens: event.message.usage.output,
              cacheReadTokens: event.message.usage.cacheRead,
              cost: event.message.usage.cost.total,
            },
          };
          yield {
            type: 'complete',
            message: text,
            toolCalls: [...collected].map(([id, value]) => ({ id, name: value.name, arguments: value.arguments })),
            stopReason: event.message.stopReason === 'toolUse' ? 'toolUse' : event.message.stopReason === 'length' ? 'length' : 'stop',
          };
          return;
        }
        case 'error':
          yield { type: 'error', code: 'MODEL_PROVIDER_ERROR', message: event.error.errorMessage || 'Model provider request failed' };
          return;
      }
    }
    // Stream ended without a terminal event.
    yield { type: 'error', code: 'MODEL_STREAM_ENDED', message: 'Model stream ended without completion' };
  }
}

function toPiMessage(m: ModelTurn['messages'][number], api: SupportedApi, turn: ModelTurn): Message {
  if (m.role === 'tool') {
    return {
      role: 'toolResult',
      toolCallId: m.toolCallId ?? '',
      toolName: m.toolName ?? '',
      content: [{ type: 'text', text: m.content }],
      isError: Boolean(m.isError),
      timestamp: Date.now(),
    };
  }
  if (m.role === 'assistant') {
    const content: Array<Record<string, unknown>> = [];
    if (m.content) content.push({ type: 'text', text: m.content });
    for (const call of m.toolCalls ?? []) {
      content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments });
    }
    return { role: 'assistant', content: content as never, api, provider: turn.model.provider, model: turn.model.id, usage: ZERO_USAGE, stopReason: (m.toolCalls?.length ? 'toolUse' : 'stop') as unknown as never, timestamp: Date.now() };
  }
  return { role: 'user', content: m.content, timestamp: Date.now() };
}

function toPiTool(tool: ModelToolDescriptor): Tool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as Tool['parameters'],
  };
}
