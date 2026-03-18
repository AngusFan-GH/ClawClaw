; ${PRODUCT_NAME} Custom NSIS Installer/Uninstaller Script
;
; Install: enables long paths, adds resources\cli to user PATH for openclaw CLI.
; Uninstall: removes the PATH entry and optionally deletes user data.

!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

!define MUI_INSTFILESPAGE_SHOWDETAILS show
!define MUI_UNINSTFILESPAGE_SHOWDETAILS show

ShowInstDetails show
ShowUnInstDetails show

; Installer and uninstaller copy uses English by default and Simplified Chinese
; when the OS installer language is Chinese.
LangString welcomeTitle 1033 "Welcome to ${PRODUCT_NAME}"
LangString welcomeTitle 2052 "欢迎安装 ${PRODUCT_NAME}"
LangString welcomeText 1033 "Install ${PRODUCT_NAME}, configure the bundled OpenClaw CLI, and create the standard Windows shortcuts."
LangString welcomeText 2052 "安装 ${PRODUCT_NAME}，配置内置 OpenClaw CLI，并创建标准 Windows 快捷方式。"

LangString uninstallWelcomeTitle 1033 "Uninstall ${PRODUCT_NAME}"
LangString uninstallWelcomeTitle 2052 "卸载 ${PRODUCT_NAME}"
LangString uninstallWelcomeText 1033 "The uninstaller always removes the app, shortcuts, and the PATH entry for the bundled CLI. On the next page you can also choose whether to delete local settings, logs, and OpenClaw user data."
LangString uninstallWelcomeText 2052 "卸载程序会始终移除应用本体、快捷方式，以及内置 CLI 的 PATH 项。下一页可额外选择是否删除本地设置、日志和 OpenClaw 用户数据。"

LangString installPhasePrepare 1033 "Preparing installation environment..."
LangString installPhasePrepare 2052 "正在准备安装环境..."
LangString installPhaseRemovePrevious 1033 "Checking and removing previous installation..."
LangString installPhaseRemovePrevious 2052 "正在检查并清理旧版本安装..."
LangString installPhaseCopyFiles 1033 "Copying application files..."
LangString installPhaseCopyFiles 2052 "正在复制应用文件..."
LangString installPhaseRegister 1033 "Registering application with Windows..."
LangString installPhaseRegister 2052 "正在向 Windows 注册应用信息..."
LangString installPhaseShortcuts 1033 "Creating shortcuts..."
LangString installPhaseShortcuts 2052 "正在创建快捷方式..."
LangString installPhaseAssociations 1033 "Registering file associations..."
LangString installPhaseAssociations 2052 "正在注册文件关联..."
LangString installPhaseFinalize 1033 "Applying post-install system configuration..."
LangString installPhaseFinalize 2052 "正在执行安装后的系统配置..."

LangString uninstallOptionAppDataTitle 1033 "Also delete ClawClaw settings, cache, and logs"
LangString uninstallOptionAppDataTitle 2052 "同时删除 ClawClaw 设置、缓存和日志"
LangString uninstallOptionAppDataDesc 1033 "Removes local preferences, window state, cached data, and application logs under AppData and LocalAppData."
LangString uninstallOptionAppDataDesc 2052 "删除 AppData 和 LocalAppData 下的本地偏好、窗口状态、缓存数据以及应用日志。"
LangString uninstallOptionOpenClawTitle 1033 "Also delete OpenClaw user data (~/.openclaw)"
LangString uninstallOptionOpenClawTitle 2052 "同时删除 OpenClaw 用户数据（~/.openclaw）"
LangString uninstallOptionOpenClawDesc 1033 "Removes OpenClaw sessions, installed skills, provider settings, and other user data stored in ~/.openclaw."
LangString uninstallOptionOpenClawDesc 2052 "删除 ~/.openclaw 下的 OpenClaw 会话、已安装技能、提供商设置及其他用户数据。"

!macro customWelcomePage
  ; customWelcomePage is expanded at compile-time in assistedInstaller.nsh.
  ; Use MUI welcome-page defines/macros here, not runtime UI commands.
  !define MUI_WELCOMEPAGE_TITLE "$(welcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(welcomeText)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_UNWELCOMEPAGE_TITLE "$(uninstallWelcomeTitle)"
  !define MUI_UNWELCOMEPAGE_TEXT "$(uninstallWelcomeText)"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customCheckAppRunning
  ; Pre-emptively remove old shortcuts to prevent the Windows "Missing Shortcut"
  ; dialog during upgrades.  The built-in NSIS uninstaller deletes ${PRODUCT_NAME}.exe
  ; *before* removing shortcuts; Windows Shell link tracking can detect the
  ; broken target in that brief window and pop a resolver dialog.
  ; Delete is a silent no-op when the file doesn't exist (safe for fresh installs).
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"

  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0

  ${if} $R0 == 0
    ${if} ${isUpdated}
      # allow app to exit without explicit kill
      Sleep 1000
      Goto doStopProcess
    ${endIf}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK doStopProcess
    Quit

    doStopProcess:
    DetailPrint `Closing running "${PRODUCT_NAME}"...`

    # Silently kill the process using nsProcess instead of taskkill / cmd.exe
    ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    
    # to ensure that files are not "in-use"
    Sleep 300

    # Retry counter
    StrCpy $R1 0

    loop:
      IntOp $R1 $R1 + 1

      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        # wait to give a chance to exit gracefully
        Sleep 1000
        ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        
        ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        ${If} $R0 == 0
          DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
          Sleep 2000
        ${else}
          Goto not_running
        ${endIf}
      ${else}
        Goto not_running
      ${endIf}

      # App likely running with elevated permissions.
      # Ask user to close it manually
      ${if} $R1 > 1
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY loop
        Quit
      ${else}
        Goto loop
      ${endIf}
    not_running:
      ${nsProcess::Unload}
  ${endIf}
!macroend

!macro customInstall
  SetDetailsPrint both
  DetailPrint "正在完成安装后的系统配置..."

  ; Enable Windows long path support (Windows 10 1607+ / Windows 11).
  ; pnpm virtual store paths can exceed the default MAX_PATH limit of 260 chars.
  ; Writing to HKLM requires admin privileges; on per-user installs without
  ; elevation this call silently fails.
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1

  ; Use PowerShell to update the current user's PATH.
  ; This avoids NSIS string-buffer limits and preserves long PATH values.
  DetailPrint "正在配置 OpenClaw CLI 命令行环境..."
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\update-user-path.ps1" "${PROJECT_DIR}\resources\cli\win32\update-user-path.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-user-path.ps1" -Action add -CliDir "$INSTDIR\resources\cli"'
  Pop $0
  Pop $1
  StrCmp $0 "error" 0 +2
    DetailPrint "Warning: Failed to launch PowerShell while updating PATH."
  StrCmp $0 "timeout" 0 +2
    DetailPrint "Warning: PowerShell PATH update timed out."
  StrCmp $0 "0" 0 +2
    Goto _ci_done
  DetailPrint "Warning: PowerShell PATH update exited with code $0."

  _ci_done:
  ; Add an explicit Start Menu uninstall shortcut so users have a visible
  ; uninstall entry even when Windows doesn't surface one prominently.
  DetailPrint "正在创建卸载快捷方式..."
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk" "$INSTDIR\${UNINSTALL_FILENAME}"

  DetailPrint "安装后的系统配置已完成。"
!macroend

!macro customUnInstall
  SetDetailsPrint both
  DetailPrint "正在清理 OpenClaw CLI 命令行环境..."
  ; Remove resources\cli from user PATH via PowerShell so long PATH values are handled safely
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\update-user-path.ps1" "${PROJECT_DIR}\resources\cli\win32\update-user-path.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-user-path.ps1" -Action remove -CliDir "$INSTDIR\resources\cli"'
  Pop $0
  Pop $1
  StrCmp $0 "error" 0 +2
    DetailPrint "Warning: Failed to launch PowerShell while removing PATH entry."
  StrCmp $0 "timeout" 0 +2
    DetailPrint "Warning: PowerShell PATH removal timed out."
  StrCmp $0 "0" 0 +2
    Goto _cu_pathDone
  DetailPrint "Warning: PowerShell PATH removal exited with code $0."

  _cu_pathDone:
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk"
  DetailPrint "命令行环境清理已完成。"
!macroend

!macro customUnInstallSection
Section /o "$(uninstallOptionAppDataTitle)" un.RemoveClawClawData
  DetailPrint "正在删除 ClawClaw 本地数据..."
  RMDir /r "$APPDATA\${APP_FILENAME}"
  !ifdef APP_PRODUCT_FILENAME
    RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
  !endif
  !ifdef APP_PACKAGE_NAME
    RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
  !endif
  RMDir /r "$LOCALAPPDATA\${APP_FILENAME}"
  !ifdef APP_PRODUCT_FILENAME
    RMDir /r "$LOCALAPPDATA\${APP_PRODUCT_FILENAME}"
  !endif
  !ifdef APP_PACKAGE_NAME
    RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}"
  !endif
SectionEnd

Section /o "$(uninstallOptionOpenClawTitle)" un.RemoveOpenClawData
  DetailPrint "正在删除 OpenClaw 用户数据..."
  RMDir /r "$PROFILE\.openclaw"
SectionEnd

!insertmacro MUI_UNFUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${un.RemoveClawClawData} "$(uninstallOptionAppDataDesc)"
  !insertmacro MUI_DESCRIPTION_TEXT ${un.RemoveOpenClawData} "$(uninstallOptionOpenClawDesc)"
!insertmacro MUI_UNFUNCTION_DESCRIPTION_END
!macroend
