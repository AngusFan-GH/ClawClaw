# 下载统计

[English](download-statistics.en.md)

Nginx 直接提供正式安装包；Python 3.9+ 标准库程序每分钟增量读取 JSON 日志、更新 SQLite 并生成报表。页面每 30 秒读取，切回页面时立即刷新，通常在下载结束后约 1–2 分钟显示。统计按北京时间计算，不改变客户端、下载 URL 或断点续传。

## 本地配置和部署

首次配置：复制 `.env.server.example` 为 Git 忽略的 `.env.server.local`，填写实际信息。已有部署必须保留原有数据目录，避免误用新目录造成历史数据看似丢失。本机现有配置可继续使用。

| 本地变量 | 用途 |
| --- | --- |
| `STATS_DEPLOY_HOST`、`STATS_DEPLOY_USER`、`STATS_DEPLOY_PORT` | SSH 目标、管理账号、端口 |
| `STATS_DEPLOY_SSH_KEY_FILE`、`STATS_DEPLOY_SSH_KNOWN_HOSTS_FILE` | 可选的本机 SSH 文件路径；也可使用既有 SSH 配置和 agent |
| `STATS_PROGRAM_DIR` | 服务器上的统计程序目录 |
| `STATS_DATA_DIR` | 数据根目录；私有数据库和密钥在其 `private/`，聚合报表在 `report/` |
| `STATS_LOG_DIR`、`STATS_BACKUP_DIR` | 专用原始日志目录、部署备份目录 |
| `STATS_NGINX_CONFIG`、`STATS_ACCESS_LOG` | 既有下载站点配置文件、普通访问日志文件 |
| `STATS_BIND_ADDRESS`、`STATS_HTTP_PORT` | 内网监听 IPv4 和报表端口 |
| `STATS_ALLOWED_CIDRS` | 公司允许访问的 IPv4 CIDR，多个以逗号分隔 |

仓库不提供真实地址、管理账号或部署目录默认值；缺少配置时在连接服务器前报错，不从发布账号配置回退。管理账号需系统管理员权限，非 root 管理员需免密 sudo；始终保留严格的 SSH 主机指纹校验。

```sh
# 完整部署或更新
corepack pnpm deploy:stats
# 只更新页面
corepack pnpm deploy:stats --page-only
# 预览，不连接服务器
corepack pnpm deploy:stats --dry-run
```

完整部署先运行回归测试及语法检查，再校验管理权限。Nginx、systemd 和日志轮转文件是含 `@@变量名@@` 的模板，部署脚本会在临时目录中渲染后上传，不能把原始模板直接复制到服务器。生成的 `runtime.env` 只包含部署所需的运行路径和监听配置，不包含 SSH 私钥或完整的本地 `.env`，部署结束后清理。

两种部署模式均按固定文件清单上传，备份既有受管文件到 `$STATS_BACKUP_DIR/stats-deploy-backup.*/files.tgz`，验证页面及 JSON 报表，不覆盖私有数据库和密钥。完整安装器检查 `nginx -t` 后平滑重载，并更新定时任务。失败以非零状态退出；安装器自动恢复 Nginx 配置，其他受管文件可从备份恢复。仅页面模式不重启服务。安装包发布仍使用独立的 `deploy:run`。

独立下载站点模板 `deploy/clawclaw*.nginx.conf` 也使用本地 `UPDATE_REMOTE_ROOT`、`UPDATE_TLS_CERT`、`UPDATE_TLS_KEY` 及日志配置变量。完整统计部署仅修改已有站点的统计日志指令，不替换已有证书或安装包目录。安装包发布目录现在必须显式配置 `UPDATE_REMOTE_ROOT`。

## 查看和排查

在公司网络打开 `http://<STATS_BIND_ADDRESS>:<STATS_HTTP_PORT>/`，无需 SSH 隧道。端口只绑定已配置的私有 IPv4 和回环地址，按本地 CIDR 白名单限制访问；不要将端口映射到公网。页面为内部 HTTP 聚合报表，无登录。启用主机防火墙时只按实际公司来源网段放行。

页面展示估算下载次数、完整发送、流量、版本平台分布，支持日期及版本平台筛选、CSV 导出；部署验证流量和详细请求事实保留在底层数据中。超过五分钟未更新会提示，零值不保证采集链路健康。

```sh
# 在服务器执行
systemctl status clawclaw-download-stats.timer
journalctl -u clawclaw-download-stats.service
systemctl start clawclaw-download-stats.service
# 按本地配置替换 <report-port>
curl --fail http://127.0.0.1:<report-port>/stats.json
```

## 口径和存储

只统计 `/releases/dsh/<version>/ClawClaw-<version>-universal.dmg` 和 `ClawClaw-<version>-x64-Setup.exe`。

| 指标 | 定义 |
| --- | --- |
| 有效请求 | GET 200 / 206 |
| 会话估算 | 同一文件、IP、User-Agent，无活动超过 30 分钟后开启新会话；并发请求按最晚结束时间计算 |
| 完整发送 | 200、正常结束、正文发送字节等于正数 Content-Length；不推断续传完成 |
| 续传、失败、中断 | 分别为 GET 206、GET 4xx/5xx、未正常结束的 GET 200/206 |
| 流量 | 正式安装包所有 GET 响应正文实际发送量，含错误响应 |

会话可跨午夜并计入开始日期，其他事实计入请求开始日期。Nginx 在请求结束时写日志，正在传输的下载暂不显示。HEAD、清单、健康检查、元数据和非正式路径不计入。完整发送不代表安装或客户端 SHA-512 校验成功，会话不代表人数；共享出口、切换网络及未识别机器人都会影响估算。缓存、离线复制、其他服务器的下载无法统计。

发布验证带 `User-Agent: ClawClaw-Release-Verify/1` 和 `X-ClawClaw-Download-Purpose: deployment-verification`，从用户指标排除；标记可伪造，仅用于分类，其他来源为 unknown。

原始日志在 `$STATS_LOG_DIR/downloads.jsonl*`，含 IP 与 User-Agent，只限管理员读取，保留 30 轮日轮转。统计库和密钥位于 `$STATS_DATA_DIR/private/`（0700），只长期保存去标识请求事实、IP/User-Agent 组合 HMAC 和游标，不保存原始 IP、User-Agent 或查询参数。数据库必须和 `ip-hmac.key` 一起备份恢复；缺少密钥时拒绝生成新密钥。聚合报表在 `$STATS_DATA_DIR/report/`。

请求和游标同一事务提交，以 request_id 去重，支持重复导入、rename 轮转、gzip、乱序和跨午夜。禁用 copytruncate；半行延后，无效完整行跳过并计数。每轮重算会话，适合当前单服务器；更大规模需分区。超过保留期未导入的日志无法恢复，启用前普通日志不回填。固定 HMAC 请求事实长期保留，调整保留策略须考虑历史重算与去重。

停用时禁用 timer，按安装器打印的备份位置恢复站点配置及新增的 Nginx include，再执行 `nginx -t && systemctl reload nginx`；日志与状态确认不再需要后手动清理。

验证命令：`corepack pnpm test:download-stats`、`corepack pnpm test:upload-update`、`corepack pnpm test:github-release`。
