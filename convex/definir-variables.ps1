# Copie les clés du .env vers les variables d'environnement de Convex, sans jamais afficher une valeur.
#   .\convex\definir-variables.ps1            -> déploiement de développement (staging) + clés Stripe en mode test
#   .\convex\definir-variables.ps1 -Prod      -> déploiement de production (clés Stripe en mode réel)
# Lance-le depuis le dossier du projet (celui qui contient convex\ et .env).
param([switch]$Prod, [string]$Env = ".env")
$requises = "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_SOIREE", "STRIPE_PRICE_ABONNEMENT", "BREVO_API_KEY"
if (-not (Test-Path $Env)) { Write-Host "Fichier introuvable : $Env"; exit 1 }
$vars = @{}
foreach ($l in Get-Content $Env) {
  if ($l -cmatch '^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$') { $vars[$Matches[1]] = $Matches[2].Trim('"').Trim("'") }
}
$manque = $requises | Where-Object { -not $vars[$_] }
if ($manque) {
  Write-Host "Manquent dans $Env :" ($manque -join ", ")
  Write-Host "Noms présents (sans les valeurs) :" (($vars.Keys | Sort-Object) -join ", ")
  exit 1
}
$cible = if ($Prod) { "--prod" } else { $null }
foreach ($n in ($requises + ("STRIPE_COUPON_ESSAI" | Where-Object { $vars[$_] }))) {
  if ($cible) { npx convex env set $cible $n $vars[$n] | Out-Null } else { npx convex env set $n $vars[$n] | Out-Null }
  Write-Host "OK $n"
}
