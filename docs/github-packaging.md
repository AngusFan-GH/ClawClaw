# GitHub 打包与发布

[English](github-packaging.en.md)

## 职责

GitHub 是主仓库，日常开发分支为 `dsh-desktop`。GitLab 仅保留代码备份；办公电脑不再承担 CI 构建。上游保持官方 Git 子模块及原固定提交，根工程通过 Corepack 使用 pnpm 11.8.0。

GitHub 托管的 macOS、Windows Runner 原生构建两个安装包。正式版本保存到 GitHub Releases；客户端仍从公司下载服务器获取更新。构建机使用公网依赖源，不需要公司 npm 私库、本地上游镜像或服务器 SSH 凭据。

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

GitHub Release 发布不会修改正式更新服务器。服务器主动拉取指定正式 Release、验证来源和安装包后再发布的流程另行接入；当前不需要为 GitHub Runner 开放服务器 SSH，也不配置定时同步。

客户端更新入口保持 `https://clawclaw.xzinfra.com/updates/dsh/stable/release.json`，兼容范围为 0.2.6 及以上的 0.2.x。新清单中的安装包使用不可覆盖的 `/releases/dsh/<version>/` 路径，继续保留旧清单引用的历史安装包路径。清单保持原有 `version`、`channel` 和两平台的 HTTPS URL、size、SHA-512 格式。

`deploy/clawclaw-internal.nginx.conf` 保留下载服务和历史路径配置。通用 `scripts/upload-update.mjs` 校验文件并在完整版本目录落盘后原子切换清单；GitHub 工作流只调用其 `--dry-run`，不会 SSH 部署。服务器首次切换前仍须验证 GitHub 下载连通性、HTTPS 证书、DNS、公网 443，以及原 0.2.6–0.2.10 检查器和完整安装包下载。旧服务器继续服务，直至切换验证完成。

## 双远端

`origin` 指向 GitHub，`gitlab` 指向公司 GitLab。两个远端均保留 `main` 与 `dsh-desktop`：`dsh-desktop` 用于日常开发，`main` 作为集成基线。开发分支完成验证后合入 `main`，并将两个分支分别同步到两个远端；正式发布仍由版本 tag 触发，不由分支同步触发。

历史办公 Runner、Windows 诊断和早期专家界面方案已归入合并历史，并在分支清理前保存本地 Git bundle 备份。当前代码继续使用 GitHub 托管 Runner；保留历史不代表重新启用旧方案。同步使用正常快进或合并，不强制覆盖远端历史。
