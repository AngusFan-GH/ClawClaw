; ${PRODUCT_NAME} custom uninstall helpers.
;
; Shadowed upstream template: app-builder-lib/templates/nsis/uninstaller.nsh
;
; Shared by:
; - electron-builder's nsis include flow (via installer.nsh)
; - custom BUILD_UNINSTALLER flow (via installer.nsi)

!include "nsDialogs.nsh"
!include "Sections.nsh"

LangString uninstallWelcomeTitle 1033 "Uninstall ${PRODUCT_NAME}"
LangString uninstallWelcomeTitle 2052 "卸载 ${PRODUCT_NAME}"
LangString uninstallWelcomeText 1033 "The uninstaller always removes the app, shortcuts, the PATH entry for the bundled CLI, and attempts to stop/uninstall the OpenClaw Gateway service. On the next page you can also choose whether to delete local settings, logs, and OpenClaw user data."
LangString uninstallWelcomeText 2052 "卸载程序会始终移除应用本体、快捷方式、内置 CLI 的 PATH 项，并尝试停止和卸载 OpenClaw Gateway 服务。下一页可额外选择是否删除本地设置、日志和 OpenClaw 用户数据。"

LangString uninstallOptionAppDataTitle 1033 "Also delete ClawClaw settings, cache, and logs"
LangString uninstallOptionAppDataTitle 2052 "同时删除 ClawClaw 设置、缓存和日志"
LangString uninstallOptionAppDataDesc 1033 "Removes your personal settings, chat history, app cache, and log files from $APPDATA and $LOCALAPPDATA. Your OpenClaw data (~/.openclaw) will NOT be deleted."
LangString uninstallOptionAppDataDesc 2052 "删除 $APPDATA 和 $LOCALAPPDATA 中的个人设置、聊天记录、应用缓存和日志文件。OpenClaw 用户数据（~/.openclaw）不会被删除。"

LangString uninstallOptionOpenClawTitle 1033 "Also delete OpenClaw user data (~/.openclaw)"
LangString uninstallOptionOpenClawTitle 2052 "同时删除 OpenClaw 用户数据（~/.openclaw）"
LangString uninstallOptionOpenClawDesc 1033 "Removes all OpenClaw data from ~/.openclaw, including agents, channels, providers, credentials, local runtime state, and session data. This cannot be undone."
LangString uninstallOptionOpenClawDesc 2052 "删除 ~/.openclaw 中的所有 OpenClaw 数据，包括 agents、channels、providers、credentials、本地运行时状态和会话数据。此操作无法撤销。"
LangString uninstallComponentsTop 1033 "Choose the additional data you want to remove."
LangString uninstallComponentsTop 2052 "选择你希望额外删除的数据。"
LangString uninstallLogGatewayCleanup 1033 "Stopping and cleaning up the OpenClaw Gateway service..."
LangString uninstallLogGatewayCleanup 2052 "正在停止并清理 OpenClaw Gateway 服务..."
LangString uninstallLogGatewayStopExit 1033 "Warning: openclaw gateway stop exited with code $0."
LangString uninstallLogGatewayStopExit 2052 "警告：openclaw gateway stop 的退出码为 $0。"
LangString uninstallLogGatewayUninstallExit 1033 "Warning: openclaw gateway uninstall exited with code $0."
LangString uninstallLogGatewayUninstallExit 2052 "警告：openclaw gateway uninstall 的退出码为 $0。"
LangString uninstallLogGatewayMissing 1033 "Warning: bundled openclaw CLI wrapper not found, skipping gateway cleanup."
LangString uninstallLogGatewayMissing 2052 "警告：未找到内置 openclaw CLI 包装脚本，跳过 Gateway 清理。"
LangString uninstallLogCliCleanup 1033 "Cleaning up the OpenClaw CLI command-line environment..."
LangString uninstallLogCliCleanup 2052 "正在清理 OpenClaw CLI 命令行环境..."
LangString uninstallLogPathLaunchFailed 1033 "Warning: Failed to launch PowerShell while removing PATH entry."
LangString uninstallLogPathLaunchFailed 2052 "警告：启动 PowerShell 移除 PATH 失败。"
LangString uninstallLogPathTimeout 1033 "Warning: PowerShell PATH removal timed out."
LangString uninstallLogPathTimeout 2052 "警告：PowerShell 移除 PATH 超时。"
LangString uninstallLogPathExitCode 1033 "Warning: PowerShell PATH removal exited with code $0."
LangString uninstallLogPathExitCode 2052 "警告：PowerShell 移除 PATH 的退出码为 $0。"
LangString uninstallLogCliCleanupDone 1033 "Command-line environment cleanup completed."
LangString uninstallLogCliCleanupDone 2052 "命令行环境清理已完成。"
LangString uninstallLogRemoveAppData 1033 "Removing local ClawClaw data..."
LangString uninstallLogRemoveAppData 2052 "正在删除 ClawClaw 本地数据..."
LangString uninstallLogRemoveOpenClawData 1033 "Removing OpenClaw user data..."
LangString uninstallLogRemoveOpenClawData 2052 "正在删除 OpenClaw 用户数据..."

!define MUI_COMPONENTSPAGE_SMALLDESC
!define MUI_COMPONENTSPAGE_TEXT_TOP "$(uninstallComponentsTop)"

; Replace the default MUI uninstall welcome page with our localised text.
!macro customUnWelcomePage
  !define MUI_UNWELCOMEPAGE_TITLE "$(uninstallWelcomeTitle)"
  !define MUI_UNWELCOMEPAGE_TEXT "$(uninstallWelcomeText)"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUnInit
  ; Optional data deletion is selected exclusively through the uninstall
  ; components page. Keep both sections opt-in by default for interactive and
  ; silent uninstalls.
  !insertmacro UnselectSection ${un.RemoveClawClawData}
  !insertmacro UnselectSection ${un.RemoveOpenClawData}
!macroend

!macro RunOpenClawCli commandLine
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\run-gateway-cmd.ps1" "${PROJECT_DIR}\scripts\run-gateway-cmd.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\run-gateway-cmd.ps1" -InstallDir "$INSTDIR" -Command "${commandLine}"'
  Pop $0
  Pop $1
!macroend

!macro KillInstallDirProcesses
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\kill-install-dir-processes.ps1" "${PROJECT_DIR}\scripts\kill-install-dir-processes.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\kill-install-dir-processes.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  ; Give Windows a moment to release file handles after termination.
  Sleep 1500
!macroend

!macro DetectInstallDirLocks resultVar
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\check-install-dir-locks.ps1" "${PROJECT_DIR}\scripts\check-install-dir-locks.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\check-install-dir-locks.ps1" -InstallDir "$INSTDIR"'
  Pop ${resultVar}
  Pop $1
!macroend

; Core uninstaller cleanup: stop gateway, remove PATH entry, remove shortcuts.
; File/registry cleanup is handled by electron-builder's built-in uninstaller section.
!macro customUnInstall
  SetDetailsPrint both
  !insertmacro KillInstallDirProcesses
  DetailPrint "$(uninstallLogGatewayCleanup)"

  ${If} ${FileExists} "$INSTDIR\resources\cli\openclaw.cmd"
    !insertmacro RunOpenClawCli "gateway stop"
    StrCmp $0 "0" +2 0
      DetailPrint "$(uninstallLogGatewayStopExit)"

    !insertmacro RunOpenClawCli "gateway uninstall"
    StrCmp $0 "0" +2 0
      DetailPrint "$(uninstallLogGatewayUninstallExit)"
  ${Else}
    DetailPrint "$(uninstallLogGatewayMissing)"
  ${EndIf}

  DetailPrint "$(uninstallLogCliCleanup)"
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\update-user-path.ps1" "${PROJECT_DIR}\resources\cli\win32\update-user-path.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\update-user-path.ps1" -Action remove -CliDir "$INSTDIR\resources\cli"'
  Pop $0
  Pop $1
  StrCmp $0 "error" 0 +2
    DetailPrint "$(uninstallLogPathLaunchFailed)"
  StrCmp $0 "timeout" 0 +2
    DetailPrint "$(uninstallLogPathTimeout)"
  StrCmp $0 "0" 0 +2
    Goto _cu_pathDone
  DetailPrint "$(uninstallLogPathExitCode)"

  _cu_pathDone:
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\$(uninstallShortcutTitle).lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  !insertmacro KillInstallDirProcesses
  DetailPrint "$(uninstallLogCliCleanupDone)"
!macroend

; Keep optional data cleanup in dedicated uninstall sections so electron-builder's
; standard silent uninstall path remains compatible with older installers.
!macro customUnInstallSection
  Section /o "$(uninstallOptionAppDataTitle)" un.RemoveClawClawData
    DetailPrint "$(uninstallLogRemoveAppData)"
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
    DetailPrint "$(uninstallLogRemoveOpenClawData)"
    RMDir /r "$PROFILE\.openclaw"
  SectionEnd

  !insertmacro MUI_UNFUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${un.RemoveClawClawData} "$(uninstallOptionAppDataDesc)"
    !insertmacro MUI_DESCRIPTION_TEXT ${un.RemoveOpenClawData} "$(uninstallOptionOpenClawDesc)"
  !insertmacro MUI_UNFUNCTION_DESCRIPTION_END
!macroend
