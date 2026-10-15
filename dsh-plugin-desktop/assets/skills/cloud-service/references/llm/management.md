# LLM API · Inspect Models

Look up the available model list. Usage, quota, and billing are not exposed by the SDK.

> Read this file only when the user wants to **check available models**. To write model-call code for
> the app → read `code-generation.md`. For usage or quota, clearly state that no SDK API is available.

## Prerequisites

The current app's cloud service environment is confirmed present and usable per **Environment
Lifecycle** in `SKILL.md`.

## What Is Available

The one LLM management capability with an SDK surface is the model list:

```ts
import { createClawClawCloud } from '@tencent-ai/clawclaw-cloud-sdk';
// CDN form: const { createClawClawCloud } = ClawClawCloud;
// Miniprogram form: createMiniProgramClawClawCloud from '@tencent-ai/clawclaw-cloud-sdk/miniprogram'

const cloud = createClawClawCloud({
  endpoint: publicConfig.endpoint,
  publishableKey: publicConfig.publishableKey,
});

const models = await cloud.llm.models.list();
```

Each item is a browser-safe public model directory entry. `id`, `name`, and `enabled` are always
present; `disabled` is present only when the server explicitly provides it (`disabled: true` →
`enabled: false`; `disabled: false` → `enabled: true`; absent → `enabled: true` and `disabled` omitted).
Optional public metadata can include provider/vendor, descriptions, context and token limits,
modalities, explicit capabilities, sorting/default hints, and public display pricing. Additionally,
sparse public fields may be present: `credits` (display text, **not** billing/quota),
`maxAllowedSize`, `disabledMultimodal`, `supportsImages`, `supportsToolCall`, `supportsReasoning`,
`onlyReasoning`, `reasoning` (with `effort`, `defaultEffort`, `supportedEfforts`, `summary`,
`canDisableThinking`), `temperature`, `top_k`, `top_p`, and `repetition_penalty` (last three keep
snake_case field names).

**Sparse field rule:** each field can be absent; absence means unknown/undeclared — do not infer
`false`, `0`, or disable features. Explicit `false`, `0`, and empty arrays are preserved as-is.
`credits` is display information, not a balance, billing fact, or available quota.

Use `id` as the `model` field for `chat.completions.create()` and `name ?? id` for display. Missing
optional capability or limit fields mean unknown — do not infer that the model lacks a feature.
The SDK never exposes provider endpoints, credentials, request templates, routing/gray policy, or
enterprise permission details. An empty list is legal — surface it instead of inventing a fallback
model id.

## Not Exposed Through the SDK

The following management interfaces have **no SDK surface**:

- Model call usage / consumed volume.
- Remaining quota, quota limits, or the accounting period.
- Billing, unit prices, or monetary amounts.
- Per-model rate-limit numbers.
- Config V3 product configuration introspection.

When any of these is requested, say plainly that the SDK does not expose it and point at the
ClawClaw console, which does. Do **not** fabricate numbers, endpoints, or SDK methods, do not guess
usage from response headers, and do not invent a billing API. This is about where the data lives, not
about a missing product capability — do not tell the user the feature does not exist.

## Safety Notes

- The model list is scoped to the current app; never invent or combine models from another app.
- Usage, quota, and billing have no SDK surface. Do not infer them from response headers, model
  pricing fields, or token chunks.
- When quota information is required, direct the user to the ClawClaw console rather than
  inventing a programmatic endpoint.

## Completion Bar

The model list is reported faithfully; usage/quota/billing requests clearly state that the SDK does
not expose that data and point at the console.
