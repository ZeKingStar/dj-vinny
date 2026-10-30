' Demarre DJ Vinny sans aucune fenetre : serveur (s'il n'est pas deja lance), puis ouvre le navigateur.
' Utilise le Node du dossier outils ; s'il manque (ZIP leger), le telecharge une fois (installer-node.ps1).
' Au tout premier demarrage, la page de bienvenue cree le fichier de reglages (.env).
' Journal : data\serveur.log (le precedent : data\serveur.old.log).
' Pour arreter : bouton "Fermer DJ Vinny" dans les Reglages du dashboard, ou fermeture automatique a 1 h.
Option Explicit
Dim sh, fs, dossier, i, node
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
dossier = fs.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dossier

Function PortOuvert()
  PortOuvert = (sh.Run("cmd /c netstat -ano | findstr /R /C:"":3000 .*LISTENING"" >nul", 0, True) = 0)
End Function

node = """" & dossier & "\outils\node\node.exe"""

If Not PortOuvert() Then
  ' Premier demarrage du ZIP leger : installer-node.ps1 telecharge Node.js (fenetre visible) et verifie son empreinte
  If Not fs.FileExists(dossier & "\outils\node\node.exe") Then
    sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & dossier & "\installer-node.ps1""", 1, True
    If Not fs.FileExists(dossier & "\outils\node\node.exe") Then
      MsgBox "Node.js n'a pas pu etre telecharge. Verifie ta connexion Internet, puis relance DJ Vinny.", vbExclamation, "DJ Vinny"
      WScript.Quit 1
    End If
  End If
  If Not fs.FolderExists(dossier & "\data") Then fs.CreateFolder dossier & "\data"
  If fs.FileExists(dossier & "\data\serveur.log") Then
    If fs.FileExists(dossier & "\data\serveur.old.log") Then fs.DeleteFile dossier & "\data\serveur.old.log"
    fs.MoveFile dossier & "\data\serveur.log", dossier & "\data\serveur.old.log"
  End If
  sh.Run "cmd /c " & node & " demarrer.js > data\serveur.log 2>&1", 0, False
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
