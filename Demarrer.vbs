' Demarre DJ Vinny sans aucune fenetre : serveur (s'il n'est pas deja lance), puis ouvre le dashboard.
' Le serveur lance lui-meme le tunnel (reglage TUNNEL). Journal : data\serveur.log (le precedent : data\serveur.old.log).
' Pour arreter : bouton "Fermer DJ Vinny" dans les Reglages du dashboard, ou fermeture automatique a 1 h.
Option Explicit
Dim sh, fs, dossier, i
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
dossier = fs.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dossier

Function PortOuvert()
  PortOuvert = (sh.Run("cmd /c netstat -ano | findstr /R /C:"":3000 .*LISTENING"" >nul", 0, True) = 0)
End Function

If Not PortOuvert() Then
  If Not fs.FolderExists(dossier & "\data") Then fs.CreateFolder dossier & "\data"
  If fs.FileExists(dossier & "\data\serveur.log") Then
    If fs.FileExists(dossier & "\data\serveur.old.log") Then fs.DeleteFile dossier & "\data\serveur.old.log"
    fs.MoveFile dossier & "\data\serveur.log", dossier & "\data\serveur.old.log"
  End If
  sh.Run "cmd /c npm start > data\serveur.log 2>&1", 0, False
  For i = 1 To 60 ' jusqu'a 30 s
    If PortOuvert() Then Exit For
    WScript.Sleep 500
  Next
  If Not PortOuvert() Then
    MsgBox "DJ Vinny n'a pas demarre. Details : " & dossier & "\data\serveur.log", vbExclamation, "DJ Vinny"
    WScript.Quit 1
  End If
End If
sh.Run "http://127.0.0.1:3000/host"
