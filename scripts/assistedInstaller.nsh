!include UAC.nsh

; ClawClaw intentionally uses a per-user assisted NSIS installer.
; electron-builder's default assisted template shows an install-mode page
; ("all users" vs "current user") when oneClick=false and perMachine=false.
; The all-users path is not a good fit for this app because the bundled
; OpenClaw CLI, credentials, Gateway data, and PATH updates are user-scoped.
; Keeping one mode avoids split permissions and broken per-machine installs
; while preserving the directory picker and uninstall data options.

!ifndef BUILD_UNINSTALLER
  !include StrContains.nsh

  !ifmacrodef customWelcomePage
    !insertmacro customWelcomePage
  !endif

  !ifmacrodef licensePage
    !insertmacro skipPageIfUpdated
    !insertmacro licensePage
  !endif

  !ifdef allowToChangeInstallationDirectory
    !insertmacro skipPageIfUpdated
    !insertmacro MUI_PAGE_DIRECTORY

    ; pageDirectory leave doesn't work reliably because $INSTDIR is set
    ; after custom leave functions. Use instfiles pre instead.
    !define MUI_PAGE_CUSTOMFUNCTION_PRE instFilesPre

    Function instFilesPre
      ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
      ${If} $0 == ""
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${endIf}
    FunctionEnd
  !endif

  !ifmacrodef customPageAfterChangeDir
    !insertmacro customPageAfterChangeDir
  !endif

  !insertmacro MUI_PAGE_INSTFILES
  !ifmacrodef customFinishPage
    !insertmacro customFinishPage
  !else
    !ifndef HIDE_RUN_AFTER_FINISH
      Function StartApp
        ${if} ${isUpdated}
          StrCpy $1 "--updated"
        ${else}
          StrCpy $1 ""
        ${endif}
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
      FunctionEnd

      !define MUI_FINISHPAGE_RUN
      !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
    !endif
    !insertmacro MUI_PAGE_FINISH
  !endif
!else
  !ifndef removeDefaultUninstallWelcomePage
    !ifmacrodef customUnWelcomePage
      !insertmacro customUnWelcomePage
    !else
      !insertmacro MUI_UNPAGE_WELCOME
    !endif
  !endif

  !insertmacro MUI_UNPAGE_INSTFILES
  !ifmacrodef customUninstallPage
    !insertmacro customUninstallPage
  !endif
  !insertmacro MUI_UNPAGE_FINISH
!endif

!macro initMultiUser
  ; Force current-user mode for both install and uninstall. This keeps the
  ; registry hive, shortcuts, CLI PATH, and OpenClaw data ownership consistent.
  !ifdef BUILD_UNINSTALLER
    ; Hidden compatibility path for uninstall entries created by older
    ; per-machine builds. The current installer never shows an install-mode
    ; picker, but an old Windows uninstall entry may still pass /allusers.
    ${GetParameters} $R0
    ${GetOptions} $R0 "/allusers" $R1
    ${IfNot} ${Errors}
      !insertmacro setInstallModePerAllUsers
    ${Else}
      !insertmacro setInstallModePerUser
    ${EndIf}
  !else
    ; Older experimental installers could leave literal ${productName}
    ; paths in HKCU. setInstallModePerUser reads InstallLocation, so clean
    ; those broken values before it decides $INSTDIR.
    ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${StrContains} $R1 "$${productName}" $R0
    ${If} $R1 != ""
      DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
    ${EndIf}

    ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${StrContains} $R1 "$${productName}" $R0
    ${If} $R1 != ""
      DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
    ${EndIf}

    !ifdef UNINSTALL_REGISTRY_KEY_2
      ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
      ${StrContains} $R1 "$${productName}" $R0
      ${If} $R1 != ""
        DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY_2}"
      ${EndIf}
    !endif

    !insertmacro setInstallModePerUser
    StrCpy $hasPerMachineInstallation "0"
    StrCpy $hasPerUserInstallation "1"
  !endif
!macroend
