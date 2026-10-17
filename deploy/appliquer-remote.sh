#!/bin/bash
# À lancer avec : sudo bash ~/appliquer-remote.sh
# Ouvre la télécommande (/remote) sur djvinny.korvia.ca, protégée par le mot de passe hôte.
# Sauvegarde le fichier du site, teste nginx avant de recharger, et remet l'ancien fichier si le test échoue.
if [ "$(id -u)" -ne 0 ]; then echo "Lance-moi avec sudo : sudo bash ~/appliquer-remote.sh"; exit 1; fi
SRC=/home/deploy
SITE=/etc/nginx/sites-available/djvinny
LIM=/etc/nginx/conf.d/djvinny-limits.conf
for f in djvinny-limits.conf patch-remote.py; do [ -f "$SRC/$f" ] || { echo "Fichier manquant : $SRC/$f"; exit 1; }; done
[ -f "$SITE" ] || { echo "Site introuvable : $SITE"; exit 1; }

SAUV=/root/djvinny-remote-sauvegarde-$(date +%Y%m%d-%H%M%S)
mkdir -p "$SAUV"
cp -a "$SITE" "$SAUV/djvinny.site"
cp -a "$LIM" "$SAUV/djvinny-limits.conf" 2>/dev/null

install -m 644 -o root -g root "$SRC/djvinny-limits.conf" "$LIM"
if ! python3 "$SRC/patch-remote.py" "$SITE"; then
  echo "Le site n'a pas été modifié. Je remets la config des limites."
  if [ -f "$SAUV/djvinny-limits.conf" ]; then cp -a "$SAUV/djvinny-limits.conf" "$LIM"; fi
  exit 1
fi

if nginx -t; then
  systemctl reload nginx && echo "OK : /remote est ouverte (mot de passe hôte exigé). Sauvegarde : $SAUV"
else
  echo "ÉCHEC du test nginx : je remets les anciens fichiers."
  cp -a "$SAUV/djvinny.site" "$SITE"
  if [ -f "$SAUV/djvinny-limits.conf" ]; then cp -a "$SAUV/djvinny-limits.conf" "$LIM"; fi
  nginx -t && echo "Anciens fichiers remis, nginx inchangé."
  exit 1
fi
