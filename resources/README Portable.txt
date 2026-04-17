================================================================================
                    ClawClaw Portable Edition
                        便携版
================================================================================

使用方法 / How to Use
--------------------

Windows 用户 / Windows:

  双击运行：
  - "Start ClawClaw.vbs" — 无控制台窗口（推荐）
  - "Start ClawClaw.bat" — 显示控制台窗口（用于调试）

  Double-click to run:
  - "Start ClawClaw.vbs" — No console window (recommended)
  - "Start ClawClaw.bat" — Shows console window (for troubleshooting)

macOS 用户 / macOS:

  第一次运行前，需要在终端赋予执行权限（只需运行一次）：
    chmod +x "Start ClawClaw.command"
    ./Start\ ClawClaw.command

  之后直接双击 "Start ClawClaw.command" 即可启动。

  脚本会自动清除 macOS Gatekeeper 隔离标记，无需手动操作。

3. 所有数据（设置、日志、OpenClaw 配置）将保存在：
   USB上的 portable/ 目录中，不会在电脑上留下任何痕迹。

   All data (settings, logs, OpenClaw config) is stored in:
   The "portable/" directory on your USB — no traces left on the host PC.

首次运行说明 / First Run Notes
------------------------------

- 首次启动需要几秒钟初始化 OpenClaw Gateway（10-30秒），请耐心等待。
  First launch takes 10-30 seconds to initialize OpenClaw Gateway.

- Windows: 如果启动失败，双击 "Start ClawClaw.bat" 查看错误信息。
  macOS: 在终端中运行脚本查看输出。

  If startup fails, double-click the .bat / run the .command in Terminal.

- 便携模式下，所有 AI 模型配置、渠道配置、技能都存储在 U 盘上。
  In portable mode, all AI model configs, channel configs, and skills are on the USB.

便携原理 / How It Works
------------------------

便携版是否生效，取决于发行包中是否包含 portable/ 数据目录。
当 ClawClaw 检测到与程序一起分发的 portable/ 目录时，会把所有数据目录切换到这个 portable/ 目录。

Portable mode is enabled by the bundled portable/ data directory.
When ClawClaw detects that packaged portable/ directory, it stores all data
there instead of using the host computer's user directory.

================================================================================
