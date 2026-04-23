; Shadowed upstream template: app-builder-lib/templates/nsis/installSection.nsh
; Keep install-flow behavior here so scripts/installer.nsi can remain a thin
; wrapper over the upstream template.

!include "${PROJECT_DIR}\scripts\installerInclude.nsh"

InitPluginsDir

${IfNot} ${Silent}
  !insertmacro SetInstallPhase "$(installPhasePrepare)"
  !insertmacro SetInstallPhase "$(installPhaseCheckRunning)"
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
  !insertmacro SetInstallPhase "$(installPhaseRemovePrevious)"
${endif}
!insertmacro ResolveUpgradeStrategy
!insertmacro ResolveInstalledVersionCompatibility
!insertmacro RunManagedUpgradeCleanup
${if} $shouldRunLegacyUninstaller == "false"
  ${IfNot} ${Silent}
    DetailPrint "Using in-place upgrade for the current install scope and directory; skipping the legacy uninstaller."
  ${endif}
${else}
  !insertmacro uninstallOldVersion SHELL_CONTEXT
  !insertmacro handleUninstallResult SHELL_CONTEXT

  ${if} $installMode == "all"
    ; The current-user uninstall can relaunch or leave behind helper processes,
    ; so repeat managed cleanup before checking the other install scope.
    !insertmacro RunManagedUpgradeCleanup
    !insertmacro uninstallOldVersion HKEY_CURRENT_USER
    !insertmacro handleUninstallResult HKEY_CURRENT_USER
  ${endIf}
${endif}

; NSIS upgrades (including differential package updates) can leave stale files
; inside extraResources when the target directory already exists. ClawClaw
; ships a managed OpenClaw runtime tree and bundled plugin mirrors under
; resources\, so old nested dependencies must be removed before the new files
; are copied.
${IfNot} ${Silent}
  !insertmacro SetInstallPhase "$(installPhaseCleanRuntime)"
${endif}
${if} $isLegacyInstalledVersion == "true"
  ${IfNot} ${Silent}
    DetailPrint "Detected an installed ClawClaw version at or below 0.1.15; running expanded runtime cleanup."
  ${endif}
${endif}
RMDir /r "$INSTDIR\resources\openclaw"
${IfNot} ${Silent}
  DetailPrint "Removed stale runtime directory: $INSTDIR\resources\openclaw"
${endif}
RMDir /r "$INSTDIR\resources\openclaw-plugins"
${IfNot} ${Silent}
  DetailPrint "Removed stale plugin mirror directory: $INSTDIR\resources\openclaw-plugins"
${endif}
${if} $isLegacyInstalledVersion == "true"
  RMDir /r "$INSTDIR\resources\bin"
  ${IfNot} ${Silent}
    DetailPrint "Removed legacy bundled binary directory: $INSTDIR\resources\bin"
  ${endif}
  RMDir /r "$INSTDIR\resources\cli"
  ${IfNot} ${Silent}
    DetailPrint "Removed legacy CLI wrapper directory: $INSTDIR\resources\cli"
  ${endif}
${endif}

SetOutPath $INSTDIR

!ifdef UNINSTALLER_ICON
  File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
!endif

${IfNot} ${Silent}
  !insertmacro SetInstallPhase "$(installPhaseCopyFiles)"
${endif}
!insertmacro installApplicationFiles

${IfNot} ${Silent}
  !insertmacro SetInstallPhase "$(installPhaseRegister)"
${endif}
!insertmacro registryAddInstallInfo

${IfNot} ${Silent}
  !insertmacro SetInstallPhase "$(installPhaseShortcuts)"
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
    !insertmacro SetInstallPhase "$(installPhaseAssociations)"
  ${endif}
  !insertmacro registerFileAssociations
!endif

!ifmacrodef customInstall
  !insertmacro customInstall
!endif

!macro doStartApp
  # otherwise app window will be in background
  HideWindow
  !insertmacro StartApp
!macroend

!ifdef ONE_CLICK
  # https://github.com/electron-userland/electron-builder/pull/3093#issuecomment-403734568
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
  # for assisted installer run only if silent, because assisted installer has run after finish option
  ${if} ${isForceRun}
  ${andIf} ${Silent}
    !insertmacro doStartApp
  ${endIf}
!endif
