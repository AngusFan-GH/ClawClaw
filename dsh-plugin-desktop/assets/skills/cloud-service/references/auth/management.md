# Auth · Manage Providers and Inspect End Users

Use this reference when the user is operating the **ClawClaw cloud-service management page** for
the current application, or asks why Email, Phone or WeChat login is disabled or cannot be saved,
or why Email is degraded.
This is different from writing a login page:

- Generated application runtime code uses `cloud.auth` and
  [`code-generation.md`](./code-generation.md).
- ClawClaw operators manage Provider configuration through the trusted admin plane described here.
- End-user account inspection is read-only and remains a separate endpoint.

The cloud environment must already be bound to the application. Never accept an `envId`, TCB key,
COS key or service-role credential from the caller; the server resolves Application → Environment.

## Trusted Boundary

All requests require the ClawClaw operator login and current Application ownership. A generated
application's end-user session cannot call these endpoints.

```text
ClawClaw Auth page
  → /genie-baas/admin/auth/**
  → Agentserver resolves Application + Environment
  → TCB management API / encrypted Application credential store
```

Do not call TCB directly, do not infer Provider status from the user list, and do not use
`cloud.auth` as a management API.

## Provider State Model

This reference covers the Email, Phone and WeChat management contracts:

1. `email`
2. `phone`
3. `wechat`

Email and Phone are supported for web applications (Web / H5) and mini programs. WeChat also uses
one management contract across these application types; the application type determines the login
flow, not a different Provider key. Capability support does not mean every method is enabled.

The WeChat card is **one switch shared by both platforms** — the same backend field backs website
login and mini-program authorization. Say so in the card detail, otherwise a merchant turning it
off for one platform will not realize it also closed the other. Do not present binding a mini
program as a prerequisite for a web application.

`configured: true` only means the switch is writable. It does not promise that website login
already works on the published domain — that additionally needs the platform-side WeChat
credentials and callback domain, which are not visible through this API.

Render the recognized Providers returned by the list API. A missing Provider is not a malformed
list or a disabled Provider; do not require Email, Phone, Google or WeChat to be present. Skip
unrecognized entries without blocking the supported ones. The list describes management state,
not proof that every login flow for a returned Provider is available in the app's runtime.

Each card has three independent facts:

| Field | Meaning |
|---|---|
| `enabled` | The login method is currently open to application end users. |
| `configured` | All configuration required to enable it is complete. |
| `state` | `enabled`, `disabled` or `degraded`; degraded means the facts are inconsistent. |

Never render `enabled=true, configured=false` as healthy. Display `warning` and use the Provider
detail response to identify the missing source. In practice this combination only arises for Email —
Phone and WeChat report `configured=true` unconditionally (see their state sections below).

### Email state

Email is healthy only when the TCB Email Provider and Email login switch agree.

- `deliveryMode=platform`: TCB platform delivery. A non-null SMTP placeholder containing only
  `cloudbase_noreply@tencent.com` / security mode is **not** custom SMTP.
- `deliveryMode=custom`: host, port, account and password configuration must be complete.
- `templateMode=custom`: every non-empty template must contain `{{.VerificationCode}}`.

### Phone state

Phone carries **only** the summary facts plus `revision` and `editableFields` — there is no
delivery mode, no SMTP-equivalent and no template set in this detail response.

That is because the whole card derives from exactly one upstream field,
`DescribeLoginConfig.PhoneNumberLogin`: `enabled` mirrors it, and `configured` is always `true`.
So `state` is only ever `enabled` or `disabled` — **Phone cannot be `degraded`**, and there is no
"missing configuration" for this card to report.

The only thing this card can change is the `enabled` switch. Do **not** invent SMS sender,
signature, template or quota fields for it, and do not present the absence of those fields as
"unconfigured".
The platform supplies the 【clawclaw】 signature, message body and code validity. Displaying this
information or a disabled custom-signature option does not make it an editable API field.

### WeChat state

WeChat login uses the application's ClawClaw `wechat_login_enabled` switch. `enabled` mirrors
that switch, `configured` is always `true`, and `state` is `enabled` or `disabled`.
Its source is `clawclaw_application_config`; it does not configure a TCB WeChat identity provider.

Each application stores its own value: management resolves `applicationId` to its cloud-service
record and updates only that record. Web quick login and QR-code scan share the web application's
switch. A mini program uses the same field in its own record; changing one application does not
toggle another. There are no separate quick-login and QR-code Provider keys in this contract.

`configured=true` describes this management switch, not proof that a login flow has succeeded:

- For mini programs, check the trial/formal binding and validate login in WeChat with the runtime
  appid. H5 preview cannot obtain a real `wx.login` code.
- For web login, validate the SDK/Relay flow and registered HTTPS callback on the published
  application. Quick confirmation and QR-code scan are WeChat-side interactions within this flow;
  quick login depends on client conditions. Mini-program binding and a runtime appid are not
  prerequisites. A mobile H5 website is distinct from the mini-program H5 simulator.

## Provider HTTP Contract

Public paths have **no `/v1` segment**.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/genie-baas/admin/auth/providers` | Provider summaries for the current application |
| `GET` | `/genie-baas/admin/auth/providers/email` | Email delivery/template detail |
| `PATCH` | `/genie-baas/admin/auth/providers/email` | Save Email Provider |
| `GET` | `/genie-baas/admin/auth/providers/phone` | Phone detail (summary + revision) |
| `PATCH` | `/genie-baas/admin/auth/providers/phone` | Toggle Phone login |
| `GET` | `/genie-baas/admin/auth/providers/wechat` | WeChat login switch detail |
| `PATCH` | `/genie-baas/admin/auth/providers/wechat` | Toggle WeChat login |
| `GET` | `/genie-baas/admin/auth/users` | Read-only end-user list |

The path segment is `phone`, **not** `sms`.

Read requests carry `applicationId` in query. Provider PATCH requests carry it in the JSON body.
Successful responses use the common `{ code: 0, msg: "success", data }` envelope.

### Load the page

```text
GET /auth/providers?applicationId=...
  → render the recognized Providers included in the response

User opens a card
  → GET /auth/providers/{provider}?applicationId=...
```

Do not fetch all details just to render the list. Do not query `/auth/users` to derive card state.

## Save Email Safely

Email detail carries `revision`; its PATCH must echo it as `expectedRevision`.

```ts
interface UpdateEmailProviderRequest {
  applicationId: string
  expectedRevision: string
  enabled?: boolean
  delivery?: {
    mode: 'platform' | 'custom'
    smtp?: {
      serverHost: string
      serverPort: number
      accountUsername: string
      accountPassword?: string
      senderAddress: string
      securityMode: 'AUTO' | 'SSL' | 'STARTSSL' | 'NO_SSL'
    }
  }
  templates?: {
    mode: 'platform' | 'custom'
    registerSignInZhCN?: string
    registerSignInEnUS?: string
    defaultTplZhCN?: string
    defaultTplEnUS?: string
  }
}
```

Rules:

- Switching to custom SMTP requires all fields including a password.
- Changing a custom SMTP host/port/account/sender/security field requires a new password.
- An empty password may preserve the old password only when no other SMTP field changes.
- Passwords never appear in responses, logs, audit details or revisions.
- Save success means the server wrote upstream configuration, read it back, and verified the
  resulting state. Do not show success before the PATCH response returns.

## Save Phone Safely

Phone accepts only three fields — there is nothing else to send:

```ts
interface UpdatePhoneProviderRequest {
  applicationId: string
  expectedRevision: string   // required
  enabled?: boolean
}
```

`expectedRevision` is rejected when empty, so read the detail first. Any other key (sender,
signature, template, quota, …) is not part of this contract; do not add one.

## Save WeChat

```ts
interface UpdateWechatProviderRequest {
  applicationId: string
  enabled: boolean
}
```

WeChat does not use `expectedRevision`; the last successful switch update takes effect. The server
reads back the switch before returning the detail. Do not request AppSecret, TCB credentials or
binding parameters for this form: enabling login configures the switch, not runtime credentials
or mini-program binding.

## Conflict and Error Handling

| HTTP | Code | Action |
|---:|---:|---|
| 400 | `18300` / `18356` | Keep the form; highlight invalid fields or missing replacement Secret. |
| 401 | — | Ask the operator to sign in again. |
| 403 | `18302` | Stop; the current operator does not own the Application scope. |
| 404 | `18301` / `18304` / `18353` | Refresh Application/cloud-service state; do not create a fake Provider. |
| 409 | `18354` / `18355` / `18310` | Reload detail. For revision conflict, let the operator reapply changes. |
| 502 | `18357` | Upstream TCB update/readback failed; keep current form and reload state. |

Never retry a mutation automatically: a multi-step upstream write may have partially completed.
Reload the Provider detail before the next operator action.

## Read-Only End Users

```http
GET /genie-baas/admin/auth/users
  ?applicationId=<application-id>
  &offset=<non-negative integer>
  &limit=<positive integer>
Authorization: Bearer <ClawClaw operator login>
```

Response:

```ts
interface EndUser {
  uid: string
  email?: string
  phoneNumber?: string
  name?: string
  provider?: string
  isAnonymous: boolean
  createdAt: string
}

interface ListEndUsersResponse {
  items: EndUser[]
}
```

This endpoint does not disable/delete users, reset passwords, bind Providers, or indicate whether a
Provider is configured. Mask email/phone values in conversational output.

Users who signed in through WeChat have **no `email` and no `phoneNumber`** — WeChat does not hand
those over — so the list shows a bare `uid`. That is the expected shape, not missing data; do not
report it as a defect or suggest backfilling it.

## Troubleshooting Checklist

### Email card is enabled but degraded

1. Load Email detail, not the End User list.
2. Check whether `deliveryMode` is unexpectedly `custom`.
3. A platform SMTP placeholder must map to `platform`; do not ask for SMTP credentials merely
   because TCB returned a non-null placeholder.
4. Confirm Email login switch and Provider `On` agree.
5. Confirm custom templates contain the verification-code variable.

### Phone card is on but SMS does not arrive

The detail response carries no delivery or template fields, and Phone cannot be `degraded`, so there
is nothing on this card to "fix" — resist the pull to go looking for a misconfiguration it cannot
express.

1. Confirm the card reports `enabled=true`. If it is `disabled`, that is the whole finding: TCB
   `PhoneNumberLogin` is off, and the fix is the toggle.
2. Confirm the generated app actually sends `phone` (not `email`) to `sendOtp` — a wrong-channel call
   fails without ever reaching SMS delivery.
3. Everything past that point — sender signature, template approval, per-number rate limits, SMS
   balance — sits upstream of this API and **is not observable through it**. Say so plainly and stop.
   Do not infer a cause from the end-user list, and do not send the user to reconfigure something
   this page does not own.

## Completion Bar

Provider management is complete only when:

1. The list and opened detail agree on `enabled/configured/state`.
2. Email/Phone saves use the latest revision; WeChat saves send the required `enabled` boolean
   without `expectedRevision`. The returned detail replaces local state.
3. Secrets are absent from responses/logs and cleared from UI inputs.
4. Email platform/custom delivery is distinguishable.
5. Phone is presented as a toggle-only card — no fabricated SMS delivery/template/quota fields, and
   no `degraded` state invented for it.
6. Cross-Application access is rejected.
7. End-user inspection remains read-only and is never used as Provider truth.
8. WeChat is presented according to the returned management contract; its `configured=true` is not
   used to claim that runtime setup, mini-program binding or real-login validation is complete.
   Quick login and QR-code scan operate on the same application's WeChat switch; another
   application's switch remains independent.
