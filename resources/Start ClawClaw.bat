@echo off
:: ClawClaw Portable Launcher
:: Double-click this file to start ClawClaw from USB.
:: All data (settings, logs, OpenClaw config) will be stored in the
:: "portable/" directory next to this file, keeping your USB self-contained.
::
:: If you see a console window, you can close it after ClawClaw starts.
:: For a window-free launch, use "Start ClawClaw.vbs" instead.

cd /d "%~dp0"
start "" "ClawClaw.exe"
