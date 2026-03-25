; ${PRODUCT_NAME} custom uninstall helpers.
;
; Shared by:
; - electron-builder's nsis include flow (via installer.nsh)
; - custom BUILD_UNINSTALLER flow (via installer.nsi)

LangString uninstallWelcomeTitle 1033 "Uninstall ${PRODUCT_NAME}"
LangString uninstallWelcomeTitle 2052 "卸载 ${PRODUCT_NAME}"
LangString uninstallWelcomeText 1033 "The uninstaller always removes the app, shortcuts, the PATH entry for the bundled CLI, and attempts to stop/uninstall the OpenClaw Gateway service. On the next page you can also choose whether to delete local settings, logs, and OpenClaw user data."
LangString uninstallWelcomeText 2052 "卸载程序会始终移除应用本体、快捷方式、内置 CLI 的 PATH 项，并尝试停止和卸载 OpenClaw Gateway 服务。下一页可额外选择是否删除本地设置、日志和 OpenClaw 用户数据。"

LangString uninstallOptionAppDataTitle 1033 "Also delete ClawClaw settings, cache, and logs"
LangString uninstallOptionAppDataTitle 2052 "同时删除 ClawClaw 设置、缓存和日志"
LangString uninstallOptionAppDataDesc 1033 "Removes local preferences, window state, cached data, and application logs under AppData and LocalAppData."
LangString uninstallOptionAppDataDesc 2052 "删除 AppData 和 LocalAppData 下的本地偏好、窗口状态、缓存数据以及应用日志。"
LangString uninstallOptionOpenClawTitle 1033 "Also delete OpenClaw user data (~/.openclaw)"
LangString uninstallOptionOpenClawTitle 2052 "同时删除 OpenClaw 用户数据（~/.openclaw）"
LangString uninstallOptionOpenClawDesc 1033 "Removes OpenClaw sessions, managed workspaces, installed skills, provider settings, and other user data stored in ~/.openclaw."
LangString uninstallOptionOpenClawDesc 2052 "删除 ~/.openclaw 下的 OpenClaw 会话、托管工作区、已安装技能、提供商设置及其他用户数据。"

; Replace the default MUI uninstall welcome page with our localised text.
!macro customUnWelcomePage
  !define MUI_UNWELCOMEPAGE_TITLE "$(uninstallWelcomeTitle)"
  !define MUI_UNWELCOMEPAGE_TEXT "$(uninstallWelcomeText)"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro RunOpenClawCli commandLine
  nsExec::ExecToStack '"$SYSDIR\cmd.exe" /d /c ""$INSTDIR\resources\cli\openclaw.cmd" ${commandLine}""'
  Pop $0
  Pop $1
!macroend

; Core uninstaller cleanup: stop gateway, remove PATH entry, remove shortcuts.
; File/registry cleanup is handled by electron-builder's built-in uninstaller section.
!macro customUnInstall
  SetDetailsPrint both
  DetailPrint "正在停止并清理 OpenClaw Gateway 服务..."

  ${If} ${FileExists} "$INSTDIR\resources\cli\openclaw.cmd"
    !insertmacro RunOpenClawCli "gateway stop"
    StrCmp $0 "0" +2 0
      DetailPrint "Warning: openclaw gateway stop exited with code $0."

    !insertmacro RunOpenClawCli "gateway uninstall"
    StrCmp $0 "0" +2 0
      DetailPrint "Warning: openclaw gateway uninstall exited with code $0."
  ${Else}
    DetailPrint "Warning: bundled openclaw CLI wrapper not found, skipping gateway cleanup."
  ${EndIf}

  DetailPrint "正在清理 OpenClaw CLI 命令行环境..."
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
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
  DetailPrint "命令行环境清理已完成。"
!macroend

; Optional section checkboxes for the uninstaller UI.
; electron-builder's template checks !ifmacrodef customUnInstallSection to decide
; whether to call MUI_UNPAGE_COMPONENTS.  This macro is expanded in the uninstaller
; section; the Section declarations inside assign checkbox IDs
; (un.RemoveClawClawData, un.RemoveOpenClawData).
;
; IMPORTANT: MUI_UNFUNCTION_DESCRIPTION_BEGIN/END must be at the same compile level
; as the Section declarations it annotates.  Both are guarded by !ifdef BUILD_UNINSTALLER
; because they are only meaningful in the uninstaller script.
!ifdef BUILD_UNINSTALLER
  !macro customUnInstallSection
    Section /o "$(uninstallOptionAppDataTitle)" un.RemoveClawClawData
    SectionEnd

    Section /o "$(uninstallOptionOpenClawTitle)" un.RemoveOpenClawData
    SectionEnd
  !macroend

  !insertmacro MUI_UNFUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${un.RemoveClawClawData} "$(uninstallOptionAppDataDesc)"
    !insertmacro MUI_DESCRIPTION_TEXT ${un.RemoveOpenClawData} "$(uninstallOptionOpenClawDesc)"
  !insertmacro MUI_UNFUNCTION_DESCRIPTION_END
!endif
