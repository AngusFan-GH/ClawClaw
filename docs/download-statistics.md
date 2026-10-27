# 下载统计

[English](download-statistics.en.md)

Nginx 直接提供安装包，Python 3.9+ 标准库程序每分钟读取专用 JSON 日志、更新 SQLite 并生成内部报表。无需升级客户端，不改下载 URL、更新清单或断点续传。时区为北京时间。

## 口径

只统计 `/releases/dsh/<version>/ClawClaw-<version>-universal.dmg` 和 `ClawClaw-<version>-x64-Setup.exe`。

| 指标 | 定义 |
| --- | --- |
| 有效请求 | GET 200 / 206 |
| 下载会话（估算） | 同一安装包、IP、User-Agent，距离上一有效请求结束超过 30 分钟后开启新会话 |
| 完整文件发送 | 200、请求正常结束、正文发送字节等于正数 Content-Length |
| 续传请求 | GET 206，不推断完成 |
| 失败 | GET 4xx / 5xx |
| 中断 | GET 200 / 206 未正常结束 |
| 流量 | 所选安装包所有 GET 响应发送的正文大小，含错误响应 |

会话可跨午夜，计入开始日期；其他事实计入各请求开始日期。并发请求按最晚结束时间计算无活动间隔。HEAD、清单、健康检查、元数据和非正式路径不计入。会话不是人数，完整发送不是安装量或客户端校验成功量。共享出口会合并用户，换 IP 会重复，未识别机器人仍可能计入。无 Content-Length 时保守地不计完整发送。

发布验证脚本为请求添加 `User-Agent: ClawClaw-Release-Verify/1` 和 `X-ClawClaw-Download-Purpose: deployment-verification`。这些请求单独统计，从用户指标排除。标记可伪造，仅用于分类；其他来源统一为 unknown，不区分官网、分享和客户端更新。

## 安装和访问

在本机仓库目录执行以下命令，即可自动上传、备份和验证：

```sh
# 完整部署或更新统计程序、页面、Nginx 配置和定时任务
corepack pnpm deploy:stats
# 只更新页面文字、样式和布局
corepack pnpm deploy:stats --page-only
# 查看目标和文件清单，不连接服务器
corepack pnpm deploy:stats --dry-run
```

默认使用 `root@192.168.103.220:22` 和本机现有 SSH 配置/密钥，不复用无管理权限的 `UPDATE_USER`、发布私钥或发布账号的 known_hosts 文件。可在已忽略的 `.env.server.local` 设置 `STATS_DEPLOY_HOST`、`STATS_DEPLOY_USER`、`STATS_DEPLOY_PORT`、`STATS_DEPLOY_SSH_KEY_FILE` 和 `STATS_DEPLOY_SSH_KNOWN_HOSTS_FILE`；非 root 管理员需免密 sudo。保留严格 SSH 主机指纹校验，未知主机须先人工确认指纹。

完整部署先运行统计回归测试、页面 JS 与安装器语法检查，再校验管理权限、上传并安装。仅页面模式不重启服务。两种模式都会备份既有受管文件到服务器打印的 `/etc/clawclaw/stats-deploy-backup.*/files.tgz`，验证页面资源与 JSON 报表，清理临时上传目录；不会上传凭据或覆盖私有数据库、密钥。失败以非零状态退出；安装器只自动恢复 Nginx 配置，其他文件需要时可从该备份恢复。安装包发布仍使用独立的 `deploy:run` 命令。

以下为服务器端安装器的直接用法，通常无需手动执行。

要求 Linux、Python 3.9+（含 sqlite3）、Nginx、systemd、logrotate。SELinux 环境还需 semanage。在服务器上从包含本仓库 `scripts/`、`deploy/` 的源码目录执行：

```sh
sudo bash deploy/download-stats/install.sh
```

安装器针对当前 `/etc/nginx/conf.d/clawclaw.conf`，仅插入条件日志并保留普通 access log，安装日志格式、报表入口、汇总服务、timer 和独立的 30 轮日轮转配置。先运行汇总和 `nginx -t`，再平滑重载。重复运行保留数据库和密钥。配置备份位置由安装器打印；失败时恢复 Nginx 配置，程序和状态保留用于排查。

其他环境使用 `deploy/clawclaw*.nginx.conf` 前也必须将 `deploy/download-stats/nginx-log.conf` 安装到 http 上下文并创建日志目录。报表监听服务器内网地址 `192.168.103.220:9529` 与回环地址 `127.0.0.1:9529`，只允许回环及公司 `192.168.0.0/16` 网段访问。在公司网络中直接打开 [下载统计](http://192.168.103.220:9529/)，无需本机运行 SSH 隧道。页面为内部 HTTP 汇总报表，无登录；不要将 9529 端口映射到公网。切换服务器地址或公司网段时同步修改 `nginx-report.conf`；若启用主机防火墙，只按实际公司来源网段开放 9529。

页面只保留下载次数估算、完整文件发送、流量和版本平台分布，支持今日、近 7/30 天、自定义日期、版本、平台筛选及 CSV 导出。详细请求指标和部署验证分类仍保存在统计数据中，不在页面展开。加载失败会报错，超过 5 分钟未刷新会提示；零值不能证明采集链路正常。服务器每分钟汇总，页面每 30 秒读取，切回页面时立即读取，通常在下载结束后约 1–2 分钟显示。Nginx 在请求结束时写日志，传输中的下载暂不显示。

## 存储与恢复

- `/var/log/clawclaw-downloads/downloads.jsonl*`：含 IP、User-Agent 的原始日志，仅管理员可读，保留 30 轮日轮转；普通 Nginx 日志保持原有策略。
- `/var/lib/clawclaw-download-stats/private/`：权限 0700，SQLite 长期保存请求事实和游标。IP、User-Agent 仅保存带服务端密钥的组合 HMAC，不保存原始值或查询参数。这是去标识，不是匿名人数统计。数据库和 `ip-hmac.key` 必须一起备份恢复；已有数据库丢失密钥时拒绝重新生成。
- `/var/lib/clawclaw-download-stats/report/`：仅含按日、版本、平台、来源的汇总及页面。
- 请求事实和日志游标在同一事务中提交，以 Nginx request_id 去重。支持重复导入、rename 轮转和 gzip；不用 copytruncate。半行留待下次处理，无效完整行跳过并在当轮报告及服务日志提示数量。
- 每轮重新按时间排序计算会话，支持延迟日志。适用于当前单台服务器；大规模数据需改为分区汇总。摘要请求事实长期保留，调整保留期时须考虑历史重算和去重。
- 超过日志保留期未导入的数据无法恢复。启用前的普通 access log 缺少完成状态、请求 ID、来源，不混入新口径；不补造历史量。页面展示采集启用时间与首次下载日期。缓存、离线复制和其他服务器的下载无法统计。

```sh
systemctl status clawclaw-download-stats.timer
journalctl -u clawclaw-download-stats.service
systemctl start clawclaw-download-stats.service
curl --fail http://127.0.0.1:9529/stats.json
```

停用时停止并禁用 timer，恢复安装器备份中的 `clawclaw.conf`，按备份恢复或删除两个新增 Nginx include，再执行 `nginx -t && systemctl reload nginx`。日志和状态先保留，确认不再需要后手动清理。

验证：`corepack pnpm test:download-stats` 和 `node --test scripts/wait-for-update.test.mjs`。覆盖整包、中断、续传、失败、验证排除、跨午夜、并发、乱序、轮转、重复导入、半行及去标识存储。
