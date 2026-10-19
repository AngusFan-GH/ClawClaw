# GitLab 办公电脑打包

[English](gitlab-packaging.en.md)

Mac 与 Windows 已分别验证本地打包。本流程复用这两个原生环境，不需要 Linux Runner，也不部署到原有更新服务器。

## 发布方式

源码和流水线位于公司 GitLab。Mac 和 Windows Runner 原生打包后，使用专用账号 `clawclaw-release` 通过 SSH 直接上传到 `192.168.103.220`，不通过 GitLab artifacts 保存或传输大型安装包。

- 私有暂存：`/data/clawclaw/incoming/<pipelineId>-<commit>/<platform>/`。
- 公开下载根目录：`/data/clawclaw/public/`。
- 不可覆盖的版本目录：`/releases/dsh/<version>/`，包含 DMG、EXE、`release.json` 和 `build-info.json`。
- 稳定更新清单：`https://clawclaw.xzinfra.com/updates/dsh/stable/release.json`。

`deploy/clawclaw-internal.nginx.conf` 为内网 HTTPS 服务配置；证书和私钥存放在服务器 `/etc/clawclaw/tls/`，不进入 Git。迁移时复制的通配符证书在北京时间 2026-10-27 07:59:59 到期，需及时续期。服务器对外地址为 `218.69.255.22`：公网 DNS 应指向该地址，并将外网 443 转发到 `192.168.103.220:443`；内网可通过分区 DNS 直接解析到 `192.168.103.220`。当前从公司网络访问公网 IP 的 443，会进入 H3C SecPath F100 管理页面；从旧阿里云服务器实测该公网 443 连接超时，而 9527 的 File Browser 正常返回 200。两种网络位置的结果不同，不能将内网回流访问等同于真实公网连通。切换 DNS 前，需由网管核查公网 443 的端口映射、安全策略及管理入口。客户端继续使用原 HTTPS 域名。

## 历史客户端兼容

保持域名 `clawclaw.xzinfra.com` 和 HTTPS 443。0.2.0、0.2.1 请求 `/updates/stable/release.json`，0.2.2–0.2.10 请求 `/updates/dsh/stable/release.json`；内网 Nginx 将前一地址直接映射到同一份 DSH 清单，不使用重定向。清单提供相同的 HTTPS 安装包、大小和 SHA-512 字段。旧服务器已发布 0.2.10，因此迁移后的首次新发布使用 0.2.11，让当前版本也能发现更新。

更早 0.1.x 使用 `/updates/stable/latest.yml`；保留该源及其安装包，不把 DSH 清单伪装成旧协议。跨体系升级需另行验证。切换 DNS 前须验证历史客户端的实际更新请求，以及旧清单引用的下载文件。

## 流水线

在 GitLab 的 Build → Pipelines → Run pipeline 中选择 `dsh-desktop` 手动启动，也可以通过已认证的 API 启动该分支。普通 push 和旧 tag 不触发打包；不要移动已发布 tag。

`package-macos` 使用 `clawclaw-macos` Runner，`package-windows` 使用 `clawclaw-windows` Runner。两者浅克隆同一流水线的准确提交、初始化只读上游子模块、安装依赖、准备 runtime、执行完整门禁并原生打包。根 workspace 使用 Node 22.19+ 的 22.x 或 24.x、Corepack 和 pnpm 11.8.0。上游保留独立 pnpm 版本。

每个平台将安装包及提交、流水线、版本、大小和 SHA-512 元数据上传到本次流水线专属暂存目录。传输先用临时文件名，最后才将元数据标为就绪。两个平台均成功后，`assemble` 在 Mac 下载同一流水线的暂存产物，重新核对版本、来源、大小和 SHA-512，生成更新清单并上传服务器。服务器先保存完整版本目录，最后原子切换稳定更新清单；已存在版本拒绝覆盖。需要发布不同内容时应提升产品版本。

发布前会通过可信 HTTPS 检查 `/healthz` 的内网服务标记。DNS 尚未切换、证书不受信任或仍连接旧服务器时，发布会失败，不更新清单。未完成首次双平台流水线前，传输及发布事务的测试通过不能代表正式安装包已发布。

首次或提前内网发布时，可在本次手动流水线添加 `UPDATE_ORIGIN_VERIFY_IP=192.168.103.220`。该值必须与 `UPDATE_HOST` 一致；健康检查直接连接此 IP，仍使用原域名验证 TLS 证书和服务标记，不关闭证书校验。这样可在 DNS 切换前发布正式服务器目录。清单中的 HTTPS 域名保持不变；域名尚未解析到新服务器时，可通过指定解析验证下载。日常发布不设置此变量。

安装包通过上述 HTTPS 版本目录下载，GitLab 保留 Job 日志。服务器暂存和版本目录不自动清理；删除历史版本前需确认客户端及回退需求。

## 连接变量、网络和存储

项目 CI/CD 变量已配置 `CLAWCLAW_DIRECT_UPLOAD=1`、`UPDATE_HOST`、`UPDATE_USER`、`UPDATE_PORT`、`UPDATE_STAGING_ROOT`、`UPDATE_REMOTE_ROOT` 和 `UPDATE_BASE_URL`。SSH 私钥与服务器指纹分别使用文件变量 `UPDATE_SSH_KEY_FILE` 和 `UPDATE_SSH_KNOWN_HOSTS_FILE`，不要输出其内容或提交到 Git。连接强制校验服务器指纹，发布账号只拥有其部署目录权限，不使用 root。Mac 和 Windows 均需安装 SSH/SCP 客户端，并能连接服务器的 22 端口。

依赖通过 `http://192.168.103.203:8081/repository/xzinfra-npm-group/` 下载。认证需要匹配本仓库的 CI/CD 机密变量，不要复制其他项目的发布凭据。Corepack、Electron 和打包工具仍需外网或对应内网镜像。无法稳定访问 GitHub 时，将 `CLAWCLAW_WINDOWS_UPSTREAM_SOURCE` 和 `CLAWCLAW_MACOS_UPSTREAM_SOURCE` 指向各机器已验证的本机上游 Git 仓库；CI 克隆固定提交后恢复官方子模块地址，不修改上游源码或 pin。

原流水线 #450 的 Mac DMG 已通过挂载校验，但被 GitLab 以 `413 Request Entity Too Large` 拒绝上传。当前直接上传流程已移除大型 GitLab artifacts，因此无需提高 GitLab artifact 限制。

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
4. 等整个流水线的 assemble 成功，从内网版本目录下载并验证安装包，然后再关闭两台电脑。只看到 Mac 的 package Job 成功时不要提前关机，因为汇总与发布仍需 Mac。

Runner 尚未上线或网络条件未满足时，任务会等待或失败。不要把等待 Runner 误认为编译失败。
