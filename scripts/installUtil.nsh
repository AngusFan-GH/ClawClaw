; Shadowed upstream template: app-builder-lib/templates/nsis/include/installUtil.nsh
; Keep the upstream helpers intact except for legacy-uninstall handling, which
; is routed through ClawClaw's own process cleanup scripts to avoid upstream's
; generic "cannot be closed" dialog during upgrades.

!macro moveFile FROM TO
  ClearErrors
  Rename `${FROM}` `${TO}`
  ${if} ${errors}
    ClearErrors
    !insertmacro copyFile `${FROM}` `${TO}`
    Delete `${FROM}`
  ${endif}
!macroend

!macro copyFile FROM TO
  ${StdUtils.GetParentPath} $R5 `${TO}`
  CreateDirectory `$R5`
  ClearErrors
  CopyFiles /SILENT `${FROM}` `${TO}`
!macroend

Function GetInQuotes
  Exch $R0
  Push $R1
  Push $R2
  Push $R3

   StrCpy $R2 -1
   IntOp $R2 $R2 + 1
    StrCpy $R3 $R0 1 $R2
    StrCmp $R3 "" 0 +3
     StrCpy $R0 ""
     Goto Done
    StrCmp $R3 '"' 0 -5

   IntOp $R2 $R2 + 1
   StrCpy $R0 $R0 "" $R2

   StrCpy $R2 0
   IntOp $R2 $R2 + 1
    StrCpy $R3 $R0 1 $R2
    StrCmp $R3 "" 0 +3
     StrCpy $R0 ""
     Goto Done
    StrCmp $R3 '"' 0 -5

   StrCpy $R0 $R0 $R2
   Done:

  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

!macro GetInQuotes Var Str
  Push "${Str}"
  Call GetInQuotes
  Pop "${Var}"
!macroend

Function GetFileParent
  Exch $R0
  Push $R1
  Push $R2
  Push $R3

  StrCpy $R1 0
  StrLen $R2 $R0

  loop:
    IntOp $R1 $R1 + 1
    IntCmp $R1 $R2 get 0 get
    StrCpy $R3 $R0 1 -$R1
    StrCmp $R3 "\" get
  Goto loop

  get:
    StrCpy $R0 $R0 -$R1

    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
FunctionEnd

Var /GLOBAL isTryToKeepShortcuts

!macro setIsTryToKeepShortcuts
  StrCpy $isTryToKeepShortcuts "true"
  !ifdef allowToChangeInstallationDirectory
    ${ifNot} ${isUpdated}
      StrCpy $isTryToKeepShortcuts "false"
    ${endIf}
  !endif
!macroend

!macro readReg VAR ROOT_KEY SUB_KEY NAME
  ${if} "${ROOT_KEY}" == "SHELL_CONTEXT"
    ReadRegStr "${VAR}" SHELL_CONTEXT "${SUB_KEY}" "${NAME}"
  ${elseif} "${ROOT_KEY}" == "HKEY_CURRENT_USER"
    ReadRegStr "${VAR}" HKEY_CURRENT_USER "${SUB_KEY}" "${NAME}"
  ${elseif} "${ROOT_KEY}" == "HKEY_LOCAL_MACHINE"
    ReadRegStr "${VAR}" HKEY_LOCAL_MACHINE "${SUB_KEY}" "${NAME}"
  ${else}
    MessageBox MB_OK "Unsupported ${ROOT_KEY}"
  ${endif}
!macroend

Function handleUninstallResult
  Var /GLOBAL rootKey_uninstallResult
  Exch $rootKey_uninstallResult

  ${if} "$rootKey_uninstallResult" == "SHELL_CONTEXT"
    !ifmacrodef customUnInstallCheck
      !insertmacro customUnInstallCheck
      Return
    !endif
  ${elseif} "$rootKey_uninstallResult" == "HKEY_CURRENT_USER"
    !ifmacrodef customUnInstallCheckCurrentUser
      !insertmacro customUnInstallCheckCurrentUser
      Return
    !endif
  ${endif}

  IfErrors 0 +3
  DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  Return

  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endif}
FunctionEnd

!macro handleUninstallResult ROOT_KEY
  Push "${ROOT_KEY}"
  Call handleUninstallResult
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

!macro LegacyDetectInstallDirLocks INSTALL_DIR RESULT_VAR OUTPUT_VAR
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\check-install-dir-locks.ps1" "${PROJECT_DIR}\scripts\check-install-dir-locks.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\check-install-dir-locks.ps1" -InstallDir "${INSTALL_DIR}"'
  Pop "${RESULT_VAR}"
  Pop "${OUTPUT_VAR}"
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

Function uninstallOldVersion
  Var /GLOBAL uninstallerFileName
  Var /GLOBAL uninstallerFileNameTemp
  Var /GLOBAL installationDir
  Var /GLOBAL uninstallString
  Var /GLOBAL rootKey

  ClearErrors
  Exch $rootKey

  Push 0
  Pop $R0

  !insertmacro readReg $uninstallString "$rootKey" "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${if} $uninstallString == ""
    !ifdef UNINSTALL_REGISTRY_KEY_2
      !insertmacro readReg $uninstallString "$rootKey" "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    !endif
    ${if} $uninstallString == ""
      ClearErrors
      Return
    ${endif}
  ${endif}

  !insertmacro GetInQuotes $uninstallerFileName "$uninstallString"

  !insertmacro readReg $installationDir "$rootKey" "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $installationDir == ""
  ${andIf} $uninstallerFileName != ""
    Push $uninstallerFileName
    Call GetFileParent
    Pop $installationDir
  ${endif}

  ${if} $installationDir == ""
  ${andIf} $uninstallerFileName == ""
    ClearErrors
    Return
  ${endif}

  ${if} $installMode == "CurrentUser"
  ${orIf} $rootKey == "HKEY_CURRENT_USER"
    StrCpy $0 "/currentuser"
  ${else}
    StrCpy $0 "/allusers"
  ${endif}

  !insertmacro setIsTryToKeepShortcuts

  ${if} $isTryToKeepShortcuts == "true"
    !insertmacro readReg $R5 "$rootKey" "${INSTALL_REGISTRY_KEY}" KeepShortcuts
    ${if} $R5 == "true"
    ${andIf} ${FileExists} "$appExe"
      StrCpy $0 "$0 --keep-shortcuts"
    ${endIf}
  ${endIf}

  ${if} ${isDeleteAppData}
    StrCpy $0 "$0 --delete-app-data"
  ${else}
    StrCpy $0 "$0 --updated"
  ${endif}

  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\old-uninstaller.exe"
  !insertmacro copyFile "$uninstallerFileName" "$uninstallerFileNameTemp"

  StrCpy $R5 0

  UninstallLoop:
    IntOp $R5 $R5 + 1

    ${if} $installationDir != ""
      !insertmacro LegacyManagedCleanup "$installationDir"
      Sleep 1500
      !insertmacro LegacyDetectInstallDirLocks "$installationDir" $R8 $R9
      ${if} $R8 == 2
        DetailPrint `Legacy uninstall still sees locked files in "$installationDir": $R9`
      ${endif}
    ${endif}

    ExecWait '"$uninstallerFileNameTemp" /S /KEEP_APP_DATA $0 _?=$installationDir' $R0
    ifErrors TryInPlace CheckResult

    TryInPlace:
      ExecWait '"$uninstallerFileName" /S /KEEP_APP_DATA $0 _?=$installationDir' $R0
      ifErrors DoesNotExist

    CheckResult:
      ${if} $R0 == 0
        Return
      ${endif}

    ${if} $installationDir != ""
      !insertmacro LegacyManagedCleanup "$installationDir"
      !insertmacro LegacyDetectInstallDirLocks "$installationDir" $R8 $R9
      ${if} $R8 == 2
        DetailPrint `Legacy uninstall remains blocked by files in use: $R9`
      ${endif}
    ${endif}

    ${if} $R5 > 5
      DetailPrint `Silent uninstall could not complete after repeated attempts. Leaving control to ClawClaw's custom upgrade fallback.`
      Return
    ${endif}

    Sleep 1000
    Goto UninstallLoop

  DoesNotExist:
    SetErrors
FunctionEnd

!macro uninstallOldVersion ROOT_KEY
  Push "${ROOT_KEY}"
  Call uninstallOldVersion
!macroend
