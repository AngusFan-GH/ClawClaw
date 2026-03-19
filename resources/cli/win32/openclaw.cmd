@echo off
setlocal

if /I "%~1"=="update" (
  echo openclaw is managed by ClawClaw ^(bundled version^).
  echo.
  echo To update openclaw, update ClawClaw:
  echo   Open ClawClaw ^> Settings ^> Check for Updates
  echo   Or download the latest version from https://clawclaw.xzinfra.com
  endlocal & exit /b 0
)

for %%I in ("%~dp0..\..") do set "INSTALL_DIR=%%~fI"
set "ENTRY_SCRIPT=%INSTALL_DIR%\resources\openclaw\openclaw.mjs"
set "NODE_EXE=%INSTALL_DIR%\resources\bin\node.exe"
set "OPENCLAW_CWD=%INSTALL_DIR%\resources\openclaw"

if not exist "%ENTRY_SCRIPT%" (
  echo OpenClaw entry script not found at %ENTRY_SCRIPT% 1>&2
  endlocal & exit /b 1
)

if not exist "%NODE_EXE%" (
  set "NODE_EXE=node"
)

set "OPENCLAW_EMBEDDED_IN=ClawClaw"

pushd "%OPENCLAW_CWD%" >nul
"%NODE_EXE%" --disable-warning=ExperimentalWarning "%ENTRY_SCRIPT%" %*
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

endlocal & exit /b %EXIT_CODE%
