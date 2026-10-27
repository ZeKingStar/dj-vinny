@echo off
rem Ancien point d'entree, garde pour les raccourcis existants : tout passe par Demarrer.vbs (aucune fenetre).
rem Pour ne meme plus voir ce bref eclair, faire pointer le raccourci vers Demarrer.vbs.
start "" wscript "%~dp0Demarrer.vbs"
