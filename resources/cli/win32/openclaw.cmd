@echo off
setlocal

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%PS%" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0openclaw.ps1" %*
endlocal & exit /b %ERRORLEVEL%
