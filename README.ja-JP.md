<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="ClawClaw Logo" />
</p>

<h1 align="center">ClawClaw</h1>

<p align="center">
  <strong>OpenClaw AIエージェントのためのデスクトップインターフェース</strong>
</p>

<p align="center">
  <a href="#機能">機能</a> •
  <a href="#なぜclawclawなのか">なぜClawClawなのか</a> •
  <a href="#はじめに">はじめに</a> •
  <a href="#アーキテクチャ">アーキテクチャ</a> •
  <a href="#開発">開発</a> •
  <a href="#コントリビューション">コントリビューション</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <a href="https://discord.com/invite/84Kex3GGAh" target="_blank">
  <img src="https://img.shields.io/discord/1399603591471435907?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord" />
  </a>
  <img src="https://img.shields.io/github/downloads/Xzinfra/ClawClaw/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | 日本語
</p>

---

## 概要

**ClawClaw**は、強力なAIエージェントと日常のユーザーとの間のギャップを埋めます。[OpenClaw](https://github.com/OpenClaw)をベースに構築されており、コマンドラインによるAIオーケストレーションを、アクセスしやすく美しいデスクトップ体験に変換します。ターミナルは不要です。

ワークフローの自動化、AI搭載チャネルの管理、インテリジェントなタスクのスケジューリングなど、ClawClawはAIエージェントを効果的に活用するために必要なインターフェースを提供します。

ClawClaw はプリセットのローカルモデル、主要なクラウドプロバイダー、多言語設定をネイティブにサポートしています。もちろん、**設定 → 詳細設定 → 開発者モード**から高度な設定を微調整することもできます。

---

## スクリーンショット

<p align="center">
  <img src="resources/screenshot/chat.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/cron_task.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/skills.png" style="width: 100%; height: auto;">
</p>

<!-- <p align="center">
  <img src="resources/screenshot/channels.png" style="width: 100%; height: auto;">
</p> -->

<p align="center">
  <img src="resources/screenshot/dashboard.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/settings.png" style="width: 100%; height: auto;">
</p>

---

## なぜClawClawなのか

AIエージェントの構築にコマンドラインの習得は不要であるべきです。ClawClawはシンプルな哲学のもとに設計されました：**強力な技術には、あなたの時間を尊重するインターフェースがふさわしい。**

| 課題                            | ClawClawのソリューション                                      |
| ------------------------------- | ---------------------------------------------------------- |
| 複雑なCLIセットアップ           | ガイド付き初回セットアップと自動ランタイムチェック |
| 設定ファイル                    | リアルタイムバリデーション付きのビジュアル設定             |
| プロセス管理                    | ゲートウェイライフサイクルの自動管理                       |
| 複数のAIプロバイダー            | 統合プロバイダー設定パネル                                 |
| スキル/プラグインのインストール | 組み込みのスキルマーケットプレイスと管理機能               |

### OpenClaw内蔵

ClawClawは公式の**OpenClaw**コアを直接ベースに構築されています。別途インストールを必要とせず、アプリケーション内にランタイムを組み込むことで、シームレスな「バッテリー同梱」体験を提供します。

私たちはアップストリームのOpenClawプロジェクトとの厳密な整合性を維持することにコミットしており、公式リリースが提供する最新の機能、安定性の改善、エコシステムの互換性に常にアクセスできることを保証します。
現在の同梱安定ランタイムは **OpenClaw 2026.5.28** に揃えてあり、デスクトップ統合を維持したまま上流の安定リリースラインに追従しています。

---

## 機能

### 🎯 ゼロ設定バリア

インストールから最初のAIインタラクションまで、すべてのセットアップを直感的なグラフィカルインターフェースで完了できます。ターミナルコマンド不要、YAMLファイル不要、環境変数の探索も不要です。

### 💬 インテリジェントチャットインターフェース

モダンなチャット体験を通じてAIエージェントとコミュニケーションできます。複数の会話コンテキスト、メッセージ履歴、Markdownによるリッチコンテンツレンダリングをサポートしています。

### 📡 マルチチャネル管理

複数のAIチャネルを同時に設定・監視できます。各チャネルは独立して動作するため、異なるタスクに特化したエージェントを実行できます。
チャンネル画面は OpenClaw と同じ「タイプ優先」の構造に寄せてあり、各チャンネルタイプを 1 枚のカードとして表示し、その中でアカウント単位の設定・削除・状態確認を行えます。なお、「アカウント追加」を表示するかどうかは、そのチャンネルの上流プラグインが本当に複数アカウントを実装しているかに従います。運用フローも明確化されており、まず Connections 画面で具体的なアカウントを作成・編集し、その後 Agents 画面でそのアカウントを Agent にバインドします。複数アカウントの接続でも、同じ所有先を強制されません。
WeChat については、Connections 画面で「プラグイン管理の QR セッション」として扱うようになりました。同梱の OpenClaw プラグインミラーを優先して利用し、必要な場合のみ公式の導入フローへフォールバックしたうえで、アプリ内で直接 QR コードを取得し、期限切れのセッションは自動で更新し、ログイン成功後は返却されたアカウントを自動保存します。上流の WeChat プラグイン自体は複数アカウントに対応していますが、ClawClaw では現在 WeChat を単一接続として扱い、次回ログイン時に前回保存した WeChat アカウントを置き換えます。モデル、Agent、本体の Connection アカウント設定はまず保存され、共通の未適用変更バナーからまとめて適用されるため、連続した設定中の Gateway reload や短い再起動を減らせます。唯一の例外は Agent と Connection アカウントの所有バインドで、これは OpenClaw が `bindings` をライブ設定として解決するため、Gateway reload を待たず即時反映されます。
Gateway 起動時は、まず OpenClaw の中核 HTTP/WebSocket ランタイムを優先して立ち上げます。設定済みチャンネルアカウントは管理対象 Gateway への接続後にバックグラウンドで復元されるため、チャンネルのログイン、ネットワーク、プラグイン sidecar の問題がモデル設定やデスクトップ本体のランタイムをブロックしません。

### ⏰ Cronベースの自動化

AIタスクを自動的に実行するようスケジュール設定できます。トリガーを定義し、間隔を設定することで、手動介入なしにAIエージェントを24時間稼働させることができます。

### 🧩 拡張可能なスキルシステム

事前構築されたスキルでAIエージェントを拡張できます。統合スキルパネルからスキルの閲覧、インストール、管理が可能です。パッケージマネージャーは不要です。

### 🔐 セキュアなプロバイダー統合

複数のAIプロバイダー（OpenAI、Anthropic、OpenCode Go など）に接続でき、APIキーと対応済みのOAuthログインを利用できます。OpenAI Codex のサインインは OpenClaw ネイティブのブラウザ OAuth フローに揃えてあり、上流で実際に利用可能な場合は `gpt-5.4-pro` のような新しい Codex モデルを優先表示しますが、既存アカウントの保存済みモデルは勝手に置き換えません。その他のプロバイダーアカウントでも、利用可能な場合は上流エンドポイントから解決した検証済みモデル一覧を優先し、モデル列挙ができない場合のみ手動のモデル ID 入力を許可します。モデル種別フィルターは、上流が明示的なカテゴリ情報を返した場合にのみ表示されます。上流にそのメタデータがない場合、UI は検索のみを表示し、ヒューリスティックな推定は行いません。Ollama、vLLM、SGLang のようなセルフホスト型 OpenAI 互換ランタイムは引き続き一級の Provider として扱い、各セルフホスト型アカウントごとに localhost や LAN のようなプライベートネットワーク宛て通信を明示的に許可できるようになりました。既存のローカルモデルワークフローは専用のローカルモデルセンターで維持します。資格情報はシステムのネイティブキーチェーンに安全に保存されます。

> vLLM メモ: ClawClaw は一般的な `400 "auto" tool choice` エラーを避けるため、vLLM モデルを既定で `supportsTools: false` として扱います。provider 設定から vLLM のツール呼び出しを明示的に有効化できますが、その場合は vLLM を `--enable-auto-tool-choice` と `--tool-call-parser` 付きで起動してください。

### 🛡️ 粒度の細かいセキュリティポリシー

禁止ディレクトリと能力単位の実行時制限を分けて設定できます。リマインダーと禁止ディレクトリは standing orders として agent workspace の `AGENTS.md` に同期され、新規会話だけでなく既存会話の次ターン以降にも継続して反映されます。動作制限は OpenClaw の tool deny レイヤーへ写し込みますが、`openclaw.json` に既にある無関係な deny ルールは上書きしません。

### 💻 柔軟なモデル設定

ClawClaw は初回起動時に既定モデルを強制的に同梱しません。ランタイムの準備が完了した後で、**モデル** 画面からローカルエンドポイントやクラウドプロバイダーを追加し、使用するモデルを選択できます。必要なら後で設定することもできます。クラウドおよびセルフホスト型 Provider は OpenClaw に近い provider-first の導線を使い、専用のローカルモデルセンターは現在のローカルモデル体験をそのまま維持します。ローカルモデル提供元の設定を消去すると、その提供元に依存していたローカルモデルも同時に削除されるため、手動削除や UI 上の削除後に無効なローカルモデル項目が残りません。保存済みのモデル編集は未適用のランタイム変更として表示されます。Gateway が停止中、起動中、または復旧中の場合、ClawClaw は脆い再起動を強制せずに変更を保留し、管理対象ランタイムが利用可能になってから適用します。

### 🌙 アダプティブテーマ

ライトモード、ダークモード、またはシステム同期テーマ。ClawClawはあなたの好みに自動的に適応します。

---

## はじめに

### システム要件

- **オペレーティングシステム**: macOS 11以上、Windows 10以上、またはLinux（Ubuntu 20.04以上）
- **メモリ**: 最低4GB RAM（8GB推奨）
- **ストレージ**: 1GBの空きディスク容量

### インストール

#### ビルド済みリリース（推奨）

[Releases](https://github.com/Xzinfra/ClawClaw/releases)ページから、お使いのプラットフォーム向けの最新リリースをダウンロードしてください。

#### ソースからビルド

```bash
# リポジトリをクローン
git clone https://github.com/Xzinfra/ClawClaw.git
cd ClawClaw

# プロジェクトの初期化
pnpm run init

# 開発モードで起動
# 開発起動時に必要な OpenClaw 管理プラグインミラーも更新します
pnpm dev
```

### 初回起動

ClawClaw を初めて起動すると、**ガイド付きの初回セットアップフロー**が始まります。ウェルカム情報は各ステップの上部に固定表示され、そのうえで次の処理が順に実行されます。

1. ランタイム環境の自動チェック
2. Gateway の自動起動
3. 既定スキルの自動インストール
4. 任意のモデル設定ステップ

Windows ビルドには Python 3.12 ランタイムを同梱し、`UV_PYTHON` で OpenClaw/uv にその実行ファイルを指すため、初回起動時にユーザー環境で Python をダウンロードしません。開発ビルドでこのランタイムがない場合だけ、セットアップは `uv python install` に戻り、公式ソースとミラーで再試行します。

モデル設定は手動に変わりました。セットアップ中に **モデル** 画面へ移動してローカルモデルやクラウドプロバイダーを追加することも、いったんスキップして後から設定することもできます。

### プロジェクト同梱 Skills の事前インストール

ClawClaw は `resources/skills/<slug>/SKILL.md` に置いたプロジェクトローカルの skill も自動で事前インストールします。
起動時に、管理対象の OpenClaw skills ディレクトリにまだ存在しなければ、そのディレクトリを自動でコピーします。

最小例:

```text
resources/
  skills/
    my-skill/
      SKILL.md
```

ディレクトリ構成と `SKILL.md` のテンプレートは [resources/skills/README.md](resources/skills/README.md) を参照してください。

### プロキシ設定

ClawClawには、Electron、OpenClaw Gateway、またはTelegramなどのチャネルがローカルプロキシクライアントを介してインターネットにアクセスする必要がある環境向けに、組み込みのプロキシ設定が含まれています。

**設定 → ゲートウェイ → プロキシ**を開いて以下を設定します：

- **プロキシサーバー**: すべてのリクエストのデフォルトプロキシ
- **バイパスルール**: 直接接続すべきホスト（セミコロン、カンマ、または改行で区切る）
- **開発者モード**では、オプションで以下をオーバーライドできます：
  - **HTTP プロキシ**
  - **HTTPS プロキシ**
  - **ALL_PROXY / SOCKS**

推奨されるローカル設定例：

```text
プロキシサーバー: http://127.0.0.1:7890
```

注意事項：

- `host:port`のみの値はHTTPとして扱われます。
- 高度なプロキシフィールドが空の場合、ClawClawは`プロキシサーバー`にフォールバックします。
- プロキシ設定を保存すると、Electron のネットワーク設定は即座に再適用され、必要な場合は Gateway も自動的に再起動されます。
- モデル、Agent、Connection アカウント設定の変更は未適用のランタイム変更として保存され、まとめて適用できるため、連続したセットアップで Gateway の再起動が何度も発生しにくくなっています。Agent と Connection アカウントの所有バインドだけは、上流 OpenClaw が `bindings` をライブ設定として扱うため即時反映されます。
- `システム設定を使用` モードでは、ClawClaw は OS のプロキシも解決し、自動起動された OpenClaw Gateway 子プロセスへ渡します。
- ClawClawはTelegramが有効な場合、プロキシをOpenClawのTelegramチャネル設定にも同期します。

### メモリ設定

**設定 → メモリ** では、ClawClaw / OpenClaw がセッションをまたいで情報を保存・再利用する方法を制御できます。

- **会話メモリを自動保存**: OpenClaw 組み込みの `session-memory` hook を有効にします。`/new` または `/reset` 実行時に、終了した会話の要約が workspace の `memory/` フォルダへ保存されます。
- **メモリ検索を有効化**: OpenClaw の `memorySearch` ランタイム設定を有効にし、後続の会話で `MEMORY.md` や `memory/*.md` を上流の `memory_search` / `memory_get` ツール経由で参照できるようにします。
- **ローカルモデルの軽量実行モード**: OpenClaw の `agents.defaults.experimental.localModelLean` を有効にし、ローカルモデル系の実行経路でより軽量な上流ランタイム設定を優先します。

注意:

- 現在の会話の継続コンテキストは、引き続き OpenClaw の session transcript に依存します。`session-memory` は追加のクロスセッションアーカイブであり、現在の会話コンテキストの主ソースではありません。
- どちらかのメモリ設定を変更すると、ClawClaw は管理対象の OpenClaw 設定を更新し、新しい設定を上流ランタイムへ反映させるために Gateway を自動再起動します。
- モデル、Agent、Connection の編集は共通の未適用変更フローを使います。メモリ設定は現在のランタイム動作に直接影響するため、引き続き即時適用されます。

### 設定のバックアップとデータクリーンアップ

**設定 → データとアンインストール** を開くと、データ削除やアンインストールの前に現在の設定を JSON バックアップとしてエクスポートできます。同じ画面で Gateway を停止し、管理対象の ClawClaw / OpenClaw ローカルデータを許可リスト方式でクリーンアップし、その後 OS のアンインストーラからアプリ本体を削除するための完全アンインストール準備も行えます。Windows では、ClawClaw 自身のキャッシュ、ストレージ、ログはアプリ終了後に続けて削除され、Chromium のファイルロックが残っていても安全にクリーンアップできます。

**設定 → アップデート** では、自動確認 / 自動ダウンロードの制御と、パッケージ版アプリでの手動更新確認が行えます。ClawClaw は現在、安定版フィードのみを利用します。
Windows パッケージングは NSIS assisted installer を使用し、常に現在の Windows ユーザー向けにインストールします。インストーラーは起動直後にネイティブウィザードを表示し、展開、ファイルコピー、レジストリ登録、ショートカット作成、CLI PATH 設定をインストール手順として実行します。アンインストーラーも NSIS を使用し、明示的なデータ削除オプションを引き続き提供します。
また、旧バージョンの ClawClaw または同梱 OpenClaw から更新した直後の初回起動では、通常の Gateway 起動前、かつ自動更新の再チェック前に、一度だけアップグレード保守を実行し、旧 provider ストア、管理プラグインミラー、古い `openclaw.json` 形状を先回りして修復します。起動失敗後の後追い修復に頼りにくくするためです。
Windows のインストール版を `0.1.15` 以前から更新する場合は、追加の互換経路も有効になります。NSIS インストーラーは新しいファイルをコピーする前に旧インストールを整理し、初回起動では旧プラグイン・旧 channel・旧 runtime レイアウト向けの重めの OpenClaw 修復を強制します。
**設定 → 開発者** の診断と修復では、OpenClaw のチェックや自動修復を簡潔な結果表示で確認でき、元のコマンド出力は既定で折りたたまれます。Gateway 実行中は、同じ場所から OpenClaw Control UI も開けます。さらに Developer Mode を有効にすると、サイドバーに **Dreams** ページが追加され、`doctor.memory.status`、夢日記、基本的な夢メンテナンス操作を確認できます。

---

## アーキテクチャ

ClawClawは、**デュアルプロセス + Host API 統一アクセス**構成を採用しています。Renderer は単一クライアント抽象を呼び出し、プロトコル選択とライフサイクルは Main が管理します：

```┌─────────────────────────────────────────────────────────────────┐
│                        ClawClaw デスクトップアプリ                    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Electron メインプロセス                         │  │
│  │  • ウィンドウ＆アプリケーションライフサイクル管理              │  │
│  │  • ゲートウェイプロセスの監視                                │  │
│  │  • システム統合（トレイ、通知、キーチェーン）                 │  │
│  │  • 自動アップデートオーケストレーション                       │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              │ IPC（権威ある制御プレーン）            │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              React レンダラープロセス                        │  │
│  │  • モダンなコンポーネントベースUI（React 19）                │  │
│  │  • Zustandによるステート管理                                 │  │
│  │  • 統一 host-api/api-client 呼び出し                          │  │
│  │  • リッチなMarkdownレンダリング                              │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ Main管理のトランスポート戦略
                               │（Main がゲートウェイのライフサイクルを管理）
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                Host API と Main プロキシ層                       │
│                                                                  │
│  • hostapi:fetch（Mainプロキシ、CORS回避）                       │
│  • 統一エラーマッピングとリクエスト計測                          │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ Electron Main 経由の Gateway RPC
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw ゲートウェイ                         │
│                                                                  │
│  • AIエージェントランタイムとオーケストレーション                  │
│  • メッセージチャネル管理                                         │
│  • スキル/プラグイン実行環境                                      │
│  • プロバイダー抽象化レイヤー                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 設計原則

- **プロセス分離**: AIランタイムは別プロセスで動作し、重い計算処理中でもUIの応答性を確保します
- **フロントエンド呼び出しの単一入口**: Renderer は host-api/api-client を通じて呼び出し、下位プロトコルに依存しません
- **Mainによるトランスポート制御**: WS/HTTP の選択と IPC フォールバックを Main で一元管理します
- **グレースフルリカバリ**: 再接続・タイムアウト・バックオフで一時的障害を自動処理します
- **セキュアストレージ**: APIキーや機密データは、OSのネイティブセキュアストレージ機構を活用します
- **CORSセーフ設計**: ローカルHTTPはMainプロキシ経由とし、Renderer側CORS問題を回避します

---

## ユースケース

### 🤖 パーソナルAIアシスタント

質問への回答、メールの下書き、ドキュメントの要約、日常タスクのサポートなど、汎用的なAIエージェントを設定できます。すべてクリーンなデスクトップインターフェースから操作できます。

### 📊 自動モニタリング

ニュースフィード、価格追跡、特定イベントの監視などを行うスケジュールエージェントを設定できます。結果はお好みの通知チャネルに配信されます。

### 💻 開発者の生産性向上

AI を開発ワークフローに統合できます。エージェントを使用して、コードレビュー、ドキュメント生成、反復的なコーディングタスクの自動化が可能です。

### 🔄 ワークフロー自動化

複数のスキルを連鎖させて、高度な自動化パイプラインを作成できます。データの処理、コンテンツの変換、アクションのトリガーを、すべてビジュアルにオーケストレーションできます。

---

## 開発

### 前提条件

- **Node.js**: 22以上（LTS推奨）
- **パッケージマネージャー**: pnpm 9以上（推奨）またはnpm

### プロジェクト構成

```ClawClaw/
├── electron/                 # Electron メインプロセス
│   ├── api/                 # メイン側 API ルーターとハンドラー
│   │   └── routes/          # RPC/HTTP プロキシのルートモジュール
│   ├── services/            # Provider/Secrets/ランタイムサービス
│   │   ├── providers/       # provider/account モデル同期ロジック
│   │   └── secrets/         # OS キーチェーンと秘密情報管理
│   ├── shared/              # 共通 Provider スキーマ/定数
│   │   └── providers/
│   ├── main/                # アプリ入口、ウィンドウ、IPC 登録
│   ├── gateway/             # OpenClaw ゲートウェイプロセスマネージャー
│   ├── preload/             # セキュア IPC ブリッジ
│   └── utils/               # ユーティリティ（ストレージ、認証、パス）
├── src/                      # React レンダラープロセス
│   ├── lib/                 # フロントエンド統一 API とエラーモデル
│   ├── stores/              # Zustand ストア（settings/chat/gateway）
│   ├── components/          # 再利用可能な UI コンポーネント
│   ├── pages/               # Setup/Dashboard/Chat/Channels/Skills/Cron/Settings
│   ├── i18n/                # ローカライズリソース
│   └── types/               # TypeScript 型定義
├── tests/
│   └── unit/                # Vitest ユニット/統合寄りテスト
├── resources/                # 静的アセット（アイコン、画像）
└── scripts/                  # ビルド/ユーティリティスクリプト
```

### 利用可能なコマンド

```bash
# 開発
pnpm run init             # 依存関係のインストール + uvのダウンロード
pnpm run python:download:win # Windows パッケージ用の同梱 Python ランタイムをダウンロード
pnpm dev                  # ホットリロードで起動

# コード品質
pnpm lint                 # ESLintを実行
pnpm typecheck            # TypeScriptの型チェック

# テスト
pnpm test                 # ユニットテストを実行
pnpm run release:check    # リリースゲートを実行（アップグレード互換性と復旧チェック）

# ビルド＆パッケージ
pnpm run build:vite       # フロントエンドのみビルド
pnpm run package:prepare  # 共通パッケージ前処理（vite + OpenClaw bundle + builder出力クリーン）
pnpm build                # 本番パッケージ用アセットを準備
pnpm package:mac          # macOS向けにパッケージ化
pnpm package:win          # Windows NSIS インストーラーと updater 互換 setup exe/latest.yml をビルド
pnpm run package:organize # ルート出力を release/v<version>/windows|mac|linux|metadata に整理
pnpm package:linux        # Linux向けにパッケージ化
pnpm run upload:update    # release/v<version>/windows/latest.yml と参照される Windows 更新ファイルをアップロード
```

注記:

- `pnpm package:win` は Windows NSIS インストーラーをビルドし、旧 updater 互換名の `ClawClaw-Setup-v<version>-<arch>.exe`、安定別名 `ClawClaw-Setup-v<version>.exe`、および `latest.yml` をステージします。内部では `scripts/package-win.mjs` を使い、electron-builder の前に Windows の `node.exe`、`uv.exe`、Python ランタイムを検証またはダウンロードします。
- `pnpm package:prepare` は `build` と各プラットフォーム向けパッケージコマンドで共通利用する前処理で、release 直下の builder 一時出力だけを掃除し、既存のバージョン別成果物には触れません。
- `pnpm package:organize` は builder が一時的に release 直下へ出力した成果物を `release/v<package.json version>/windows`、`release/v<package.json version>/mac`、`release/v<package.json version>/linux`、`release/v<package.json version>/metadata` へ振り分けます。
- `release/` はバージョン別ディレクトリで運用します。既存バージョンは保持され、同じバージョンの成果物だけが上書きされます。更新アップロードスクリプトは `release/v<package.json version>/windows/latest.yml` を参照します。
- `pnpm run upload:update` は引き続き Windows インストール版専用です。古いインストール版が依存する `latest.yml` 契約を維持し、`latest.yml` 内のバージョンが `package.json` と一致しない場合は失敗します。
- 同梱 OpenClaw プラグインミラーは `after-pack` 段階でコピーされるため、パッケージ化時に別途 `bundle:openclaw-plugins` を実行する必要はありません。

### Release Gate

顧客向けリリースの前に、`pnpm run release:check` を実行してください。

このゲートは一般的な機能テストではなく、アップグレード安定性を確認します。現在は次を検証します。

- 旧 provider store から account ベース構成への移行
- 初回 Gateway 起動前の runtime provider/auth の自動収束
- 破損した `openclaw.json` の自動復旧とバックアップ保持
- インストール済みプラグインが不完全な場合のミラー再インストール
- 複数 agent 環境での runtime auth 収束

### 技術スタック

| レイヤー         | 技術                     |
| ---------------- | ------------------------ |
| ランタイム       | Electron 40以上          |
| UIフレームワーク | React 19 + TypeScript    |
| スタイリング     | Tailwind CSS + shadcn/ui |
| ステート管理     | Zustand                  |
| ビルド           | Vite + electron-builder  |
| テスト           | Vitest + Playwright      |
| アニメーション   | Framer Motion            |
| アイコン         | Lucide React             |

---

## コントリビューション

コミュニティからのコントリビューションを歓迎します！バグ修正、新機能、ドキュメントの改善、翻訳など、あらゆる貢献がClawClawをより良くするのに役立ちます。

### コントリビューション方法

1. リポジトリを**フォーク**する
2. フィーチャーブランチを**作成**する（`git checkout -b feature/amazing-feature`）
3. 明確なメッセージで変更を**コミット**する
4. ブランチに**プッシュ**する
5. **プルリクエスト**を作成する

### ガイドライン

- 既存のコードスタイルに従う（ESLint + Prettier）
- 新機能にはテストを書く
- 必要に応じてドキュメントを更新する
- コミットはアトミックかつ説明的に保つ

---

## 謝辞

ClawClawは優れたオープンソースプロジェクトの上に構築されています：

- [OpenClaw](https://github.com/OpenClaw) – AIエージェントランタイム
- [Electron](https://www.electronjs.org/) – クロスプラットフォームデスクトップフレームワーク
- [React](https://react.dev/) – UIコンポーネントライブラリ
- [shadcn/ui](https://ui.shadcn.com/) – 美しくデザインされたコンポーネント
- [Zustand](https://github.com/pmndrs/zustand) – 軽量ステート管理

---

## コミュニティ

コミュニティに参加して、他のユーザーとつながり、サポートを受け、体験を共有しましょう。

|                                     企業微信                                      |                                   Feishuグループ                                   |                                          Discord                                          |
| :-------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------: |
| <img src="src/assets/community/wecom-qr.png" width="150" alt="WeChat QRコード" /> | <img src="src/assets/community/feishu-qr.png" width="150" alt="Feishu QRコード" /> | <img src="src/assets/community/20260212-185822.png" width="150" alt="Discord QRコード" /> |

### ClawClaw パートナープログラム 🚀

ClawClaw パートナープログラムを開始します。特に、カスタム AI エージェントや自動化ニーズを持つより多くの顧客に ClawClaw を紹介してくださるパートナーを募集しています。

パートナーの皆さまには、見込みユーザーや案件との接点づくりを担っていただき、ClawClaw チームは技術サポート、カスタマイズ、統合を全面的に提供します。

AI ツールや自動化に関心のある顧客とお仕事をされている方は、ぜひご一緒できればうれしいです。

詳細は DM いただくか、[public@xzinfra.com](mailto:public@xzinfra.com) までメールでご連絡ください。

---

## スター履歴

<p align="center">
  <img src="https://api.star-history.com/svg?repos=Xzinfra/ClawClaw&type=Date" alt="スター履歴チャート" />
</p>

---

## ライセンス

ClawClawは[MITライセンス](LICENSE)の下でリリースされています。本ソフトウェアの使用、変更、配布は自由に行えます。

---

<p align="center">
  <sub>Xzinfra Teamが❤️を込めて開発</sub>
</p>
