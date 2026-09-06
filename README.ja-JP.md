# ClawClaw

**Tauri + ローカル ClawCore ランタイム（Node）** によるクロスプラットフォームの
デスクトップAIエージェントです。

ClawCore はエージェントループ、コンテキスト、ツール、予算、永続化、スケジュールを所有し、
Pi トランスポート経由でモデルプロバイダーへ直接接続します。APIキーはOSキーチェーンに
保存され、OpenClaw/Gateway/ClawHub ランタイムやローカルHTTPプロキシは同梱しません。
レンダラーはホワイトリスト登録された Tauri IPC のみを使用します。

## 機能

- SQLite（`node:sqlite`）によるローカル永続化と不変イベントログ
- OSキーチェーンに認証情報を保存するプロバイダー（ワークスペースごとの既定、検証機能）
- システムプロンプト・プロバイダー/モデル上書き・ツールポリシー・予算を持つエージェント
- バージョン管理と承認ポリシー付きツール（自動実行と要承認ファイルツール、二重実行なし）
- ローカルスキルライブラリ（同梱読み取り専用＋フォルダーからインストール、リモート市場なし）
- 実際の token/Webhook チャネル（送信・受信ルーティング）。WeChat/WhatsApp の QR/OAuth は
  未対応として明示します（偽装しません）
- 5フィールド cron（IANA タイムゾーン）と永続発火カーソル（停止中の再実行なし）
- 添付ファイルのサイズ/MIME/パスエスケープ制御と画像ピクセル上限
- 正確なソース範囲を持つ会話要約と FTS5 キーワードメモリ（ワークスペース分離）

## 開発

```bash
corepack pnpm install --frozen-lockfile   # Node >= 22.5
pnpm run typecheck
pnpm test
pnpm run build:backend && pnpm run smoke
pnpm run build:vite
pnpm dev
```

`pnpm run release:check` は型チェック・テスト・両ビルド・スモーク・cargo check を順に実行します。

ライセンス: MIT
