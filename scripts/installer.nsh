; ${PRODUCT_NAME} Custom NSIS Installer/Uninstaller Script
;
; Install: enables long paths, adds resources\cli to user PATH for openclaw CLI.
; Uninstall: removes the PATH entry and optionally deletes user data.

!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif
!include "nsDialogs.nsh"

Var /GLOBAL uninstDeleteClawData
Var /GLOBAL uninstDeleteOpenClawData
Var /GLOBAL uninstClawDataCheckbox
Var /GLOBAL uninstOpenClawDataCheckbox
Var /GLOBAL uninstCleanupGroup

!macro customUninstallPage
  Page custom un.UninstallDataSelectionPage un.UninstallDataSelectionPageLeave
!macroend

Function un.UninstallDataSelectionPage
  !insertmacro MUI_HEADER_TEXT "Uninstall cleanup options" "Choose what to remove before uninstalling."

  nsDialogs::Create 1018
  Pop $R0
  ${If} $R0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 18u "Uninstall will always remove program files."
  ${NSD_CreateLabel} 0 18u 100% 20u "Select optional user data to remove:"
  ${NSD_CreateGroupBox} 8u 42u 100% 78u "Data cleanup options"
  Pop $uninstCleanupGroup
  ${NSD_CreateCheckbox} 16u 58u 260u 12u "ClawClaw app data (AppData\Local\clawclaw, AppData\Roaming\clawclaw)"
  Pop $uninstClawDataCheckbox
  ${NSD_CreateCheckbox} 16u 74u 220u 12u "OpenClaw data (~\openclaw)"
  Pop $uninstOpenClawDataCheckbox
  ${NSD_CreateLabel} 16u 94u 250u 18u "Tip: keep this unchecked to preserve your OpenClaw workspace for reinstall."

  StrCpy $uninstDeleteClawData "0"
  StrCpy $uninstDeleteOpenClawData "0"
  ${NSD_SetState} $uninstClawDataCheckbox 0
  ${NSD_SetState} $uninstOpenClawDataCheckbox 0

  nsDialogs::Show
FunctionEnd

Function un.UninstallDataSelectionPageLeave
  ${NSD_GetState} $uninstClawDataCheckbox $R0
  ${If} $R0 == 1
    StrCpy $uninstDeleteClawData "1"
  ${EndIf}

  ${NSD_GetState} $uninstOpenClawDataCheckbox $R0
  ${If} $R0 == 1
    StrCpy $uninstDeleteOpenClawData "1"
  ${EndIf}

  ${If} $uninstDeleteClawData == "1"
    RMDir /r "$LOCALAPPDATA\clawclaw"
    RMDir /r "$APPDATA\clawclaw"

    StrCpy $R0 0

  _cu_enumClawLoop:
    EnumRegKey $R1 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList" $R0
    StrCmp $R1 "" _cu_clawEnumDone

    ReadRegStr $R2 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$R1" "ProfileImagePath"
    StrCmp $R2 "" _cu_clawEnumNext
    ExpandEnvStrings $R2 $R2
    RMDir /r "$R2\AppData\Local\clawclaw"
    RMDir /r "$R2\AppData\Roaming\clawclaw"

  _cu_clawEnumNext:
    IntOp $R0 $R0 + 1
    Goto _cu_enumClawLoop

  _cu_clawEnumDone:
  ${EndIf}

  ${If} $uninstDeleteOpenClawData == "1"
    RMDir /r "$PROFILE\.openclaw"

    StrCpy $R0 0

  _cu_enumOpenClawLoop:
    EnumRegKey $R1 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList" $R0
    StrCmp $R1 "" _cu_openClawEnumDone

    ReadRegStr $R2 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$R1" "ProfileImagePath"
    StrCmp $R2 "" _cu_openClawEnumNext
    ExpandEnvStrings $R2 $R2
    RMDir /r "$R2\.openclaw"

  _cu_openClawEnumNext:
    IntOp $R0 $R0 + 1
    Goto _cu_enumOpenClawLoop

  _cu_openClawEnumDone:
  ${EndIf}
FunctionEnd

!macro customWelcomePage
  ; customWelcomePage is expanded at compile-time in assistedInstaller.nsh.
  ; Use MUI welcome-page defines/macros here, not runtime UI commands.
  !define MUI_WELCOMEPAGE_TITLE "Welcome to ${PRODUCT_NAME}"
  !define MUI_WELCOMEPAGE_TEXT "Your desktop AI copilot by xzinfra"
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
  ShowInstDetails show
  DetailPrint "Configuring ${PRODUCT_NAME} for first launch..."

  ; Enable Windows long path support (Windows 10 1607+ / Windows 11).
  ; pnpm virtual store paths can exceed the default MAX_PATH limit of 260 chars.
  ; Writing to HKLM requires admin privileges; on per-user installs without
  ; elevation this call silently fails.
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1

  ; Use PowerShell to update the current user's PATH.
  ; This avoids NSIS string-buffer limits and preserves long PATH values.
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
!macroend

!macro customUnInstall
  ShowUnInstDetails show
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
!macroend
