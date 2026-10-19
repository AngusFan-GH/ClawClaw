# GitLab 办公电脑打包

[English](gitlab-packaging.en.md)

Mac 与 Windows 已分别验证本地打包。本流程复用这两个原生环境，不需要 Linux Runner，也不部署到原有更新服务器。

## 流水线

仅在 GitLab 的 Build → Pipelines → Run pipeline 中选择 `dsh-desktop` 手动启动。普通 push 和旧 tag 不触发打包。历史 tag 没有新增的 CI 文件，不要为了运行流水线移动已发布 tag。

`package-macos` 使用 `clawclaw-macos` Runner，`package-windows` 使用 `clawclaw-windows` Runner。两者从同一流水线提交重新克隆代码、初始化只读上游子模块、安装依赖、准备 runtime、运行完整门禁和原生打包。Node 使用 22.19+ 的 22.x 或 24.x；根 workspace 固定使用 Corepack 与 pnpm 11.8.0。上游命令保留其独立 pnpm 版本。

两个 Job 上传安装包及提交、流水线编号、版本、大小和 SHA-512。`assemble` 在 Mac Runner 上下载两个 Job 的产物，拒绝混用不同提交或不同流水线的文件，重新核对 SHA-512，汇总到 `release/`。在 assemble Job 页面下载最终产物，保存期 30 天；单平台中间产物保存 7 天。

最终目录包含 DMG、EXE 和 `build-info.json`。它不是客户端更新源；内部下载域名确定前不生成 `release.json`，也不上传至旧服务器。安装包内更新地址仍是旧域名，内部正式发布前需要单独迁移。

## 网络和存储

依赖通过 `http://192.168.103.203:8081/repository/xzinfra-npm-group/` 下载。若需要认证，在 GitLab 配置匹配仓库的 CI/CD 机密变量，不要复制其他项目的发布凭据。Corepack、GitHub 上游子模块、Electron 和打包工具的下载仍需外网或对应内网镜像。

GitLab 默认 artifact 大小上限可能不足以容纳安装包。Mac DMG 已约 464 MB，项目与反向代理的上传限制需要容纳两个安装包的汇总压缩包，建议项目上限至少 2048 MB。若出现 `413` 或 `artifact too large`，先由运维调整限制；不要反复重建。此项取决于服务器设置，尚未验证大文件上传。

## Mac Runner

本机独立安装目录为 `~/.local/share/clawclaw-runner/`，构建和缓存分别在其 `builds/`、`cache/`，不使用日常开发目录。Runner 使用原生 bash，每次只执行一个 Job；它的版本与公司 GitLab 16.9 系列匹配。GitLab 与 Runner 后续应同步升级。

Runner 作为当前用户的 LaunchAgent 登录后启动，关机或注销后离线。不要另装一份 Homebrew Runner，以免同时领取任务。

## Windows Runner

使用已成功打包的 `admin` 用户登录 Windows。Runner 目录为 `D:\Angus\Work\Projects\ClawClaw\Runner`。运行前确认此账号的 Git、x64 Node、Corepack、Python、C++ 工具链和内网访问条件与手动打包一致。

1. 在项目 Settings → CI/CD → Runners 创建 Windows 项目 Runner，标签设为 `clawclaw-windows`，关闭 Run untagged jobs；若需要构建普通分支，不启用 Protected。最大 Job 超时设为至少三小时。仅绑定本项目。
2. 复制生成的 Runner authentication token，在 Windows 更新开发仓库后执行以下命令。该令牌不是 glab 登录用的 API 令牌，不要发到聊天或提交到仓库。

```powershell
git switch dsh-desktop
git pull --ff-only
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows-runner.ps1
```

脚本从官方源下载 Runner 16.9.1，验证 SHA-256，在隐藏提示中读取令牌，注册 PowerShell Shell Runner，并创建当前用户的登录启动快捷方式。它不保存 Windows 密码。`Runner/` 已被仓库忽略；仍不要复制配置文件到 Git。注册后保持 Runner 窗口运行，关闭窗口会令它离线。安装脚本无法在 Mac 上验证 Windows 行为，首次运行结果仍需实际检查。

## 每次打包

1. 两台电脑开机、登录原构建用户、连接公司网络；确认两个 Runner Online。
2. 打包期间禁用休眠，Mac 也要保持登录。无需全天开机。
3. 手动启动 `dsh-desktop` 流水线。打包脚本每分钟输出仍在运行的命令；Universal 的文件扫描仍可能较慢。
4. 等整个流水线的 assemble 成功，下载并验证最终安装包，然后再关闭两台电脑。只看到 Mac 的 package Job 成功时不要提前关机，因为汇总仍需 Mac。

Runner 尚未上线或网络条件未满足时，任务会等待或失败。不要把等待 Runner 误认为编译失败。
