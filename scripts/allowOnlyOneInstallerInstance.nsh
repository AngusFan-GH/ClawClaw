; Shadowed upstream template: app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh
; Force CHECK_APP_RUNNING to use ClawClaw's custom pre-upgrade cleanup rather
; than electron-builder's generic process-name heuristics and popup path.

!ifndef nsProcess::FindProcess
    !include "nsProcess.nsh"
!endif

# http://nsis.sourceforge.net/Allow_only_one_installer_instance
!macro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
  BringToFront
  !define /ifndef SYSTYPE_PTR p
  System::Call 'kernel32::CreateMutex(${SYSTYPE_PTR}0, i1, t"${APP_GUID}")?e'
  Pop $0
  IntCmpU $0 183 0 launch launch
    StrLen $0 "$(^SetupCaption)"
    IntOp $0 $0 + 1
    StrCpy $1 ""
    loop:
      FindWindow $1 "#32770" "" "" $1
      StrCmp 0 $1 notfound
      System::Call 'user32::GetWindowText(${SYSTYPE_PTR}r1, t.r2, ir0)'
      StrCmp $2 "$(^SetupCaption)" 0 loop
      SendMessage $1 0x112 0xF120 0 /TIMEOUT=2000
      System::Call "user32::SetForegroundWindow(${SYSTYPE_PTR}r1)"
    notfound:
      Abort
  launch:
!macroend

!macro CHECK_APP_RUNNING
  !insertmacro customCheckAppRunning
!macroend
