; ${PRODUCT_NAME} Custom NSIS Installer/Uninstaller Script
;
; Install: enables long paths, adds resources\cli to user PATH for openclaw CLI.
; Uninstall: removes the PATH entry and optionally deletes user data.

; Add scripts dir to include search path so our patched installSection.nsh
; (which sets SetDetailsPrint both instead of none) is found before
; electron-builder's templates version.
!addincludedir "${PROJECT_DIR}\scripts"
!include "WordFunc.nsh"

!define MUI_INSTFILESPAGE_SHOWDETAILS show
!define MUI_UNINSTFILESPAGE_SHOWDETAILS show

ShowInstDetails show
ShowUnInstDetails show

Var /GLOBAL shouldRunLegacyUninstaller
Var /GLOBAL isLegacyInstalledVersion

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
  FunctionEnd

  Function customInstFilesShow-custom
    ; Use the native MUI "show details" mode only. Manually clicking the
    ; built-in toggle can leave the details control visible but detached from
    ; the actual installer output on some Windows builds.
    SetDetailsPrint both
    DetailPrint "$(installPhasePrepare)"
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
LangString installRuntimeValidationFailed 1033 "The bundled OpenClaw runtime failed validation after installation.$\r$\n$\r$\nPlease run this installer again or contact support."
LangString installRuntimeValidationFailed 2052 "安装完成后，内置 OpenClaw 运行时校验失败。$\r$\n$\r$\n请重新运行安装包，或联系支持。"
LangString installFilesLocked 1033 "Files from the previous installation are still in use.$\r$\n$\r$\nClose the related ClawClaw or runtime process, then click Retry."
LangString installFilesLocked 2052 "旧版本安装中的文件仍被占用。$\r$\n$\r$\n请关闭相关的 ClawClaw 或运行时进程，然后单击“重试”。"

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
  !insertmacro KillInstallDirProcesses
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\run-gateway-cmd.ps1" "${PROJECT_DIR}\scripts\run-gateway-cmd.ps1"
  ${If} ${FileExists} "$INSTDIR\resources\cli\openclaw.cmd"
    DetailPrint "$(installPhaseStopGateway)"
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\run-gateway-cmd.ps1" -InstallDir "$INSTDIR" -Command "gateway stop"'
    Pop $R6
    Pop $R7
    DetailPrint "$(installPhaseUninstallGatewayService)"
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\run-gateway-cmd.ps1" -InstallDir "$INSTDIR" -Command "gateway uninstall"'
    Pop $R6
    Pop $R7
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
    DetailPrint "$(installPhaseClosingRunning)"
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
          DetailPrint "$(installPhaseWaitRunning)"
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

!macro FallbackInteractiveOldUninstall
  ${If} ${isUpdated}
  ${andIf} $R0 != 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "The installed ClawClaw version could not be removed silently.$\r$\n$\r$\nClawClaw will now open the old uninstaller. Complete that uninstall, then setup will continue automatically." \
      /SD IDCANCEL IDOK +2
    Abort

    DetailPrint `Silent uninstall failed with code $R0. Falling back to interactive old uninstaller.`
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
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro FallbackInteractiveOldUninstall
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro FallbackInteractiveOldUninstall
!macroend

!macro customInstall
  ; Keep detail output fully enabled so the status line and details pane stay
  ; in sync during post-install steps.
  SetDetailsPrint both
  DetailPrint "正在完成安装后的系统配置..."

  ; Always normalize Start Menu entries into a single folder.  electron-builder's
  ; default shortcut creation can leave the app shortcut at
  ; "$SMPROGRAMS\${PRODUCT_NAME}.lnk", while our custom uninstall shortcut lives in
  ; "$SMPROGRAMS\${PRODUCT_NAME}\".  On some Windows installs this causes Start Menu
  ; results to surface only the uninstall entry.  We explicitly recreate the app
  ; shortcut in the product folder on every install and remove the legacy flat link.
  DetailPrint "正在创建开始菜单快捷方式..."
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  StrCpy $launchLink "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"

  ; Re-create the desktop shortcut when upgrading.  electron-builder's
  ; createDesktopShortcut only fires on fresh installs; differential
  ; (incremental) updates skip desktop shortcut creation.
  ${if} ${isUpdated}
    DetailPrint "正在重建快捷方式..."
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${endIf}

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
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\update-user-path.ps1" -Action add -CliDir "$INSTDIR\resources\cli"'
  Pop $0
  Pop $1
  StrCmp $0 "error" 0 +2
    DetailPrint "Warning: Failed to launch PowerShell while updating PATH entry."
  StrCmp $0 "timeout" 0 +2
    DetailPrint "Warning: PowerShell PATH update timed out."
  StrCmp $0 "0" 0 +2
    Goto _ci_done
  DetailPrint "Warning: PowerShell PATH update exited with code $0."

  _ci_done:
  DetailPrint "$(installPhaseValidateRuntime)"
  ClearErrors
  InitPluginsDir
  File "/oname=$PLUGINSDIR\run-runtime-validation.ps1" "${PROJECT_DIR}\scripts\run-runtime-validation.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\run-runtime-validation.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  Pop $1
  StrCmp $0 "error" 0 +3
    MessageBox MB_OK|MB_ICONSTOP "$(installRuntimeValidationFailed)"
    Abort
  StrCmp $0 "timeout" 0 +3
    MessageBox MB_OK|MB_ICONSTOP "$(installRuntimeValidationFailed)"
    Abort
  StrCmp $0 "0" 0 +4
    DetailPrint "OpenClaw runtime validation passed."
    Goto _runtime_validation_done
  DetailPrint "Bundled runtime validation failed: $1"
  MessageBox MB_OK|MB_ICONSTOP "$(installRuntimeValidationFailed)"
  Abort

  _runtime_validation_done:
  ; Add an explicit Start Menu uninstall shortcut so users have a visible
  ; uninstall entry even when Windows doesn't surface one prominently.
  DetailPrint "正在创建卸载快捷方式..."
  ${if} $installMode == "all"
    StrCpy $3 "/allusers"
  ${else}
    StrCpy $3 "/currentuser"
  ${endIf}
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "$3"

  DetailPrint "安装后的系统配置已完成。"
!macroend
