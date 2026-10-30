# Telecharge Node.js (une seule fois) dans outils\node, apres verification de son empreinte SHA-256.
# Lance par Demarrer.vbs quand outils\node\node.exe est absent. ASCII seulement (PowerShell 5 lit mal l'UTF-8 sans BOM).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$version = 'v24.20.0'
$empreinte = '6CAC9FFBCA8F6A47091E4B5C772E0606049C3871CB67D900C0CEDDE630E545BA' # SHASUMS256.txt de nodejs.org
$dest = Join-Path $PSScriptRoot 'outils\node'
$zip = Join-Path $env:TEMP "dj-vinny-node-$version.zip"
$tmp = Join-Path $env:TEMP "dj-vinny-node-$version"
try {
  Write-Host ''
  Write-Host '  DJ Vinny : premier demarrage'
  Write-Host '  Telechargement de Node.js (environ 30 Mo), une seule fois. Patiente...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest "https://nodejs.org/dist/$version/node-$version-win-x64.zip" -OutFile $zip -UseBasicParsing
  if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $empreinte) { throw 'Empreinte invalide : fichier refuse.' }
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip -DestinationPath $tmp -Force
  New-Item -ItemType Directory $dest -Force | Out-Null
  Copy-Item (Join-Path $tmp "node-$version-win-x64\node.exe") $dest -Force
} catch {
  Write-Host ''
  Write-Host "  Echec : $($_.Exception.Message)"
  Start-Sleep -Seconds 6
} finally {
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
