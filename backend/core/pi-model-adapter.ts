import { stream, type Context, type Model } from '@earendil-works/pi-ai';
import type { ModelAdapter, ModelCancellationSignal, ModelStreamEvent, ModelTurn } from './model-adapter';

type SupportedApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

function toApi(value: string | undefined): SupportedApi {
  if (value === 'openai-responses' || value === 'anthropic-messages') return value;
  return 'openai-completions';
}

/** Pi is a transport implementation only; ClawCore owns the agent loop. */
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
      messages: turn.messages
        .filter((message) => message.role !== 'system' && message.role !== 'tool')
        .map((message) => message.role === 'assistant'
          ? { role: 'assistant' as const, content: [{ type: 'text' as const, text: message.content }], api, provider: turn.model.provider, model: turn.model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop' as const, timestamp: Date.now() }
          : { role: 'user' as const, content: message.content, timestamp: Date.now() }),
    };

    for await (const event of stream(model, context, { apiKey: turn.model.apiKey, headers: turn.model.headers })) {
      if (event.type === 'text_delta') yield { type: 'text.delta', text: event.delta };
      if (event.type === 'thinking_delta') yield { type: 'reasoning.delta', text: event.delta };
      if (event.type === 'toolcall_end') yield { type: 'tool.call', id: event.toolCall.id, name: event.toolCall.name, arguments: event.toolCall.arguments };
      if (event.type === 'done') {
        const message = event.message.content.filter((item) => item.type === 'text').map((item) => item.text).join('');
        yield { type: 'usage', usage: { inputTokens: event.message.usage.input, outputTokens: event.message.usage.output, cacheReadTokens: event.message.usage.cacheRead, cost: event.message.usage.cost.total } };
        yield { type: 'complete', message };
      }
      if (event.type === 'error') yield { type: 'error', code: 'MODEL_PROVIDER_ERROR', message: event.error.errorMessage || 'Model provider request failed' };
    }
  }
}
