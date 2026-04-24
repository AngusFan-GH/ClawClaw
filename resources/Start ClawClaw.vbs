' ClawClaw Portable Launcher (no console window)
' Double-click this file to start ClawClaw from USB silently.
' For troubleshooting, use "Start ClawClaw.bat" instead (shows console).

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appPath = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = fso.BuildPath(appPath, "ClawClaw.exe")

If fso.FileExists(exePath) Then
    shell.CurrentDirectory = appPath
    shell.Run """" & exePath & """", 1, False
    WScript.Quit 0
Else
    MsgBox "ClawClaw.exe not found in:" & vbLf & appPath, vbCritical, "ClawClaw Portable"
    WScript.Quit 1
End If
