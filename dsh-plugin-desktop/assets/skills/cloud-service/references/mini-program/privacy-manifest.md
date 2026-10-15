# Privacy Manifest (`.<applicationId>.privacy.json`)

A WeChat mini program that touches user personal information cannot ship without a
用户隐私保护指引: before it may call any privacy interface, the developer must declare **which**
user information it collects and **what for**. That declaration reaches WeChat as `setting_list`,
an array of `{ privacy_key, privacy_text }` pairs.

Nobody is better placed to enumerate that list than whoever wrote the code — which is you. So the
last step of generating a mini program on the Cloud-service path is to write that enumeration down
as a file in the project. It is **mandatory**, and it comes last: only once the code is final do you
know what it actually collects.

## The file

| Field | Value |
|---|---|
| Path | `.<applicationId>.privacy.json` — a **hidden file** (leading dot included) at the **mini-program project root**, next to `app.json` |
| `<applicationId>` | the `wbapp_…` id from the `clawclaw_cloud_service` result — **not** the WeChat appid |
| Content | a JSON array of single-key objects: `[{ "<privacy_key>": "<privacy_text>" }]` |

You **MUST** write it. For `applicationId` `wbapp_a1b2c3` the file is `.wbapp_a1b2c3.privacy.json`:

```json
[
  { "Location": "为你推荐附近的门店" },
  { "Album": "上传菜品图片" },
  { "PhoneNumber": "接收订单通知" }
]
```

`applicationId`, not the WeChat appid: at code-generation time the mini program has not been bound
or created yet, so **the WeChat appid does not exist**. Waiting for it would mean never writing the
file. Do not substitute `touristappid`, do not read a placeholder out of `project.config.json`, and
do not invent an appid-shaped string.

## What it is and is not

It is a **hand-off artifact**: it tells the user (and the next agent) exactly which privacy
capabilities the generated code exercises, so filling in the privacy form is transcription rather
than an audit of unfamiliar code.

It is **not a contract the backend reads.** The authority for the 用户隐私保护指引 is the privacy
form the publish flow raises, which posts to WeChat's `setprivacysetting`. No publish path
parses this file. So:

- Writing it does **not** configure the privacy guideline — say so when you report.
- A privacy interface whose information type has not been declared **through that form** fails at
  runtime. Writing this file does not unblock it. Point the user at the form.

## `privacy_key` — the official values

`privacy_key` also accepts custom strings, but **prefer an official key whenever one fits**: a
custom key that duplicates an official one reads as a second, unrecognized capability during
review. WeChat may extend this list; treat it as current-as-of-writing, not exhaustive.

| `privacy_key` | 含义 |
|---|---|
| `UserInfo` | 用户信息（微信昵称、头像） |
| `Location` | 位置信息 |
| `ChooseLocation` | 选择的位置信息 |
| `Address` | 地址 |
| `Invoice` | 发票信息 |
| `PhoneNumber` | 手机号码 |
| `Email` | 邮箱 |
| `Contact` | 通讯录（仅写入）权限 |
| `CalendarWriteOnly` | 日历（仅写入）权限 |
| `Album` | 选中的照片或视频信息 |
| `AlbumWriteOnly` | 相册（仅写入）权限 |
| `Camera` | 摄像头 |
| `Record` | 麦克风 |
| `MessageFile` | 选中的文件 |
| `Clipboard` | 剪切板 |
| `BlueTooth` | 蓝牙 |
| `DeviceInfo` | 设备信息 |
| `RunData` | 微信运动数据 |
| `LicensePlate` | 车牌号 |
| `Accelerometer` | 加速传感器 |
| `Compass` | 磁场传感器 |
| `DeviceMotion` | 方向传感器 |
| `Gyroscope` | 陀螺仪传感器 |
| `EXIDNumber` | 身份证号码 |
| `EXOrderInfo` | 订单信息 |
| `EXUserPublishContent` | 发布内容 |
| `EXUserFollowAcct` | 所关注账号 |
| `EXUserOpLog` | 操作日志 |

## How to derive the list

Two independent sources, and both must be swept — a list built from only one of them is
systematically incomplete.

### 1. WeChat APIs the code calls

This table is transcribed from WeChat's own 隐私接口 ↔ 处理的信息 mapping. Grep the generated
source for these call sites — **exactly these**. An API that is absent from the table is not a
privacy interface, so do not infer a key for it: `wx.getSystemInfo` / `wx.getDeviceInfo` /
`wx.scanCode` / `wx.createCameraContext` look privacy-adjacent but are **not** on WeChat's list,
and declaring a key for them adds a capability you must justify at review.

Each row also covers the matching `wx.authorize({ scope: … })` call, which is a declaration of the
same intent.

| Called in the code | `privacy_key` |
|---|---|
| `wx.getLocation` / `wx.getFuzzyLocation` / `wx.startLocationUpdate` / `wx.startLocationUpdateBackground` / `MapContext.moveToLocation` | `Location` |
| `wx.chooseLocation` / `wx.choosePoi` | `ChooseLocation` |
| `wx.chooseAddress` | `Address` |
| `wx.chooseInvoice` / `wx.chooseInvoiceTitle` | `Invoice` |
| `<button open-type="chooseAvatar">` / `<input type="nickname">` | `UserInfo` |
| `<button open-type="getPhoneNumber">` / `<button open-type="getRealtimePhoneNumber">` | `PhoneNumber` |
| `wx.chooseLicensePlate` | `LicensePlate` |
| `wx.getWeRunData` | `RunData` |
| `wx.chooseImage` / `wx.chooseVideo` / `wx.chooseMedia` | `Album` |
| `wx.saveImageToPhotosAlbum` / `wx.saveVideoToPhotosAlbum` | `AlbumWriteOnly` |
| `<camera>` / `<live-pusher>` / `<voip-room>` / `wx.createVKSession` | `Camera` |
| `wx.startRecord` / `RecorderManager.start` / `wx.joinVoIPChat` / `<live-pusher>` | `Record` |
| `wx.chooseMessageFile` | `MessageFile` |
| `wx.setClipboardData` / `wx.getClipboardData` | `Clipboard` |
| `wx.addPhoneContact` | `Contact` |
| `wx.addPhoneCalendar` / `wx.addPhoneRepeatCalendar` | `CalendarWriteOnly` |
| `wx.openBluetoothAdapter` / `wx.createBLEPeripheralServer` | `BlueTooth` |
| `wx.startAccelerometer` | `Accelerometer` |
| `wx.startCompass` | `Compass` |
| `wx.startDeviceMotionListening` | `DeviceMotion` |
| `wx.startGyroscope` | `Gyroscope` |

`<live-pusher>` appears twice on purpose: it both captures video and records audio, so it needs
`Camera` **and** `Record`.

`wx.getUserInfo` / `wx.getUserProfile` / `<button open-type="userInfo">` are the **回收** (retired)
way to obtain a nickname and avatar. Do not generate them; use `chooseAvatar` / `type="nickname"`
above. If you are extending an existing project that still calls them, they remain `UserInfo`.

### 2. Personal information the app collects on its own

The `EX*` keys and several others have **no** `wx.*` call behind them — they are triggered by your
own forms and writes. A page with an 身份证号 input that persists to `cloud.database` collects
`EXIDNumber` just as surely as `wx.getLocation` collects `Location`, and it is the easier one to
miss precisely because no API name shows up in a grep.

So also read what the app **stores**: every form field, every `cloud.database` write, every
`cloud.storage` upload. 身份证号 → `EXIDNumber`; 订单 → `EXOrderInfo`; user-authored posts /
comments / reviews → `EXUserPublishContent`; 关注列表 → `EXUserFollowAcct`; behaviour or access
logs → `EXUserOpLog`; a 邮箱 field → `Email`; a 车牌号 typed by hand → `LicensePlate`; a manually
typed address → `Address`; a manually typed phone number → `PhoneNumber`.

Note the last three: `Address`, `PhoneNumber` and `LicensePlate` are about the **information**, not
about the WeChat API that happens to supply it. A plain `<input>` collects them just as much as
`wx.chooseAddress` does, so they belong on the list either way.

### Rules for the list itself

- **Declare exactly what the code does — no more.** Every extra key is a privacy claim the user
  must justify at review; padding the list "just in case" is a real cost, not a safe default.
- **And no less.** An information type left out of the guideline makes the matching privacy
  interface fail at runtime, and an undeclared collection is a compliance problem. If you wrote the
  call, list it.
- **One entry per key**, no duplicates. If one key serves several purposes, merge them into a
  single `privacy_text` (`"推荐附近门店、计算配送距离"`).
- **`privacy_text` is the purpose, not the capability.** The mini program renders it as 为了{text}，
  so write `"推荐附近的门店"`, never `"获取位置信息"` (restating the key) and never a leading
  「为了」/「用于」. Keep it in the user's language, concrete and short.
- Write `[]` when the app collects nothing — an empty array is a meaningful statement, and it keeps
  the file's presence from implying an unwritten list.

### What the SDK does and does not settle

`@tencent-ai/clawclaw-cloud-sdk/miniprogram` is the app's own backend client, so what matters
first is what the app puts **through** it: `cloud.storage` uploads of camera or album material
still need `Camera` / `Album`, and personal fields written through `cloud.database` still need
their `EX*` keys. Never list the SDK itself as a `privacy_key`.

Whether the SDK also has to be disclosed as a third-party SDK (`sdk_privacy_info_list` on the
WeChat side) is **not yours to decide** — that turns on the developer's own subject and legal
assessment. Do not assert either way in the manifest or your report; if the user raises it, point
them at the privacy form raised during publishing.

## Do not report it

Write the file, then say nothing about it. It is a machine-readable hand-off artifact — a hidden
dotfile whose audience is the publish flow and the next agent, not the person who asked for a mini
program. A non-developer cannot act on it, so naming it in the report only adds a line they have to
decode.

- Do **not** mention the file, its path, or its contents in your report.
- Do **not** explain what a privacy manifest or a 用户隐私保护指引 is as part of the delivery.
- It is not a user-facing deliverable — **Delivering artifacts** in `SKILL.md` governs what gets
  registered.
- Never write 「应用空间」 to the user anywhere.

Silent means unreported, not skipped, and the file still configures nothing on its own: the
用户隐私保护指引 only reaches WeChat through the privacy form the publish flow raises. That form comes
up by itself when the user reaches 正式版 publishing, which is the right time to answer it — see the
held-back list in [`routing.md`](routing.md) §C3.
