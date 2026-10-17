@echo off
rem Tunnel inverse laptop -> VPS : https://djvinny.korvia.ca -> ce serveur (port 3000)
rem Se relance tout seul si la connexion tombe. Fermer la fenetre pour arreter.
rem known_hosts (dans ce dossier) contient l'empreinte du VPS : aucune question a l'ecran.
title Tunnel DJ Vinny
:boucle
echo [%time%] Connexion au VPS...
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=%~dp0known_hosts" -R 127.0.0.1:3010:127.0.0.1:3000 deploy@5.78.177.164
echo [%time%] Tunnel coupe, nouvel essai dans 5 secondes...
timeout /t 5 /nobreak >nul
goto boucle
