; ${PRODUCT_NAME} Custom NSIS Installer/Uninstaller Script
;
; Install: enables long paths, adds resources\cli to user PATH for openclaw CLI.
; Uninstall: removes the PATH entry and optionally deletes user data.

; Add scripts dir to include search path so our patched installSection.nsh
; (which sets SetDetailsPrint both instead of none) is found before
; electron-builder's templates version.
!addincludedir "${PROJECT_DIR}/scripts"
!include "WordFunc.nsh"

!define MUI_INSTFILESPAGE_SHOWDETAILS show
!define MUI_UNINSTFILESPAGE_SHOWDETAILS show
!define MUI_FINISHPAGE_RUN_CHECKED

ShowInstDetails show
ShowUnInstDetails show

!macro customHeader
  ; Restore visible install/uninstall details panes under electron-builder's
  ; standard include-based NSIS template.
  ShowInstDetails show
  ShowUninstDetails show
!macroend

Var /GLOBAL shouldRunLegacyUninstaller
Var /GLOBAL isLegacyInstalledVersion

!macro customInstallMode
  ; ClawClaw writes user-scoped config, keychain entries, and PATH entries.
  ; Keep assisted installs in the current-user scope so Windows does not offer
  ; a per-machine path that our post-install setup does not support.
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro SetInstallPhase phaseText
  ${IfNot} ${Silent}
    SetDetailsPrint both
    ; 1006 is the standard NSIS/MUI instfiles status label above the details
    ; pane. If a future template changes it, DetailPrint still keeps the
    ; details log useful.
    GetDlgItem $R9 $HWNDPARENT 1006
    ${If} $R9 <> 0
      SendMessage $R9 ${WM_SETTEXT} 0 "STR:${phaseText}"
    ${EndIf}
    DetailPrint ""
    DetailPrint "=== ${phaseText} ==="
  ${EndIf}
!macroend

; assistedInstaller.nsh calls MUI_PAGE_DIRECTORY (when allowToChangeInstallationDirectory
; is true), which sets MUI_PAGE_CUSTOMFUNCTION_PRE="instFilesPre".  MUI_PAGE_INSTFILES
; then reuses that value.  Override it here via customPageAfterChangeDir, which
; electron-builder inserts AFTER MUI_PAGE_DIRECTORY but BEFORE MUI_PAGE_INSTFILES.
; We set both MUI_PAGE_CUSTOMFUNCTION_PRE (runs in pre-function) and
; MUI_PAGE_CUSTOMFUNCTION_LEAVE (runs in leave function, before section body).
; MUI's MUI_FUNCTION_INSTFILESPAGE undefs MUI_PAGE_CUSTOMFUNCTION_* after calling
; them, so each is independent.
!macro customPageAfterChangeDir
  ; MUI_PAGE_DIRECTORY (called before this macro) sets MUI_PAGE_CUSTOMFUNCTION_PRE
  ; to "instFilesPre".  MUI_PAGE_INSTFILES reuses that value, so we must undefine
  ; and redefine it to inject our function.
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !ifdef MUI_PAGE_CUSTOMFUNCTION_SHOW
    !undef MUI_PAGE_CUSTOMFUNCTION_SHOW
  !endif
  !ifdef MUI_PAGE_CUSTOMFUNCTION_LEAVE
    !undef MUI_PAGE_CUSTOMFUNCTION_LEAVE
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_PRE "customInstFilesPre-custom"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW "customInstFilesShow-custom"
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE "customInstFilesLeave-custom"

  Function customInstFilesPre-custom
    SetDetailsPrint both
    !insertmacro SetInstallPhase "$(installPhasePrepare)"
  FunctionEnd

  Function customInstFilesShow-custom
    ; Use the native MUI "show details" mode only. Manually clicking the
    ; built-in toggle can leave the details control visible but detached from
    ; the actual installer output on some Windows builds.
    SetDetailsPrint both
    !insertmacro SetInstallPhase "$(installPhasePrepare)"
  FunctionEnd

  Function customInstFilesLeave-custom
    SetDetailsPrint both
  FunctionEnd
!macroend

!include "${PROJECT_DIR}\scripts\uninstaller.nsh"

; Installer and uninstaller copy uses English by default and Simplified Chinese
; when the OS installer language is Chinese.
LangString welcomeTitle 1033 "Welcome to ${PRODUCT_NAME}"
LangString welcomeTitle 2052 "欢迎安装 ${PRODUCT_NAME}"
LangString welcomeText 1033 "Install ${PRODUCT_NAME}, configure the bundled OpenClaw CLI, and create the standard Windows shortcuts."
LangString welcomeText 2052 "安装 ${PRODUCT_NAME}，配置内置 OpenClaw CLI，并创建标准 Windows 快捷方式。"

LangString installPhasePrepare 1033 "Initializing installer..."
LangString installPhasePrepare 2052 "正在初始化安装器..."
LangString installPhaseCheckRunning 1033 "Checking for running processes from the previous installation..."
LangString installPhaseCheckRunning 2052 "正在检查旧版本的相关进程..."
LangString installPhaseClosingRunning 1033 "Stopping processes from the previous installation..."
LangString installPhaseClosingRunning 2052 "正在停止旧版本相关进程..."
LangString installPhaseWaitRunning 1033 "Waiting for previous-installation processes to exit..."
LangString installPhaseWaitRunning 2052 "正在等待旧版本相关进程退出..."
LangString installPhaseRemovePrevious 1033 "Checking and removing previous installation..."
LangString installPhaseRemovePrevious 2052 "正在检查并清理旧版本安装..."
LangString installPhaseStopGateway 1033 "Stopping bundled Gateway from the previous installation..."
LangString installPhaseStopGateway 2052 "正在停止旧版本内置 Gateway..."
LangString installPhaseUninstallGatewayService 1033 "Removing bundled Gateway service/task from the previous installation..."
LangString installPhaseUninstallGatewayService 2052 "正在卸载旧版本内置 Gateway 服务/任务..."
LangString installPhaseCleanRuntime 1033 "Cleaning bundled OpenClaw runtime from the previous installation..."
LangString installPhaseCleanRuntime 2052 "正在清理旧版 OpenClaw 运行时..."
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
LangString installPhaseValidateRuntime 1033 "Validating bundled OpenClaw runtime..."
LangString installPhaseValidateRuntime 2052 "正在验证内置 OpenClaw 运行时..."
LangString installRuntimeValidationFailed 1033 "The bundled OpenClaw runtime did not pass the post-install check, so setup cannot finish safely.$\r$\n$\r$\nOpen the installer details above for the exact missing file or dependency, then rebuild or reinstall the latest package."
LangString installRuntimeValidationFailed 2052 "内置 OpenClaw 运行时未通过安装后检查，因此安装器无法安全完成。$\r$\n$\r$\n请展开上方安装详情，查看具体缺失的文件或依赖，然后重新构建或安装最新安装包。"
LangString installFilesLocked 1033 "Files from the previous installation are still in use.$\r$\n$\r$\nClose the related ClawClaw or runtime process, then click Retry."
LangString installFilesLocked 2052 "旧版本安装中的文件仍被占用。$\r$\n$\r$\n请关闭相关的 ClawClaw 或运行时进程，然后单击“重试”。"
LangString installLogGatewayStopExit 1033 "Gateway stop exited with code $R6."
LangString installLogGatewayStopExit 2052 "Gateway 停止命令退出码：$R6。"
LangString installLogGatewayUninstallExit 1033 "Gateway uninstall exited with code $R6."
LangString installLogGatewayUninstallExit 2052 "Gateway 卸载命令退出码：$R6。"
LangString installLogOldUninstallContinue 1033 "Old uninstaller exited with code $R0 during a silent update. Continuing with managed overwrite cleanup."
LangString installLogOldUninstallContinue 2052 "静默更新期间旧卸载器退出码为 $R0，继续执行受控覆盖清理。"
LangString installLogOldUninstallFallback 1033 "Silent uninstall failed with code $R0. Falling back to interactive old uninstaller."
LangString installLogOldUninstallFallback 2052 "静默卸载失败，退出码为 $R0。正在回退到交互式旧卸载器。"
LangString installLogOldUninstallLaunchFailed 1033 "Old uninstaller could not be launched. Continuing with managed overwrite cleanup."
LangString installLogOldUninstallLaunchFailed 2052 "无法启动旧卸载器，继续执行受控覆盖清理。"
LangString installLogOldUninstallFailed 1033 "Old uninstall was not successful. Uninstaller error code: $R0."
LangString installLogOldUninstallFailed 2052 "旧卸载未成功完成。卸载器错误码：$R0。"
LangString installLogFinalize 1033 "Finalizing post-install system configuration."
LangString installLogFinalize 2052 "正在完成安装后的系统配置。"
LangString installLogStartMenuShortcut 1033 "Creating Start Menu shortcut folder and app shortcut..."
LangString installLogStartMenuShortcut 2052 "正在创建开始菜单文件夹和应用快捷方式..."
LangString installLogDesktopShortcutRebuild 1033 "Rebuilding desktop shortcut for upgrade..."
LangString installLogDesktopShortcutRebuild 2052 "正在为升级重建桌面快捷方式..."
LangString installLogCliPathUpdate 1033 "Updating user PATH for the bundled OpenClaw CLI..."
LangString installLogCliPathUpdate 2052 "正在更新内置 OpenClaw CLI 的用户 PATH..."
LangString installLogPathLaunchFailed 1033 "Warning: Failed to launch PowerShell while updating PATH entry."
LangString installLogPathLaunchFailed 2052 "警告：启动 PowerShell 更新 PATH 失败。"
LangString installLogPathTimeout 1033 "Warning: PowerShell PATH update timed out."
LangString installLogPathTimeout 2052 "警告：PowerShell 更新 PATH 超时。"
LangString installLogPathExitCode 1033 "Warning: PowerShell PATH update exited with code $0."
LangString installLogPathExitCode 2052 "警告：PowerShell 更新 PATH 的退出码为 $0。"
LangString installLogRuntimeValidationPassed 1033 "OpenClaw runtime validation passed."
LangString installLogRuntimeValidationPassed 2052 "OpenClaw 运行时校验通过。"
LangString installLogRuntimeValidationFailedCode 1033 "Bundled runtime validation failed with exit code $0."
LangString installLogRuntimeValidationFailedCode 2052 "内置运行时校验失败，退出码为 $0。"
LangString installLogRuntimeValidationLaunchFailed 1033 "Bundled runtime validation could not be launched. Check that PowerShell and bundled node.exe are available."
LangString installLogRuntimeValidationLaunchFailed 2052 "无法启动内置运行时校验。请检查 PowerShell 和随包 node.exe 是否可用。"
LangString installLogRuntimeValidationTimedOut 1033 "Bundled runtime validation timed out."
LangString installLogRuntimeValidationTimedOut 2052 "内置运行时校验超时。"
LangString installLogUninstallShortcut 1033 "Creating explicit Start Menu uninstall shortcut..."
LangString installLogUninstallShortcut 2052 "正在创建开始菜单卸载快捷方式..."
LangString installLogFinalizeDone 1033 "Post-install system configuration completed."
LangString installLogFinalizeDone 2052 "安装后的系统配置已完成。"
LangString uninstallShortcutTitle 1033 "Uninstall ${PRODUCT_NAME}"
LangString uninstallShortcutTitle 2052 "卸载 ${PRODUCT_NAME}"

!macro customWelcomePage
  ; customWelcomePage is expanded at compile-time in assistedInstaller.nsh.
  ; Use MUI welcome-page defines/macros here, not runtime UI commands.
  !define MUI_WELCOMEPAGE_TITLE "$(welcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(welcomeText)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customCheckAppRunning
  ; Pre-emptively remove old shortcuts to prevent the Windows "Missing Shortcut"
  ; dialog during upgrades.  The built-in NSIS uninstaller deletes ${PRODUCT_NAME}.exe
  ; *before* removing shortcuts; Windows Shell link tracking can detect the
  ; broken target in that brief window and pop a resolver dialog.
  ; Delete is a silent no-op when the file doesn't exist (safe for fresh installs).
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk"

  !insertmacro EnsurePreviousInstallReadyForUpgrade
!macroend

!macro RunManagedUpgradeCleanup
  !insertmacro SetInstallPhase "$(installPhaseCheckRunning)"
  !insertmacro KillInstallDirProcesses
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\run-gateway-cmd.ps1" "${PROJECT_DIR}\scripts\run-gateway-cmd.ps1"
  ${If} ${FileExists} "$INSTDIR\resources\cli\openclaw.cmd"
    !insertmacro SetInstallPhase "$(installPhaseStopGateway)"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\run-gateway-cmd.ps1" -InstallDir "$INSTDIR" -Command "gateway stop"'
    Pop $R6
    DetailPrint "$(installLogGatewayStopExit)"
    !insertmacro SetInstallPhase "$(installPhaseUninstallGatewayService)"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\run-gateway-cmd.ps1" -InstallDir "$INSTDIR" -Command "gateway uninstall"'
    Pop $R6
    DetailPrint "$(installLogGatewayUninstallExit)"
  ${EndIf}
  !insertmacro KillInstallDirProcesses
!macroend

!macro EnsurePreviousInstallReadyForUpgrade
  ; Best-effort preflight cleanup before we decide the previous installation
  ; is still blocking the upgrade. In practice the lingering locker is often
  ; the bundled Gateway or its node child, not the ClawClaw UI itself.
  !insertmacro RunManagedUpgradeCleanup
  !insertmacro DetectInstallDirLocks $R0

  ${if} $R0 == 2
    !insertmacro SetInstallPhase "$(installPhaseClosingRunning)"
    !insertmacro KillInstallDirProcesses

    ; KillInstallDirProcesses already waits 1.5s internally for handle release.
    ; No additional sleep needed here — DetectInstallDirLocks below will
    ; immediately determine whether the locks are cleared.

    StrCpy $R1 0

    loop:
      IntOp $R1 $R1 + 1
      !insertmacro KillInstallDirProcesses

      !insertmacro DetectInstallDirLocks $R0
      ${if} $R0 == 2
        ; Give Windows more time to fully release file handles.
        Sleep 3000
        !insertmacro KillInstallDirProcesses
        !insertmacro DetectInstallDirLocks $R0
        ${If} $R0 == 2
          !insertmacro SetInstallPhase "$(installPhaseWaitRunning)"
          Sleep 5000
        ${else}
          Goto not_running
        ${endIf}
      ${else}
        Goto not_running
      ${endIf}

      ${if} $R1 > 1
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(installFilesLocked)" /SD IDCANCEL IDRETRY loop
        Abort
      ${else}
        Goto loop
      ${endIf}
    not_running:
      !insertmacro KillInstallDirProcesses
  ${endIf}
!macroend

Function NormalizeInstallPath
  Exch $0
  Push $1

  StrCpy $1 $0 1 -1
  ${If} $1 == "\"
    StrCpy $0 $0 -1
  ${EndIf}

  Pop $1
  Exch $0
FunctionEnd

!macro NormalizeInstallPath outVar inVar
  Push "${inVar}"
  Call NormalizeInstallPath
  Pop "${outVar}"
!macroend

!macro ResolveUpgradeStrategy
  StrCpy $shouldRunLegacyUninstaller "true"

  ${if} ${isUpdated}
    ReadRegStr $R2 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $R3 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    !insertmacro NormalizeInstallPath $R2 $R2
    !insertmacro NormalizeInstallPath $R3 $R3
    !insertmacro NormalizeInstallPath $R4 $INSTDIR

    ${if} $installMode == "all"
      ${if} $R3 == $R4
      ${andIf} $R2 == ""
        StrCpy $shouldRunLegacyUninstaller "false"
      ${endIf}
    ${else}
      ${if} $R2 == $R4
      ${andIf} $R3 == ""
        StrCpy $shouldRunLegacyUninstaller "false"
      ${endIf}
    ${endIf}
  ${endif}
!macroend

!macro ResolveInstalledVersionCompatibility
  StrCpy $isLegacyInstalledVersion "false"
  StrCpy $R5 ""
  StrCpy $R6 ""

  ReadRegStr $R5 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ReadRegStr $R6 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"

  ${If} $R5 != ""
    ${VersionCompare} "$R5" "0.1.15" $R7
    ${If} $R7 == 0
    ${OrIf} $R7 == 2
      StrCpy $isLegacyInstalledVersion "true"
    ${EndIf}
  ${EndIf}

  ${If} $isLegacyInstalledVersion != "true"
  ${AndIf} $R6 != ""
    ${VersionCompare} "$R6" "0.1.15" $R7
    ${If} $R7 == 0
    ${OrIf} $R7 == 2
      StrCpy $isLegacyInstalledVersion "true"
    ${EndIf}
  ${EndIf}
!macroend

!macro LegacyKillInstallDirProcesses INSTALL_DIR
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\kill-install-dir-processes.ps1" "${PROJECT_DIR}\scripts\kill-install-dir-processes.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\kill-install-dir-processes.ps1" -InstallDir "${INSTALL_DIR}"'
  Pop $R6
  Pop $R7
!macroend

!macro LegacyRunGatewayCmd INSTALL_DIR COMMAND
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\run-gateway-cmd.ps1" "${PROJECT_DIR}\scripts\run-gateway-cmd.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\run-gateway-cmd.ps1" -InstallDir "${INSTALL_DIR}" -Command "${COMMAND}"'
  Pop $R6
  Pop $R7
!macroend

!macro LegacyManagedCleanup INSTALL_DIR
  !insertmacro LegacyKillInstallDirProcesses "${INSTALL_DIR}"
  ${If} ${FileExists} "${INSTALL_DIR}\resources\cli\openclaw.cmd"
    DetailPrint "Stopping bundled Gateway from the previous installation..."
    !insertmacro LegacyRunGatewayCmd "${INSTALL_DIR}" "gateway stop"
    DetailPrint "Removing bundled Gateway service/task from the previous installation..."
    !insertmacro LegacyRunGatewayCmd "${INSTALL_DIR}" "gateway uninstall"
  ${EndIf}
  !insertmacro LegacyKillInstallDirProcesses "${INSTALL_DIR}"
!macroend

!macro ContinueWithManagedOverwriteCleanup
  DetailPrint "$(installLogOldUninstallContinue)"
  ${if} $installationDir != ""
    !insertmacro LegacyManagedCleanup "$installationDir"
  ${else}
    !insertmacro RunManagedUpgradeCleanup
  ${endif}
  ClearErrors
  Return
!macroend

!macro FallbackInteractiveOldUninstall
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
    "The installed ClawClaw version could not be removed silently.$\r$\n$\r$\nClawClaw will now open the old uninstaller. Complete that uninstall, then setup will continue automatically." \
    /SD IDCANCEL IDOK +2
  Abort

  DetailPrint "$(installLogOldUninstallFallback)"
  !insertmacro KillInstallDirProcesses

  StrCpy $R8 ""
  ${if} $installMode == "CurrentUser"
  ${orIf} $rootKey == "HKEY_CURRENT_USER"
    StrCpy $R8 "/currentuser"
  ${else}
    StrCpy $R8 "/allusers"
  ${endif}

  ExecWait '"$uninstallerFileName" $R8 _?=$installationDir' $R0
  !insertmacro KillInstallDirProcesses
  ${If} $R0 == 0
    ClearErrors
    Return
  ${EndIf}
!macroend

!macro HandleOldUninstallResult
  IfErrors 0 +4
    DetailPrint "$(installLogOldUninstallLaunchFailed)"
    !insertmacro ContinueWithManagedOverwriteCleanup

  ${if} $R0 == 0
    Return
  ${endif}

  ${If} ${isUpdated}
    ${If} ${Silent}
      !insertmacro ContinueWithManagedOverwriteCleanup
    ${Else}
      !insertmacro FallbackInteractiveOldUninstall
    ${EndIf}
  ${EndIf}

  MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
  DetailPrint "$(installLogOldUninstallFailed)"
  SetErrorLevel 2
  Quit
!macroend

!macro customUnInstallCheck
  !insertmacro HandleOldUninstallResult
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro HandleOldUninstallResult
!macroend

!macro customInstall
  ; Keep detail output fully enabled so the status line and details pane stay
  ; in sync during post-install steps.
  SetDetailsPrint both
  !insertmacro SetInstallPhase "$(installPhaseFinalize)"
  DetailPrint "$(installLogFinalize)"

  ; If a late copy retry had to move the previous install directory out of the
  ; way, clean those stale directories asynchronously after first launch
  ; pressure has passed.
  IfFileExists "$INSTDIR._stale_0\" 0 +2
    ExecShell "" "cmd.exe" `/c ping -n 61 127.0.0.1 >nul & cd /d "$INSTDIR\.." & for /d %D in ("$INSTDIR._stale_*") do rd /s /q "%D"` SW_HIDE

  ; Start Menu application shortcut is now owned by electron-builder's
  ; native MENU_FILENAME flow so Windows search indexing stays aligned with
  ; the registered menu directory.
  DetailPrint "$(installLogStartMenuShortcut)"
  StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

  ; Re-create the desktop shortcut when upgrading.  electron-builder's
  ; createDesktopShortcut only fires on fresh installs; differential
  ; (incremental) updates skip desktop shortcut creation.
  ${if} ${isUpdated}
    DetailPrint "$(installLogDesktopShortcutRebuild)"
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${endIf}

  ; Enable Windows long path support (Windows 10 1607+ / Windows 11).
  ; pnpm virtual store paths can exceed the default MAX_PATH limit of 260 chars.
  ; Writing to HKLM requires admin privileges; on per-user installs without
  ; elevation this call silently fails.
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1

  ; Use PowerShell to update the current user's PATH.
  ; This avoids NSIS string-buffer limits and preserves long PATH values.
  DetailPrint "$(installLogCliPathUpdate)"
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\update-user-path.ps1" "${PROJECT_DIR}\resources\cli\win32\update-user-path.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\update-user-path.ps1" -Action add -CliDir "$INSTDIR\resources\cli"'
  Pop $0
  StrCmp $0 "error" 0 +2
    DetailPrint "$(installLogPathLaunchFailed)"
  StrCmp $0 "timeout" 0 +2
    DetailPrint "$(installLogPathTimeout)"
  StrCmp $0 "0" 0 +2
    Goto _ci_done
  DetailPrint "$(installLogPathExitCode)"

  _ci_done:
  !insertmacro SetInstallPhase "$(installPhaseValidateRuntime)"
  ClearErrors
  InitPluginsDir
  File "/oname=$PLUGINSDIR\run-runtime-validation.ps1" "${PROJECT_DIR}\scripts\run-runtime-validation.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\run-runtime-validation.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  StrCmp $0 "error" 0 +3
    DetailPrint "$(installLogRuntimeValidationLaunchFailed)"
    MessageBox MB_OK|MB_ICONSTOP "$(installRuntimeValidationFailed)"
    Abort
  StrCmp $0 "timeout" 0 +3
    DetailPrint "$(installLogRuntimeValidationTimedOut)"
    MessageBox MB_OK|MB_ICONSTOP "$(installRuntimeValidationFailed)"
    Abort
  StrCmp $0 "0" 0 +4
    DetailPrint "$(installLogRuntimeValidationPassed)"
    Goto _runtime_validation_done
  DetailPrint "$(installLogRuntimeValidationFailedCode)"
  MessageBox MB_OK|MB_ICONSTOP "$(installRuntimeValidationFailed)"
  Abort

  _runtime_validation_done:
  ; Add an explicit Start Menu uninstall shortcut so users have a visible
  ; uninstall entry even when Windows doesn't surface one prominently.
  DetailPrint "$(installLogUninstallShortcut)"
  ${if} $installMode == "all"
    StrCpy $3 "/allusers"
  ${else}
    StrCpy $3 "/currentuser"
  ${endIf}
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\$(uninstallShortcutTitle).lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "$3"

  DetailPrint "$(installLogFinalizeDone)"
!macroend
