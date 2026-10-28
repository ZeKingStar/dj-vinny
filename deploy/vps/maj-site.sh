#!/bin/bash
# Met à jour la page de vente de djvinny.ca (site/ + djvinny-site.conf, copiés à côté de ce script) : sudo bash maj-site.sh
# Sauvegarde l'ancienne page et l'ancien bloc nginx, teste avec nginx -t, et remet l'ancien en cas d'échec.
set -u
ICI="$(cd "$(dirname "$0")" && pwd)"
CONF=/etc/nginx/sites-enabled/djvinny-site.conf
WEB=/var/www/djvinny.ca
SAUV="/root/djvinny-sauvegarde-$(date +%Y%m%d-%H%M%S)"
[ "$(id -u)" = 0 ] || { echo "À lancer avec sudo"; exit 1; }
[ -f "$ICI/djvinny-site.conf" ] && [ -f "$ICI/site/index.html" ] || { echo "Fichiers manquants à côté du script (site/, djvinny-site.conf)"; exit 1; }
mkdir -p "$SAUV" && cp -a "$WEB" "$SAUV/web" && cp -a "$CONF" "$SAUV/djvinny-site.conf"
cp -r "$ICI/site/." "$WEB/" && chmod -R a+rX "$WEB"
install -m 644 "$ICI/djvinny-site.conf" "$CONF"
if nginx -t 2>/dev/null; then
  systemctl reload nginx && echo "Page djvinny.ca à jour (sauvegarde : $SAUV)"
else
  cp -a "$SAUV/djvinny-site.conf" "$CONF"; rm -rf "$WEB" && cp -a "$SAUV/web" "$WEB"
  nginx -t && echo "ÉCHEC de nginx -t : ancienne page et ancien bloc remis, rien n'a changé"
  exit 1
fi
