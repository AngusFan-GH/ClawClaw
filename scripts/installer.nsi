Var newStartMenuLink
Var oldStartMenuLink
Var newDesktopLink
Var oldDesktopLink
Var oldShortcutName
Var oldMenuDirectory

!include "common.nsh"
!include "MUI2.nsh"
!include "multiUser.nsh"
!include "allowOnlyOneInstallerInstance.nsh"
!ifdef BUILD_UNINSTALLER
  !include "${PROJECT_DIR}\scripts\uninstaller.nsh"
!endif

!ifdef BUILD_UNINSTALLER
  !ifmacrodef customUnInstallSection
    !insertmacro MUI_UNPAGE_COMPONENTS
  !endif
!endif

!ifdef INSTALL_MODE_PER_ALL_USERS
  !ifdef BUILD_UNINSTALLER
    RequestExecutionLevel user
  !else
    RequestExecutionLevel admin
  !endif
!else
  RequestExecutionLevel user
!endif

!ifdef BUILD_UNINSTALLER
  SilentInstall silent
!else
  Var appExe
  Var launchLink
!endif

!ifdef ONE_CLICK
  !include "oneClick.nsh"
!else
  !include "assistedInstaller.nsh"
!endif

!insertmacro addLangs

!ifmacrodef customHeader
  !insertmacro customHeader
!endif

Function .onInit
  Call setInstallSectionSpaceRequired

  SetOutPath $INSTDIR
  ${LogSet} on

  !ifmacrodef preInit
    !insertmacro preInit
  !endif

  !ifdef DISPLAY_LANG_SELECTOR
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !ifdef BUILD_UNINSTALLER
    WriteUninstaller "${UNINSTALLER_OUT_FILE}"
    !insertmacro quitSuccess
  !else
    !insertmacro check64BitAndSetRegView

    !ifdef ONE_CLICK
      !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
    !else
      ${IfNot} ${UAC_IsInnerInstance}
        !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
      ${EndIf}
    !endif

    !insertmacro initMultiUser

    !ifmacrodef customInit
      !insertmacro customInit
    !endif

    !ifmacrodef addLicenseFiles
      InitPluginsDir
      !insertmacro addLicenseFiles
    !endif
  !endif
FunctionEnd

!ifndef BUILD_UNINSTALLER
  !include "installUtil.nsh"
  !include "installer.nsh"
!endif

Section "install" INSTALL_SECTION_ID
  !ifndef BUILD_UNINSTALLER
    # If we're running a silent upgrade of a per-machine installation, elevate so extracting the new app will succeed.
    # For a non-silent install, the elevation will be triggered when the install mode is selected in the UI,
    # but that won't be executed when silent.
    !ifndef INSTALL_MODE_PER_ALL_USERS
      !ifndef ONE_CLICK
          ${if} $hasPerMachineInstallation == "1"
          ${andIf} ${Silent}
            ${ifNot} ${UAC_IsAdmin}
              ShowWindow $HWNDPARENT ${SW_HIDE}
              !insertmacro UAC_RunElevated
              ${Switch} $0
                ${Case} 0
                  ${Break}
                ${Case} 1223
                  ${Break}
                ${Default}
                  MessageBox mb_IconStop|mb_TopMost|mb_SetForeground "Unable to elevate, error $0"
                  ${Break}
              ${EndSwitch}
              Quit
            ${else}
              !insertmacro setInstallModePerAllUsers
            ${endIf}
          ${endIf}
      !endif
    !endif

    InitPluginsDir

    ${IfNot} ${Silent}
      SetDetailsPrint both
      DetailPrint "$(installPhasePrepare)"
    ${endif}

    StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

    # must be called before uninstallOldVersion
    !insertmacro setLinkVars

    !ifdef ONE_CLICK
      !ifdef HEADER_ICO
        File /oname=$PLUGINSDIR\installerHeaderico.ico "${HEADER_ICO}"
      !endif
      ${IfNot} ${Silent}
        !ifdef HEADER_ICO
          SpiderBanner::Show /MODERN /ICON "$PLUGINSDIR\installerHeaderico.ico"
        !else
          SpiderBanner::Show /MODERN
        !endif

        FindWindow $0 "#32770" "" $hwndparent
        FindWindow $0 "#32770" "" $hwndparent $0
        GetDlgItem $0 $0 1000
        SendMessage $0 ${WM_SETTEXT} 0 "STR:$(installing)"

        StrCpy $1 $hwndparent
        System::Call 'user32::ShutdownBlockReasonCreate(${SYSTYPE_PTR}r1, w "$(installing)")'
      ${endif}
      !insertmacro CHECK_APP_RUNNING
    !else
      ${ifNot} ${UAC_IsInnerInstance}
        !insertmacro CHECK_APP_RUNNING
      ${endif}
    !endif

    Var /GLOBAL keepShortcuts
    StrCpy $keepShortcuts "false"
    !insertMacro setIsTryToKeepShortcuts
    ${if} $isTryToKeepShortcuts == "true"
      ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts

      ${if} $R1 == "true"
      ${andIf} ${FileExists} "$appExe"
        StrCpy $keepShortcuts "true"
      ${endIf}
    ${endif}

    ${IfNot} ${Silent}
      DetailPrint "$(installPhaseRemovePrevious)"
    ${endif}
    !insertmacro uninstallOldVersion SHELL_CONTEXT
    !insertmacro handleUninstallResult SHELL_CONTEXT

    ${if} $installMode == "all"
      !insertmacro uninstallOldVersion HKEY_CURRENT_USER
      !insertmacro handleUninstallResult HKEY_CURRENT_USER
    ${endIf}

    SetOutPath $INSTDIR

    !ifdef UNINSTALLER_ICON
      File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
    !endif

    ${IfNot} ${Silent}
      DetailPrint "$(installPhaseCopyFiles)"
    ${endif}
    !insertmacro installApplicationFiles

    ${IfNot} ${Silent}
      DetailPrint "$(installPhaseRegister)"
    ${endif}
    !insertmacro registryAddInstallInfo

    ${IfNot} ${Silent}
      DetailPrint "$(installPhaseShortcuts)"
    ${endif}
    !insertmacro addStartMenuLink $keepShortcuts
    !insertmacro addDesktopLink $keepShortcuts

    ${if} ${FileExists} "$newStartMenuLink"
      StrCpy $launchLink "$newStartMenuLink"
    ${else}
      StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${endIf}

    !ifmacrodef registerFileAssociations
      ${IfNot} ${Silent}
        DetailPrint "$(installPhaseAssociations)"
      ${endif}
      !insertmacro registerFileAssociations
    !endif

    !ifmacrodef customInstall
      ${IfNot} ${Silent}
        DetailPrint "$(installPhaseFinalize)"
      ${endif}
      !insertmacro customInstall
    !endif

    !macro doStartApp
      HideWindow
      !insertmacro StartApp
    !macroend

    !ifdef ONE_CLICK
      !ifdef RUN_AFTER_FINISH
        ${ifNot} ${Silent}
        ${orIf} ${isForceRun}
          !insertmacro doStartApp
        ${endIf}
      !else
        ${if} ${isForceRun}
          !insertmacro doStartApp
        ${endIf}
      !endif
      !insertmacro quitSuccess
    !else
      ${if} ${isForceRun}
      ${andIf} ${Silent}
        !insertmacro doStartApp
      ${endIf}
    !endif
  !endif
SectionEnd

Function setInstallSectionSpaceRequired
  !insertmacro setSpaceRequired ${INSTALL_SECTION_ID}
FunctionEnd
