; ${PRODUCT_NAME} custom uninstall helpers.
;
; Shared by:
; - electron-builder's nsis include flow (via installer.nsh)

!include "nsDialogs.nsh"

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
LangString uninstallOptionOpenClawDesc 1033 "Removes all OpenClaw data: agents, channels, providers, and credentials stored in your home directory. This cannot be undone."
LangString uninstallOptionOpenClawDesc 2052 "删除所有 OpenClaw 数据：保存在主目录中的 agents、channels、providers 和 credentials。此操作无法撤销。"
LangString uninstallDataPageTitle 1033 "Choose Data to Remove"
LangString uninstallDataPageTitle 2052 "选择要删除的数据"
LangString uninstallDataPageSubtitle 1033 "Select the additional ClawClaw or OpenClaw data you want removed."
LangString uninstallDataPageSubtitle 2052 "选择你希望额外删除的 ClawClaw 或 OpenClaw 数据。"

Var unRemoveClawClawDataState
Var unRemoveOpenClawDataState
Var unRemoveClawClawDataCheckbox
Var unRemoveOpenClawDataCheckbox

; Replace the default MUI uninstall welcome page with our localised text.
!macro customUnWelcomePage
  !define MUI_UNWELCOMEPAGE_TITLE "$(uninstallWelcomeTitle)"
  !define MUI_UNWELCOMEPAGE_TEXT "$(uninstallWelcomeText)"
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.UninstallDataPageCreate un.UninstallDataPageLeave
!macroend

Function un.UninstallDataPageCreate
  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateLabel} 0 0 100% 12u "$(uninstallDataPageTitle)"
  Pop $1

  ${NSD_CreateLabel} 0 14u 100% 16u "$(uninstallDataPageSubtitle)"
  Pop $2

  ${NSD_CreateCheckbox} 0 38u 100% 12u "$(uninstallOptionAppDataTitle)"
  Pop $unRemoveClawClawDataCheckbox
  ${NSD_Uncheck} $unRemoveClawClawDataCheckbox

  ${NSD_CreateLabel} 12u 52u 88% 20u "$(uninstallOptionAppDataDesc)"
  Pop $3

  ${NSD_CreateCheckbox} 0 86u 100% 12u "$(uninstallOptionOpenClawTitle)"
  Pop $unRemoveOpenClawDataCheckbox
  ${NSD_Uncheck} $unRemoveOpenClawDataCheckbox

  ${NSD_CreateLabel} 12u 100u 88% 24u "$(uninstallOptionOpenClawDesc)"
  Pop $4

  nsDialogs::Show
FunctionEnd

Function un.UninstallDataPageLeave
  ${NSD_GetState} $unRemoveClawClawDataCheckbox $unRemoveClawClawDataState
  ${NSD_GetState} $unRemoveOpenClawDataCheckbox $unRemoveOpenClawDataState
FunctionEnd

!macro RunOpenClawCli commandLine
  nsExec::ExecToStack /TIMEOUT=20000 '"$SYSDIR\cmd.exe" /d /c ""$INSTDIR\resources\cli\openclaw.cmd" ${commandLine}""'
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
    ${If} $0 == "timeout"
      DetailPrint "Warning: openclaw gateway stop timed out; continuing uninstall."
    ${ElseIf} $0 != "0"
      DetailPrint "Warning: openclaw gateway stop exited with code $0."
    ${EndIf}

    !insertmacro RunOpenClawCli "gateway uninstall"
    ${If} $0 == "timeout"
      DetailPrint "Warning: openclaw gateway uninstall timed out; continuing uninstall."
    ${ElseIf} $0 != "0"
      DetailPrint "Warning: openclaw gateway uninstall exited with code $0."
    ${EndIf}
  ${Else}
    DetailPrint "Warning: bundled openclaw CLI wrapper not found, skipping gateway cleanup."
  ${EndIf}

  DetailPrint "正在清理 OpenClaw CLI 命令行环境..."
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\update-user-path.ps1" "${PROJECT_DIR}\resources\cli\win32\update-user-path.ps1"
  nsExec::ExecToStack /TIMEOUT=20000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-user-path.ps1" -Action remove -CliDir "$INSTDIR\resources\cli"'
  Pop $0
  Pop $1
  ${If} $0 == "error"
    DetailPrint "Warning: Failed to launch PowerShell while removing PATH entry."
  ${ElseIf} $0 == "timeout"
    DetailPrint "Warning: PowerShell PATH removal timed out."
  ${ElseIf} $0 != "0"
    DetailPrint "Warning: PowerShell PATH removal exited with code $0."
  ${EndIf}

  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  ; Remove machine-wide leftovers from older installers. The current Windows
  ; installer is per-user, but an obsolete HKLM uninstall entry can make
  ; Windows launch a stale uninstaller path after the app itself is removed.
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY_2}"
  !endif

  SetShellVarContext all
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
  SetShellVarContext current

  ${If} $unRemoveClawClawDataState == ${BST_CHECKED}
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
  ${EndIf}

  ${If} $unRemoveOpenClawDataState == ${BST_CHECKED}
    DetailPrint "正在删除 OpenClaw 用户数据..."
    RMDir /r "$PROFILE\.openclaw"
  ${EndIf}

  DetailPrint "命令行环境清理已完成。"
!macroend
