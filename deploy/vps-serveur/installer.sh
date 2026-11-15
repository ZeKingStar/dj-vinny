#!/bin/bash
# À lancer sur le VPS avec sudo : sudo bash ~/djvinny-app/deploy/vps-serveur/installer.sh
# Ne touche à aucun autre site : crée seulement /etc/nginx/sites-available/djvinny-fete.
set -e
cd "$(dirname "$0")"
[ -f /home/deploy/djvinny-app/.env ] || { echo "Il manque /home/deploy/djvinny-app/.env"; exit 1; }
install -m 644 djvinny-serveur.service /etc/systemd/system/djvinny-serveur.service
systemctl daemon-reload
systemctl enable --now djvinny-serveur
systemctl restart djvinny-serveur
sleep 2
systemctl is-active djvinny-serveur
curl -s -o /dev/null -w "serveur local : HTTP %{http_code}\n" http://127.0.0.1:3011/

SITE=/etc/nginx/sites-available/djvinny-fete
# Certificat : celui de djvinny.ca s'il couvre *.djvinny.ca, sinon un certificat à part pour fete.djvinny.ca
if openssl x509 -in /etc/letsencrypt/live/djvinny.ca/fullchain.pem -noout -ext subjectAltName 2>/dev/null | grep -q '\*\.djvinny\.ca'; then
  CERT=djvinny.ca
else
  CERT=fete.djvinny.ca
  if [ ! -d /etc/letsencrypt/live/$CERT ]; then
    # vhost provisoire en HTTP seulement pour le défi de certbot
    printf 'server {\n listen 80;\n listen [::]:80;\n server_name fete.djvinny.ca;\n location / { proxy_pass http://127.0.0.1:3011; }\n}\n' > "$SITE"
    ln -sf "$SITE" /etc/nginx/sites-enabled/djvinny-fete
    nginx -t && systemctl reload nginx
    certbot certonly --nginx -d fete.djvinny.ca
  fi
fi
echo "certificat : $CERT"
[ -f "$SITE" ] && cp -a "$SITE" "$SITE.avant"
sed "s/@CERT@/$CERT/g" fete.djvinny.ca.nginx > "$SITE"
ln -sf "$SITE" /etc/nginx/sites-enabled/djvinny-fete
if nginx -t; then systemctl reload nginx; echo "nginx rechargé : https://fete.djvinny.ca"
else rm -f /etc/nginx/sites-enabled/djvinny-fete; echo "nginx -t a échoué, site fete retiré, rien d'autre touché"; exit 1; fi
