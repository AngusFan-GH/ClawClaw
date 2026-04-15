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

U 盘上的 .portable 文件是便携模式标记。
当 ClawClaw 检测到这个文件时，会将所有数据目录切换到 U 盘上的 portable/ 目录。

The .portable file on the USB is the portable mode marker.
When ClawClaw detects this file, it stores all data in the portable/ directory
on the USB instead of the host computer's user directory.

================================================================================
