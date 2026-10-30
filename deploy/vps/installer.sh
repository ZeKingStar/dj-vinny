#!/bin/bash
# Installe la passerelle des clients DJ Vinny (étape 6). À lancer sur le VPS, depuis le dossier de ces fichiers :
#   sudo bash installer.sh
# Ne touche ni à djvinny.korvia.ca ni aux autres sites : nginx n'est modifié que par djvinny-sync.py, plus tard,
# qui écrit son propre fichier (sites-enabled/djvinny-clients.conf), teste avec nginx -t et remet l'ancien en cas d'échec.
# Sauvegarde d'abord ; sshd -t avant de recharger ssh, et remise de l'ancienne config si le test échoue.
# La minuterie n'est activée que si /etc/djvinny-sync.env est rempli et que le certificat du domaine existe.
set -u
if [ "$(id -u)" -ne 0 ]; then echo "Lance-moi avec sudo : sudo bash installer.sh"; exit 1; fi
ICI="$(cd "$(dirname "$0")" && pwd)"
for f in djvinny-sync.py djvinny-sync.service djvinny-sync.timer djvinny-site.conf; do [ -f "$ICI/$f" ] || { echo "Fichier manquant : $ICI/$f"; exit 1; }; done
[ -f /etc/nginx/djvinny-proxy.conf ] && [ -f /etc/nginx/conf.d/djvinny-limits.conf ] || { echo "djvinny-proxy.conf / djvinny-limits.conf absents : lancer d'abord appliquer.sh"; exit 1; }

SAUV=/root/djvinny-sauvegarde-$(date +%Y%m%d-%H%M%S)
mkdir -p "$SAUV" && cp -a /etc/ssh/sshd_config "$SAUV/" && ls /etc/nginx/sites-enabled > "$SAUV/sites-enabled.txt"
echo "Sauvegarde : $SAUV"

# 1. Utilisateur des tunnels, sans shell
if ! id djv >/dev/null 2>&1; then useradd --system --create-home --shell /usr/sbin/nologin djv && echo "Utilisateur djv créé"; fi
install -d -m 700 -o djv -g djv /home/djv/.ssh
[ -f /home/djv/.ssh/authorized_keys ] || install -m 600 -o djv -g djv /dev/null /home/djv/.ssh/authorized_keys

# 2. sshd : relais distant seulement pour djv
if ! grep -q "^Match User djv" /etc/ssh/sshd_config; then
  printf '\n# DJ Vinny : tunnels des clients (relais distant seulement, voir /opt/djvinny)\nMatch User djv\n    AllowTcpForwarding remote\n    GatewayPorts no\n    PermitTTY no\n    X11Forwarding no\n    AllowAgentForwarding no\n' >> /etc/ssh/sshd_config
  if sshd -t; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd; echo "sshd : bloc djv ajouté, ssh rechargé"
  else
    cp -a "$SAUV/sshd_config" /etc/ssh/sshd_config; echo "ÉCHEC de sshd -t : ancienne config remise, ssh inchangé"; exit 1
  fi
fi

# 3. Script et minuterie
install -D -m 755 "$ICI/djvinny-sync.py" /opt/djvinny/djvinny-sync.py
install -m 644 "$ICI/djvinny-sync.service" "$ICI/djvinny-sync.timer" /etc/systemd/system/
systemctl daemon-reload
if [ ! -f /etc/djvinny-sync.env ]; then
  # jeton et adresse Convex déposés à côté de ce script (fichiers « jeton » et « convex-site-url »), sinon jeton généré ici
  JETON="$(cat "$ICI/jeton" 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '/+=')"
  URL="$(cat "$ICI/convex-site-url" 2>/dev/null || true)"
  install -m 600 /dev/null /etc/djvinny-sync.env
  printf 'CONVEX_SITE_URL=%s\nVPS_TOKEN=%s\nDOMAINE=djvinny.ca\nTUNNEL_USER=djv\n' "$URL" "$JETON" > /etc/djvinny-sync.env
  echo "Créé /etc/djvinny-sync.env"
fi
rm -f "$ICI/jeton" # le jeton ne reste que dans /etc/djvinny-sync.env (root seulement)

# 4. Activer la minuterie seulement si tout est prêt
. /etc/djvinny-sync.env
MANQUE=""
[ -n "${CONVEX_SITE_URL:-}" ] || MANQUE="$MANQUE CONVEX_SITE_URL"
[ -f "/etc/letsencrypt/live/${DOMAINE:-djvinny.ca}/fullchain.pem" ] || MANQUE="$MANQUE certificat-*.${DOMAINE:-djvinny.ca}"
if [ -z "$MANQUE" ]; then
  # Page de vente de djvinny.ca (dossier site/ copié à côté de ce script) ; nginx -t avant de recharger, sinon retrait
  if [ -f "$ICI/site/index.html" ]; then
    install -d -m 755 /var/www/djvinny.ca && cp -r "$ICI/site/." /var/www/djvinny.ca/
    install -m 644 "$ICI/djvinny-site.conf" /etc/nginx/sites-enabled/djvinny-site.conf
    if nginx -t 2>/dev/null; then systemctl reload nginx && echo "Page djvinny.ca en ligne"
    else rm -f /etc/nginx/sites-enabled/djvinny-site.conf; echo "ÉCHEC de nginx -t : page djvinny.ca retirée, nginx inchangé"; fi
  fi
  # Portail de paiement compte.djvinny.ca (dossier compte/ + djvinny-compte.conf) ; config.js donne l'adresse Convex à la page
  if [ -f "$ICI/compte/index.html" ] && [ -f "$ICI/djvinny-compte.conf" ]; then
    install -d -m 755 /var/www/compte.djvinny.ca && cp -r "$ICI/compte/." /var/www/compte.djvinny.ca/
    printf 'window.CONVEX_SITE = "%s";\n' "$CONVEX_SITE_URL" > /var/www/compte.djvinny.ca/config.js
    install -m 644 "$ICI/djvinny-compte.conf" /etc/nginx/sites-enabled/djvinny-compte.conf
    if nginx -t 2>/dev/null; then systemctl reload nginx && echo "Portail compte.djvinny.ca en ligne"
    else rm -f /etc/nginx/sites-enabled/djvinny-compte.conf; echo "ÉCHEC de nginx -t : portail retiré, nginx inchangé"; fi
  fi
  systemctl enable --now djvinny-sync.timer && echo "Minuterie activée"
else
  echo "Minuterie NON activée, il manque :$MANQUE (voir README.md, puis relancer ce script)"
fi
echo "Empreinte du VPS pour Convex (VPS_HOST_KEY) : $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
