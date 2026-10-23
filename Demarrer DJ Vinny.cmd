@echo off
rem Demarre tout DJ Vinny : serveur (si pas deja lance), tunnel vers le VPS (si pas deja lance), puis ouvre le dashboard.
rem Chaque fenetre noire = un morceau (serveur, tunnel). Les fermer arrete ce morceau.
cd /d "%~dp0"
title Demarrage DJ Vinny

netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if errorlevel 1 (
  echo Demarrage du serveur...
  start "Serveur DJ Vinny" cmd /k "cd /d %~dp0 && npm start"
) else (
  echo Serveur deja en marche.
)

tasklist /FI "WINDOWTITLE eq Tunnel DJ Vinny" 2>nul | findstr /I "cmd.exe" >nul
if errorlevel 1 (
  echo Demarrage du tunnel...
  start "Tunnel DJ Vinny" cmd /k "%~dp0deploy\tunnel.cmd"
) else (
  echo Tunnel deja en marche.
)

echo Ouverture du dashboard...
:attente
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto attente
)
start "" "http://127.0.0.1:3000/host"
timeout /t 3 /nobreak >nul
