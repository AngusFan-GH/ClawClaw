# Auth · Write Auth Code

Use this reference when adding end-user authentication to a ClawClaw application.
The cloud service environment must already be active and `publicConfig` must be available.

## Availability Boundary

The supported authentication capabilities are listed below. Generate the methods selected by the
user's request or the applicable default; this list does not require every method to be enabled or
every Provider to be returned for an application.

- Email OTP registration/login.
- Email + password login.
- **Phone (SMS) OTP registration/login.**
- WeChat login: website authorization (quick login / QR-code scan) or mini-program login.
- Forgot-password and signed-in password change.
- Session persistence, refresh, user lookup, sign-out and auth-state events.

### Capabilities by Application Type

| Login method | Web app (Web / H5) | WeChat mini program |
|---|---|---|
| Email OTP | yes | yes |
| Email + password | yes | yes |
| Phone (SMS) OTP | yes | yes |
| WeChat authorization (微信授权登录) | website login, with quick login when the WeChat client supports it | mini-program login |
| WeChat QR-code scan (微信二维码登录) | yes, through the same website login flow | not applicable |

Use the application's type already established at creation. A mobile H5 website is a web app;
the H5 simulator for a mini program does not change that application's type.

Web quick login and QR-code scan are two interactions within one WeChat website OAuth flow.
Both use the application's `wechat` Provider and `wechat_login_enabled` switch. Mini programs
reuse that management contract with their own login flow. Each application has its own switch
value; changing one application does not change another.

They are still **different SDK calls**: a web app uses [Web WeChat Login](#web-wechat-login)
(`signInWithOAuth` + Relay); a mini program uses `wx.login` (see the mini-program section).
Do not cross-wire them.

Use the public SDK contract for the selected flow. If the SDK version or configuration in use
lacks a required capability, identify that specific dependency gap. Do not convert an integration
gap into a permanent platform restriction or silently substitute another login method.

Do **not** generate anonymous login, username login, provider bind/unbind, captcha, device-code
or admin user mutations. Those are not enabled in the provisioned environment and are not
part of the public SDK contract. The generic QR-code login that is **not** available is a
homegrown "scan to log in" between your own pages — WeChat's `qrconnect` website login below
is a supported flow and is not covered by that restriction.

Provider bind/unbind is account linking, not WeChat sign-in. Do not interpret that
restriction as a reason to reject 微信登录 / 微信授权登录 / 微信一键登录.

For **web OAuth**, the application callback uses its registered HTTPS release domain; localhost
and preview URLs are not OAuth callback targets. The platform hosts the WeChat website credentials
and Relay, so the user does not register a WeChat website application or supply an AppSecret.
This OAuth callback requirement does not restrict Email or Phone to one application type.
A **WeChat mini program** uses its request-domain allowlist and `Referer` instead of a browser
OAuth callback. Do not add a mock or localStorage-only fallback in either runtime.

The right-panel **H5 mini-program preview** cannot obtain a real `wx.login` code. This is a preview
limitation, not a missing cloud-service capability: generate the WeChat login flow and verify it in
the authorized mini program on WeChat. Do not replace it with email/SMS login because of this limit.

Use `@tencent-ai/clawclaw-cloud-sdk`. Do not initialize `@cloudbase/js-sdk` separately and do not
call `/.cloud/auth/**` with hand-written `fetch`.

## Initialize Once

All three SDK forms are available — see **How an App Talks to It** in `SKILL.md` for how to choose.
For a WeChat mini program, use the 小程序 initialization in [SKILL.md](../../SKILL.md) and its
[request diagnostics adapter](../mini-program/diagnostics.md) instead of either form below.
The common Auth methods use the same client; only mini-program WeChat login requires `wx`.

npm package (projects with a build step):

```ts
import { createClawClawCloud } from '@tencent-ai/clawclaw-cloud-sdk'

export const cloud = createClawClawCloud({
  endpoint: publicConfig.endpoint,
  oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
  publishableKey: publicConfig.publishableKey,
})
```

`oauthRelayBaseUrl` is the OAuth Relay base URL — it belongs to `signInWithOAuth` as a whole, not
to any one provider; WeChat QR sign-in is simply the only provider currently offered. Pass it
whenever you have it: it is optional in the type and silently defaults to an empty string, so a
missing line surfaces much later as `signInWithOAuth requires oauthRelayBaseUrl` on the login
button.

CDN `<script>` (plain HTML, no build step) — same options, reached through the `ClawClawCloud`
global:

```html
<script src="https://cdn.jsdelivr.net/npm/@tencent-ai/clawclaw-cloud-sdk@dev/lib/index.global.js"></script>
<script>
  const cloud = ClawClawCloud.createClawClawCloud({
    endpoint: publicConfig.endpoint,
    oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
    publishableKey: publicConfig.publishableKey,
  })
</script>
```

`endpoint` and `publishableKey` are **required** in every form. Never omit `endpoint` and
lean on the SDK's same-origin fallback, and never hard-code it; the only source is the
`publicConfig` returned by `clawclaw_cloud_service` (see **How an App Talks to It** in `SKILL.md`).
A mini program has no `location.origin`, so there is no same-origin fallback to lean on there at all.
The email, phone and session snippets below are form-agnostic once `cloud` exists.

The same `cloud` instance is shared by Auth, Database, Storage and LLM. After login, the shared
request layer automatically sends the latest ClawClaw session to Database and Storage requests.

## Public Capability Table

| Capability | SDK method |
|---|---|
| Email OTP login/registration | `signInWithOtp({ email })` to send, then `challenge.verify({ token, password })`; `password` is required for new email signup, not existing-user OTP login |
| Phone OTP login/registration | `signInWithOtp({ phone })` to send, then the returned challenge's `verify({ token })` to submit |
| Low-level send/verify OTP | `sendOtp({ email })` / `sendOtp({ phone })` + `verifyOtp(...)` |
| Email + password login | `signInWithPassword({ email, password })` |
| WeChat mini-program login | `signInWithWechat(code, appid)` after `wx.login` |
| WeChat website login (quick / QR-code) | Use the web initiation and callback APIs documented by the SDK in use; see [Web WeChat Login](#web-wechat-login) |
| Verified signup after OTP | `signUp({ email \| phone, password, verificationToken })` — `password` required for email, optional for phone |
| Forgot password | `resetPasswordForEmail(email)` |
| Change password while signed in | `resetPasswordForOld({ oldPassword, newPassword })` |
| Current session | `getSession()` |
| Force refresh | `refreshSession()` |
| Verified current user | `getUser()` |
| Token for the app's own backend | `getAccessToken()` |
| Sign out | `signOut()` |
| Observe changes | `onAuthStateChange(callback)` |

## Default Login UI Contract

For **web applications**, select login methods from the request:

- An email request selects Email; respect a narrower OTP-only or password-login request.
- 手机号登录 / 手机号注册 / 短信验证码 selects Phone OTP.
- 微信登录 / 微信一键登录 / 微信授权 / 微信快捷登录 / 微信扫码登录 selects
  [Web WeChat Login](#web-wechat-login), covering quick and QR-code interactions through one flow.
- A generic request such as 登录 / 注册 / 账号 / 会员 / 个人中心 / 我的页面 selects Phone OTP and
  WeChat login by default. Email remains supported; it is not mandatory for that default.
- An explicit choice such as email-only or phone-only takes precedence over that default.

Selecting a method for generated UI does not itself enable its Provider. Use the available trusted
management capability to apply the requested settings and read them back; if it is unavailable,
report that setup gap instead of claiming the switch was enabled or calling admin APIs from the app.

For **mini programs**, an explicit WeChat request uses
[WeChat Mini-Program Login](#wechat-mini-program-login); an explicit phone request uses Phone OTP.
Keep the existing email default when no method is specified. A WeChat-only request does not require
email/password or SMS forms.

When email login is selected without a narrower requirement, provide:

1. Email + password login through `cloud.auth.signInWithPassword`.
2. Email OTP login through `cloud.auth.signInWithOtp` or `sendOtp` + `verifyOtp`.
3. Verified signup with email OTP **and a password**.
4. Forgot-password flow when password login is present.

Only include additional login methods when selected by the request or the applicable default.
When Phone OTP is selected, requirement 3 above does not carry over: SMS signup normally has no
password, so a phone-only signup path may omit it. If the user wants phone signup *and* password
login on the same account, that needs an explicit password field — do not silently create an account
with an empty password when the UI promises password login.

## Mandatory Auth Gate for User Data

Never solve data-access errors by adding anonymous login. Anonymous login is deliberately not part
of the auth surface — protected data requires a real identity by design. Do not create
localStorage-only users, mock sessions or other fallback identities to make protected data appear to
work.

Before reading or writing user-scoped Database rows or Storage files, check the current session:

```ts
const { data: session, error } = await cloud.auth.getSession()
if (error || !session) {
  showLoginView()
  return
}
```

Only explicitly public-read tables may be queried before sign-in. Storage is for signed-in users;
do not upload, list, download, copy, move or delete user paths before sign-in. For user-owned
database rows, do not send `owner_id` from client code; the table should use
`owner_id TEXT NOT NULL DEFAULT auth.uid()` and RLS policies with
`WITH CHECK (owner_id = auth.uid())`.

## Web WeChat Login

This flow applies to web applications, including mobile H5 websites:

```text
Application / SDK starts WeChat login
  → platform Relay
  → WeChat website authorization (quick confirmation or QR-code scan)
  → platform Relay returns to the application callback
  → SDK completes login and obtains a ClawClaw session
```

The application provides a WeChat login entry, handles the callback and displays the resulting
session or error. WeChat supplies the quick-login / QR-code interaction according to client
conditions. Do not build two independent auth protocols, require a quick-login button on every
device, or implement local WeChat-client detection in the generated app.

Requires `oauthRelayBaseUrl` at initialization (see [Initialize Once](#initialize-once)).
Two call sites, and they use **different** SDK methods.

```ts
// 1. The login button. signInWithOAuth does not navigate — it returns the URL to go to.
const { data, error } = await cloud.auth.signInWithOAuth({
  provider: 'wechat',
  // The site root. Never a sub-path such as '/auth/callback' — see below.
  redirectTo: location.origin,
})
if (error) {
  showLoginError(error.message)
} else {
  location.assign(data.url)
}
```

```ts
// 2. App entry. Run this unconditionally on every startup, before any route guard.
const { data: session, error } = await cloud.auth.handleWechatWebCallback()
if (error) {
  showLoginError(error.message)
} else if (session) {
  // MANDATORY: strip code/state from the URL before doing anything else.
  history.replaceState(null, '', location.pathname)
  goToApp()
} else {
  // No code in the URL — an ordinary visit, or the URL was already cleaned up
  // after a successful login. Continue booting normally, this is not an error.
  continueNormalStartup()
}
```

Note the three-way result: `handleWechatWebCallback` resolves to `null` data (no error) when the
URL carries no `code`. Branch on `session` explicitly — `if (!error)` alone will send every
ordinary visit into the logged-in state without a session.

**Always clear the URL after a successful callback.** The `state` is single-use and is consumed by
the exchange. Leave `?code=...&state=...` in the address bar and the user's next refresh replays a
spent code, producing a login failure on a page they already logged in from. This looks like a
backend bug and is not one — it will happen in testing if the line is missing.

### The redirect target must be the site root

Generated applications are served as **static files with no history fallback**: a request for
`/auth/callback` looks for a file at that path, does not find one, and returns **404** before any
JavaScript runs. The WeChat `code` is then lost, and the user — who already scanned successfully —
lands on a bare error page. Only the root path is guaranteed to resolve to `index.html`.

Do not "fix" this by adding a `/auth/callback` route in the client router: client routes cannot run
if the server never serves the document. Do not create a separate `callback.html` either — it is a
second document that has to initialize the SDK all over again, for no benefit over the root.

`redirectTo` must also be on the application's **published HTTPS domain** (see the availability
boundary above). `localhost` and ClawClaw preview are rejected by the Relay, so this flow cannot
be verified before publishing — that is a platform boundary, not a missing capability. Say so
plainly rather than building a mock fallback.

### The callback must run before the route guard

Because the redirect lands on the root, `handleWechatWebCallback()` has to run at app startup
unconditionally, ahead of any authentication guard. A guard that redirects unauthenticated visitors
to a login view will otherwise tear down the page while `?code=...` is still unexchanged, and the
code is single-use — the user cannot simply retry.

Two mistakes that compile and then fail:

- Do **not** call `handleOAuthCallback()` here. That one is the retired Google flow and requires a
  `provider_id=custom-oauth` query parameter that the WeChat redirect does not carry.
- Do **not** call `wx.login` or `signInWithWechat` in a web app. Those need the mini-program
  runtime, which a browser does not have.

Configuration is the platform's: never ask the user for a WeChat AppID/AppSecret, and never put one
in the generated app. The merchant's only control is the switch in the ClawClaw management UI
(see [management.md](management.md)); when it is off, `signInWithOAuth` returns 未打开微信登录.

On success, reuse the ClawClaw session for the normal auth gate and protected requests.
Rejected authorization or a failed exchange must not produce a signed-in view.

## WeChat Mini-Program Login

Mini programs only — a web app uses [Web WeChat Login](#web-wechat-login) instead.

Initialize `cloud` once with the [SKILL.md](../../SKILL.md) mini-program example and
[request diagnostics adapter](../mini-program/diagnostics.md), then call this flow from the login action:

```ts
wx.login({
  async success({ code }) {
    try {
      const appid = wx.getAccountInfoSync().miniProgram.appId
      const { data: session, error } = await cloud.auth.signInWithWechat(code, appid)
      if (error) {
        showLoginError(error.message)
        return
      }
      showSignedInView(session.user)
    } catch (error) {
      console.error('[ClawClaw Cloud] login failed', JSON.stringify({
        stage: 'wechat-login-handler',
        message: error instanceof Error ? error.message : '微信登录失败，请重试',
      }))
      showLoginError('微信登录失败，请重试')
    }
  },
  fail(error) {
    console.error('[ClawClaw Cloud] login failed', JSON.stringify({
      stage: 'wx.login',
      message: error.errMsg,
    }))
    showLoginError(error.errMsg)
  },
})
```

- The request diagnostics adapter already logs SDK request failures; the `if (error)` branch
  only updates the UI. Log `wx.login` failures and unexpected handler exceptions as above, using
  only `stage` and `message`; never log the original error object, login code or session.
- Pass the **current runtime appid**. Trial and formal releases are separate mini programs; do not
  hard-code either appid or use the ClawClaw `applicationId` (`wbapp_…`) in its place.
- The application must have an authorized mini-program binding and its WeChat login switch must
  be enabled. These are application setup requirements, not reasons to declare login unsupported
  or omit its implementation. Check binding in the mini-program application space and the switch
  through [`management.md`](./management.md).
- The SDK sends `{ code, appid }` to `POST /.cloud/auth/v1/login-wechat`. The cloud backend exchanges
  the code and returns a ClawClaw session; the app does not implement `jscode2session`, collect an
  AppSecret or store `openid` as its own authentication credential.
- Reuse the returned session for the same Database/Storage auth gate and session lifecycle as other
  login methods. Login establishes identity; it does not promise access to a WeChat avatar or nickname.

## Choosing Between the OTP Entry Points

This applies to both email and phone OTP.

**Both `sendOtp` and `signInWithOtp` send a new code. Neither verifies a code already entered.**
Bind sending and verification to separate user actions:

- **Get code / Resend**: call one send method and keep its result in form/component state across
  events. Save the recipient, `verificationId` and `isExistingUser`, or the returned challenge.
- **Login / Register**: use that saved result with `verifyOtp` or `challenge.verify`. Never call
  `sendOtp` or `signInWithOtp` in this handler, including when retrying an incorrect code.
- If the recipient changed or no challenge is available, ask the user to get a code for the current
  recipient. Only a successful explicit resend replaces the saved challenge; successful login clears it.

Use `sendOtp` + `verifyOtp` for the explicit handlers below. With `signInWithOtp`, save
`started.data` in the send handler and call its `verify({ token: verificationCode })` later in the
submit handler, also passing `password` for new email registration. Disable sending and submission
while a send request is in flight, and apply the
resend countdown only to the send action; submitting an already received code must remain available.

Unlike the returned challenge's `verify`, a direct `verifyOtp` call does not retain the recipient
or account state. Pass `verificationId`, `token`, the same `email` or `phone`, and the
`isExistingUser` returned by `sendOtp`. Do not infer `isExistingUser` from the selected UI tab.

The SDK performs the closed flow:

```text
POST /v1/verification
  → verificationId + isExistingUser
POST /v1/verification/verify
  → one-time verificationToken
POST /v1/signin or /v1/signup
  → ClawClaw session
```

## Email OTP

Keep the challenge outside the event handlers. Wire `sendEmailCode` to **Get code / Resend**
(a form button must have `type="button"`) and `submitEmailOtp` to **Login / Register**
(prevent the form's default submission). A new email account requires a password; collect it
on the signup form before submission. Existing users can log in with the code alone.
The current SDK requires that signup password even when later login uses only OTP; it does not
require a password-login UI.

```ts
let pendingEmailOtp: { email: string; verificationId: string; isExistingUser: boolean } | null = null

async function sendEmailCode(email: string) {
  const sent = await cloud.auth.sendOtp({ email })
  if (sent.error) {
    showLoginError(sent.error.message)
    return
  }
  pendingEmailOtp = {
    email,
    verificationId: sent.data.verificationId,
    isExistingUser: sent.data.isExistingUser,
  }
  showCodeSent()
}

async function submitEmailOtp(email: string, verificationCode: string, password?: string) {
  const pending = pendingEmailOtp
  if (!pending || pending.email !== email) {
    showLoginError('Get a code for the current email first')
    return
  }
  const completed = await cloud.auth.verifyOtp({
    email: pending.email,
    verificationId: pending.verificationId,
    isExistingUser: pending.isExistingUser,
    token: verificationCode,
    password: pending.isExistingUser ? undefined : password,
  })
  if (completed.error) {
    showLoginError(completed.error.message)
    return
  }
  pendingEmailOtp = null
  showSignedInView(completed.data.user)
}
```

Do not expose whether an email is registered in user-facing copy.

## Phone (SMS) OTP

For the current mainland-China phone input, validate **Get code / Resend** before calling the SDK:
accept exactly 11 digits starting with `1` (`/^1\d{10}$/`). Otherwise, send no request and show
**请输入正确的 11 位手机号** below the phone input. Clear that field error when the user edits
the number. This rule is for the mainland-number UI; adapt validation if another region is
explicitly supported, rather than applying this regex to all phone numbers.

Keep the challenge outside the event handlers. Wire `sendPhoneCode` to **Get code / Resend**
(a web form button must have `type="button"`) and `submitPhoneLogin` to **Login / Register**
(prevent the form's default submission). Pass the current input values to each handler.
Wire `onPhoneInput` to phone edits; `setPhoneError` updates form state rendered below that input:

```ts
let pendingOtp: { phone: string; verificationId: string; isExistingUser: boolean } | null = null

function onPhoneInput() {
  setPhoneError('')
}

async function sendPhoneCode(phone: string) {
  if (!/^1\d{10}$/.test(phone)) {
    setPhoneError('请输入正确的 11 位手机号')
    return
  }
  setPhoneError('')
  const sent = await cloud.auth.sendOtp({ phone })
  if (sent.error) {
    showLoginError(sent.error.message)
    return
  }
  pendingOtp = { phone, ...sent.data }
  showCodeSent()
}

async function submitPhoneLogin(phone: string, verificationCode: string) {
  const pending = pendingOtp
  if (!pending || pending.phone !== phone) {
    showLoginError('Get a code for the current phone number first')
    return
  }
  const completed = await cloud.auth.verifyOtp({
    phone: pending.phone,
    verificationId: pending.verificationId,
    isExistingUser: pending.isExistingUser,
    token: verificationCode,
  })
  if (completed.error) {
    showLoginError(completed.error.message)
    return
  }
  pendingOtp = null
  showSignedInView(completed.data.user)
}
```

- `email` and `phone` are **mutually exclusive** in `sendOtp` / `verifyOtp`, and the value passed to
  `verifyOtp` must be the same one used to send the code.
- **Pass the validated phone value unchanged to `sendOtp({ phone })`.** The SDK
  normalizes mainland numbers to `+86 <number>` and leaves other numbers unchanged; do not duplicate
  that normalization in app code.
- `emailRedirectTo` does not apply to SMS; there is no landing link in a text message.
- SMS signup usually has no password — `password` is optional **on the phone path only**.
  The current SDK requires a password for new Email signup and rejects a missing one.

Do not expose whether a phone number is registered in user-facing copy.

## Email + Password

```ts
const { data: session, error } = await cloud.auth.signInWithPassword({
  email,
  password,
})
if (error) {
  showLoginError('Wrong account or password')
  return
}
```

There is no unverified email+password signup. Signup requires a `verificationToken` obtained from OTP
verification — either email or phone OTP produces a usable one.

## Verified Signup with Password

New email accounts require verification and a password under the current SDK contract, including
when the page offers only OTP login. Reuse [Email OTP](#email-otp): the send handler saves
`pendingEmailOtp`; the submit handler validates the current email against the saved recipient,
then passes the complete saved state and password to `verifyOtp`:

```ts
const completed = await cloud.auth.verifyOtp({
  email: pending.email,
  verificationId: pending.verificationId,
  isExistingUser: pending.isExistingUser,
  token: verificationCode,
  password: pending.isExistingUser ? undefined : password,
})

if (completed.error) {
  showSignupError(completed.error.message)
  return
}
```

If the form is explicitly a signup form and the saved `isExistingUser` is true, route the user to
login with neutral copy instead of exposing account-existence details. Do not create an account with
an empty password when the UI promises password login.

## Password Recovery

```ts
const started = await cloud.auth.resetPasswordForEmail(email)
if (started.error) {
  showLoginError(started.error.message)
  return
}

const completed = await started.data.updateUser({
  nonce: verificationCode,
  password: newPassword,
})
if (completed.error) showLoginError(completed.error.message)
```

On success the SDK signs the user in and emits `PASSWORD_RECOVERY`.

Signed-in password change:

```ts
const result = await cloud.auth.resetPasswordForOld({
  oldPassword,
  newPassword,
})
if (result.error) showLoginError(result.error.message)
```

## Session and Route Guard

```ts
const { data: session, error } = await cloud.auth.getSession()
if (error || !session) {
  navigate('/login')
  return
}
```

`getSession()` refreshes near expiry. Use `refreshSession()` only when a forced refresh is needed.
`getUser()` calls `GET /.cloud/auth/v1/user/me`, so use it when server validation matters.

```ts
const unsubscribe = cloud.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') navigate('/login')
  renderUser(session?.user ?? null)
})
```

The SDK stores only the ClawClaw access token and an opaque `wbrt_...` refresh handle. Provider
tokens remain in Cloud Backend Service. Never log tokens or put them in a URL.

## Calling the Application's Own Backend

```ts
const token = await cloud.auth.getAccessToken()
if (!token) throw new Error('Sign in required')

await fetch('/api/orders', {
  headers: { Authorization: `Bearer ${token}` },
})
```

The application backend may validate that token through the current application's Auth data plane;
it must not copy the Cloud Backend Service signing key.

## Error Handling

Every Auth method except `getAccessToken()` returns `{ data, error }`. Branch on stable
`error.kind`, not message text. Treat `unauthenticated`/`invalid_grant` as a request to sign in again;
keep the current session on transient `network`/`backend-unavailable` errors.

## Completion Bar

For every generated login UI, inspect source before completion:

- Its login methods must match the explicit request or the runtime's default above.
- For email login/signup, verify the selected password/OTP/signup paths; email signup passes a
  password to `verifyOtp` or uses `signUp` after verification.
- It must include an auth gate before user-scoped Database or Storage calls.
- It must not include `signInAnonymously`, localStorage-only users or mock sessions.
- It must not initialize `@cloudbase/js-sdk` or hand-write `fetch('/.cloud/auth/**')`.

For every OTP form, check the event handlers and request sequence (local SDK mocks can verify
these rules without sending real messages):

- Every direct `verifyOtp` call passes the saved `email` or `phone`, `verificationId` and
  `isExistingUser`, plus the entered `token`. Check signup and OTP-login handlers separately.
- Get code once, then submit: exactly one `POST /v1/verification`, followed by
  `POST /v1/verification/verify` with that response's `verification_id`. Submission sends no new code.
- After verification, an existing user reaches `/v1/signin`; a new user reaches `/v1/signup`
  (with a password for email). Both must establish a session before showing signed-in content.
- Submit an incorrect code and retry: reuse the saved challenge, send no new code, and establish no
  session until verification succeeds.
- Submit before sending, or change the recipient after sending: prompt to get a code for that
  recipient without making an auth request. An explicit successful resend replaces the saved ID.
- A send failure (including HTTP 429) must not call verification or claim that a new code was sent.

Verify email/phone flows on the published web domain or in the authorized mini program:

1. OTP registration and existing-user OTP login.
2. Password login and password-reset flows only when those capabilities are included.
3. Session survives reload and refresh; concurrent refresh performs one exchange.
4. Database/Storage requests automatically carry the current session.
5. `getUser()` returns the signed-in user and sign-out removes access.

When Phone OTP is included, additionally check:

- For the mainland-number UI, enter a 10-digit number and click **Get code**: show
  **请输入正确的 11 位手机号** below the input, with no `POST /v1/verification` request. Editing
  the number clears the error without sending a request. An 11-digit number starting with `1`
  sends one request on the next **Get code** click; other invalid inputs remain blocked.
- `sendOtp` / `verifyOtp` are called with `phone` (never `email`) on that path, and the same number
  reaches both calls.
- The number is passed through as entered — no `+86` prepended, stripped or reformatted in app code.
- An existing-user SMS login and a new-user SMS signup both reach a session in that runtime.
- A wrong code leaves the user signed out; it must not fall through to a signup attempt.

For web WeChat login, verify:

- The client is initialized with `oauthRelayBaseUrl` from `publicConfig`.
- The entry uses `signInWithOAuth({ provider: 'wechat' })` and navigates to the returned `data.url`;
  app startup calls `handleWechatWebCallback` — **not** `handleOAuthCallback`. Quick login and
  QR-code scan do not introduce separate Provider switches.
- `redirectTo` is the site root, not a sub-path. A sub-path 404s before any JavaScript runs.
- `handleWechatWebCallback` runs unconditionally at startup, ahead of any route guard.
- It branches on `session` (not just on `error`) and clears `code`/`state` from the URL after a
  successful login. Refreshing the page after login must not produce a login error.
- There is no `wx.login` / `signInWithWechat` anywhere in the web source.
- Rejected authorization, invalid state or a failed exchange does not create a mock session.
- Verify on the published HTTPS domain. A localhost attempt is a platform boundary, not a defect
  to work around. Absence of quick login on another device is not a failed QR-code login.

For mini-program WeChat login, verify:

- The login action calls `wx.login`, then `signInWithWechat(code, appid)` with the returned code and
  `wx.getAccountInfoSync().miniProgram.appId`.
- In each release being delivered (trial or formal), an authorized binding and enabled login switch
  allow login to reach a ClawClaw session; protected Database/Storage requests reuse it.
- A `wx.login` failure or SDK error leaves the login UI in its failure state, without a mock session.
- H5 preview reports its WeChat authorization limitation; it is not counted as real-login validation.

If a login method is disabled, or Email appears degraded in the ClawClaw management page, do not
patch around it in generated application code. Use [`management.md`](./management.md) to inspect
Provider truth.
