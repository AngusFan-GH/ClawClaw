# GitHub 打包与发布

[English](github-packaging.en.md)

## 职责

GitHub 是主仓库，日常开发分支为 `dsh-desktop`。GitLab 仅保留代码备份；办公电脑不再承担 CI 构建。上游保持官方 Git 子模块及原固定提交，根工程通过 Corepack 使用 pnpm 11.8.0。

GitHub 托管的 macOS、Windows Runner 原生构建两个安装包。正式版本保存到 GitHub Releases；客户端仍从公司下载服务器获取更新。构建机使用公网依赖源，不需要公司 npm 私库或本地上游镜像。GitHub 完成打包后，在本机通过内网 SSH 上传安装包、切换清单并验证公网下载。服务器不轮询 GitHub。

## 日常 CI

推送到 `dsh-desktop`、`main` 或向它们提交 PR 时运行 CI；也可手动触发。Linux 执行完整门禁，Windows 和 macOS 保留原生构建、类型检查、平台测试及运行时闭包验证，另保留 Windows 上游命令检查。纯文档变更只做文档检查。`check:win-package`、`check:mac-package` 是不生成安装包的预检命令。

日常 CI 不调用 `dist:*`，不生成 DMG、EXE 或便携包，也不发布 Release。安装包只在下面的 Release 工作流中生成。

## 发版打包与存档

在 Actions 中选择 **Release ClawClaw Desktop**，选择要验证的分支，保持 `publish=false`。两个平台分别安装冻结依赖、准备上游运行时、执行完整 `pnpm check` 后打包，并验证实际安装包。完整门禁已经覆盖构建、类型检查、全部单元测试和运行时验证，打包步骤复用该结果，不重复执行平台预检；打包后的安装包验证仍保留。两平台依赖使用按系统、架构和根锁文件隔离的 pnpm 缓存。产物为未签名的 Universal DMG 和 Windows x64 NSIS 安装包。

每个平台保存产品版本、Git 提交、仓库、工作流 run ID、构建 attempt、文件名、大小和 SHA-512。汇总只接受同一仓库、提交、版本和 run ID 的两个平台，重新计算文件校验值；为兼容现有更新客户端，单个安装包不得超过 1 GiB。重试同一次工作流时，可复用此前成功平台的产物，保留各自 attempt。不同工作流的安装包不能混用。

验证完成后下载该次工作流的 `desktop-release` artifact，其中包含两个安装包、`release.json`、`build-info.json`。工作流 artifacts 保留 14 天，不作为长期版本存档。

正式存档需要与产品版本一致、已存在的 `clawclaw-v<version>` tag。推送该 tag 会触发构建和 GitHub Release 发布；也可对该 tag 手动运行并设置 `publish=true`。在普通分支设置 `publish=true` 会被拒绝。不要移动已发布标签。

发布 Job 在 `github-release` environment 中运行，只有该 Job 拥有 `contents: write`。它先创建 draft 并上传完整文件，成功后才公开 Release。已有 Release（包括失败遗留的 draft）不会被覆盖；失败时应先检查并清理未发布的 draft，再重试。正式版本内容改变时提升版本号。可在 GitHub 配置该 environment 的审批和标签限制。

## 公司服务器与旧客户端

发布链路为：GitHub 双平台打包及正式 Release 存档 → 在公司内网的本机显式执行部署命令 → 内网 SSH 上传安装包 → 写入正式版本目录 → 原子切换正式清单 → 公网完整下载验证。试打包不会自动部署；需要时也可显式选择一次成功试打包运行进行本机部署。

不需要服务器轮询、公网 SSH 映射、办公 Runner 或 GitHub 保存服务器私钥。部署期间本机须能访问 GitHub 和内网服务器。已有版本目录拒绝覆盖，后续正式发布须提升版本号。

新安装包统一使用 `/releases/dsh/<version>/ClawClaw-<version>-universal.dmg` 和 `ClawClaw-<version>-x64-Setup.exe`，不使用临时试版路径。正式清单仍为 `/updates/dsh/stable/release.json`。0.2.11 的覆盖发布属于一次性迁移例外，当前已正式上线；后续正式发版至少使用 0.2.12，不再复用 0.2.11。

新版客户端更新入口为 `https://clawclaw.xzinfra.com:9528/updates/dsh/stable/release.json`，清单中的安装包地址也使用同一域名的 HTTPS 9528 和不可覆盖的 `/releases/dsh/<version>/` 路径。清单保留原有 `version`、`channel`、两平台 HTTPS URL、size、SHA-512 格式，以及 16 KiB 清单和 1 GiB 安装包限制。

迁移范围只考虑 0.2.8 及以上版本。已安装的 0.2.8–0.2.10 固定请求旧的 HTTPS 443 地址，不能通过 DNS 或 HTTP 跳转自动改用 9528；本方案要求用户先手动安装改用 9528 的新版，之后从新入口自动更新。当前 0.2.11 已使用 9528 正式入口；更早使用 443 的同版本试包不能通过同版本比较自动升级，需手动安装最新包。更早版本不在迁移验证范围内。

服务器为 `<server-host>`，下载根目录仍是 `$UPDATE_REMOTE_ROOT`，版本目录为 `$UPDATE_REMOTE_ROOT/releases/dsh/<version>/`，稳定清单为 `$UPDATE_REMOTE_ROOT/updates/dsh/stable/release.json`。`deploy/clawclaw-internal.nginx.conf` 增加 HTTPS 9528，同时保留内网 443；HTTP 80 跳转至显式 9528，不更改 File Browser 的 9527。公网需由网管配置 `<public-ip>:9528 -> <server-host>:9528`，并将原域名的公网 DNS 指向 `<public-ip>`；内网可配置分区 DNS 到服务器内网地址。

`scripts/upload-update.mjs` 是本机 SSH 上传入口，根目录必须由本地 `UPDATE_REMOTE_ROOT` 配置。本地 `.env.server.local` 的 `UPDATE_REMOTE_ROOT` 须为该目录；`UPDATE_PORT` 指 SSH 端口，和 HTTPS 下载端口 9528 无关。

正式切换前须验证：可信 HTTPS 证书、内网和真实公网的 9528 连通性、DNS、新清单、两个安装包的完整下载及 SHA-512，以及从 0.2.8–0.2.10 手动安装新版后使用新入口检查更新。内网使用 `curl --resolve clawclaw.xzinfra.com:9528:<server-host> https://clawclaw.xzinfra.com:9528/healthz` 可保留域名和证书校验；此测试不能代替真实公网验证。旧服务器和原稳定清单保留至迁移验证完成，不自动改写历史清单中的地址。

## 本机部署

在已忽略的 `.env.server.local` 配置 `UPDATE_HOST=<server-host>`、`UPDATE_USER=<release-user>`、`UPDATE_PORT=22`、`UPDATE_REMOTE_ROOT=<absolute-release-root>`，以及现有 `UPDATE_SSH_KEY_FILE` 和 `UPDATE_SSH_KNOWN_HOSTS_FILE` 路径。也可通过 SSH agent 提供私钥；必须保留主机指纹校验。本机 `gh` 需已登录并拥有仓库 Actions 读取权限。

```sh
# 自动列出可用产物，选择后部署：
corepack pnpm deploy:run
# 选择后仅下载校验，不部署：
corepack pnpm deploy:run --dry-run
# 仅列出，不下载、不部署：
corepack pnpm deploy:run --list
# 仍支持显式指定运行 ID：
corepack pnpm deploy:run <GitHub-run-id> --dry-run
```

不填写 ID 时，在交互终端中从最近 10 次成功打包运行筛选仍保留未过期、非空 `desktop-release` 的记录，显示版本、北京时间、分支或标签、提交和运行 ID。最新可下载记录为序号 1，并标记为默认；直接回车选择 1，也可输入其他序号，输入 `q` 取消。版本从对应提交读取，仅供展示；下载后仍独立校验构建来源。版本读取失败时显示 `unknown`。非交互环境须显式提供 ID，或使用 `--list`。超出最近 10 次范围的旧运行仍可通过 ID 指定。

选择后显示编号阶段：核对运行、下载解压、本地校验、上传及切换清单、公网验证。下载时每 5 秒根据下载器专用临时目录的实际文件大小，显示近似百分比、已下载 MB、平均速度和耗时；达到 100% 后可能仍在解压。其他无输出的命令每 5 秒显示阶段与耗时，没有下载字节时提示等待响应或解压中，不把等待时间误报为下载进展。Dry-run 在本地校验完成后结束，不执行上传或清单切换。

在仓库根目录执行，本机需具备 Node.js/Corepack、`gh`、OpenSSH 和 tar。运行 ID 是 Actions 链接 `/actions/runs/<run-id>` 中的数字，不是版本号、Job ID 或 artifact ID。`--dry-run` 仍会下载完整产物，不检查 SSH 连通性；随后真实部署时会重新下载。

命令只下载指定成功打包运行的 `desktop-release`，检查工作流、仓库、commit 和 run 来源，验证正式 URL、大小及 SHA-512，上传安装包后原子切换稳定清单，最后验证公网清单、完整安装包校验值及 Range 下载。退出时清理本地临时下载。须在 artifact 保留期（14 天）内执行；失败不自动重试。若上传成功但公网验证失败，稳定清单已经切换且不会自动回滚，须先核对线上清单再处理；已有版本目录不会被覆盖。该命令始终发布到稳定清单，没有“仅上传、不切换清单”模式。

正式版本 tag 仍自动生成 GitHub Release，服务器部署改为显式执行本机命令。下次正式发布至少使用 0.2.12，不移动已发布标签。不需要 GitHub Actions 部署 Secrets。

## 当前保留记录与验证（2026-10-23）

0.2.11 目前只保留一次可下载的打包运行：[39938627282](https://github.com/AngusFan-GH/ClawClaw/actions/runs/39938627282)，对应提交 `3d73a81fabf617ba6a8152324078004f0a0885ab`，包含 macOS Universal DMG、Windows x64 EXE 和汇总的 `desktop-release`。选择运行时以 ID 和提交核对，不依赖列表序号；序号会随新构建改变。

已执行以下真实产物校验，下载、来源、正式 URL、大小和 SHA-512 均通过：

```sh
corepack pnpm deploy:run 39938627282 --dry-run
```

本次验证没有上传或切换更新清单。执行前后，线上 11 个文件的 SHA-256 完全一致，本地临时下载已清理。自动列出运行及交互取消也已验证；这些验证不代表重新执行了实际上传。该 0.2.11 已部署，不要把上述命令去掉 `--dry-run` 后再次覆盖；下一次正式部署应使用提升版本号后的新产物。

已删除没有可下载产物的运行 `39957286420`、`39956621700`、`39954244468`、`39942732104`，以及旧 0.2.11 运行 `39889708751`、`39607997215` 及其附属产物。其他版本记录保留，线上安装包和清单不受影响。

这是一次人工清理，不是自动保留策略。后续需要清理时，先核对运行版本和产物，再删除目标运行；删除运行也会删除其日志和附属 artifacts。部署选择器会隐藏缺失或过期的产物，但不会自动去重或删除同版本运行。GitHub artifacts 仍按工作流的 14 天期限保留，不能作为长期下载地址；客户端始终使用公司服务器正式目录。

## 双远端

`origin` 指向 GitHub，`gitlab` 指向公司 GitLab。两个远端均保留 `main` 与 `dsh-desktop`：`dsh-desktop` 用于日常开发，`main` 作为集成基线。开发分支完成验证后合入 `main`，并将两个分支分别同步到两个远端；正式发布仍由版本 tag 触发，不由分支同步触发。

历史办公 Runner、Windows 诊断和早期专家界面方案已归入合并历史，并在分支清理前保存本地 Git bundle 备份。当前代码继续使用 GitHub 托管 Runner；保留历史不代表重新启用旧方案。同步使用正常快进或合并，不强制覆盖远端历史。
