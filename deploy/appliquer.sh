#!/bin/bash
# À lancer avec : sudo bash ~/appliquer.sh
# Met à jour SEULEMENT les réglages de djvinny.korvia.ca (limites de taille et de débit).
# Ne touche ni au fichier du site (certificat HTTPS) ni aux autres sites. Teste avant de recharger ;
# si le test échoue, remet les anciens fichiers et ne recharge rien.
if [ "$(id -u)" -ne 0 ]; then echo "Lance-moi avec sudo : sudo bash ~/appliquer.sh"; exit 1; fi
SRC=/home/deploy
for f in djvinny-proxy.conf djvinny-limits.conf; do [ -f "$SRC/$f" ] || { echo "Fichier manquant : $SRC/$f"; exit 1; }; done

SAUV=/root/djvinny-sauvegarde-$(date +%Y%m%d-%H%M%S)
mkdir -p "$SAUV"
[ -f /etc/nginx/djvinny-proxy.conf ] && cp -a /etc/nginx/djvinny-proxy.conf "$SAUV/"
[ -f /etc/nginx/conf.d/djvinny-limits.conf ] && cp -a /etc/nginx/conf.d/djvinny-limits.conf "$SAUV/"

install -m 644 -o root -g root "$SRC/djvinny-proxy.conf"  /etc/nginx/djvinny-proxy.conf
install -m 644 -o root -g root "$SRC/djvinny-limits.conf" /etc/nginx/conf.d/djvinny-limits.conf

if nginx -t; then
  systemctl reload nginx && echo "OK : nginx rechargé. Sauvegarde des anciens fichiers : $SAUV"
else
  echo "ÉCHEC du test nginx : je remets les anciens fichiers."
  if [ -f "$SAUV/djvinny-proxy.conf" ]; then cp -a "$SAUV/djvinny-proxy.conf" /etc/nginx/djvinny-proxy.conf; fi
  if [ -f "$SAUV/djvinny-limits.conf" ]; then cp -a "$SAUV/djvinny-limits.conf" /etc/nginx/conf.d/djvinny-limits.conf; else rm -f /etc/nginx/conf.d/djvinny-limits.conf; fi
  nginx -t && echo "Anciens fichiers remis, nginx inchangé."
  exit 1
fi
