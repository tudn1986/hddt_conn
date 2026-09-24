Option Explicit
Dim shell, fso, baseDir, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Intentionally start the CMD window as VISIBLE.
' HDDT-Tray.ps1 will hide that same console only after HDDT is healthy.
command = "cmd.exe /c " & Chr(34) & baseDir & "\Start-HDDT.cmd" & Chr(34)
shell.Run command, 1, False
