# Passerelle des clients sur le VPS (étape 6)

Chaque client payant a `<client>.djvinny.ca`. Son serveur DJ Vinny (sur son PC) ouvre un tunnel SSH vers le VPS avec une clé qu'il a générée lui-même. Le VPS ne fait que relayer les routes des invités. Une minuterie lit Convex chaque minute : clés à autoriser (chacune limitée à son port, sans shell) et sous-domaines ouverts (passe attachée, jusqu'à la fin de la soirée + 6 h) ou fermés (« Soirée non active »).

Rien ici ne touche à `djvinny.korvia.ca` (montage actuel de Pat).

`djvinny.ca` lui-même sert la page de vente bilingue (`site/`, bloc `djvinny-site.conf`, `www` redirigé). Installée par `installer.sh` en même temps que la minuterie, une fois le certificat obtenu. Les boutons Télécharger et Acheter restent grisés (« Bientôt ») tant que `LIENS` est vide dans `site/index.html` (étapes 9 et 4). Dans le DNS, `www` doit pointer vers le VPS (A ou CNAME vers `djvinny.ca`).

## Installation (une fois, avec l'accord de Pat)

Raccourci : copier le dossier `deploy/vps/` sur le VPS puis `sudo bash installer.sh`. Il fait les étapes 1, 2 et 4 avec sauvegarde, `sshd -t` et remise de l'ancienne config en cas d'échec, crée `/etc/djvinny-sync.env` avec un jeton, et n'active la minuterie que lorsque `CONVEX_SITE_URL` et le certificat existent. Les étapes 3 (certificat) et 5 (variables Convex) restent à faire.

Prérequis : le domaine `djvinny.ca` (démarche A), avec `*.djvinny.ca` pointé vers le VPS ; nginx et `deploy/djvinny-proxy.conf` + `deploy/djvinny-limits.conf` déjà en place (voir `deploy/appliquer.sh`).

1. Utilisateur des tunnels, sans shell :
   ```bash
   sudo useradd --system --create-home --shell /usr/sbin/nologin djv
   ```
   ```bash
   sudo install -d -m 700 -o djv -g djv /home/djv/.ssh
   ```
2. `/etc/ssh/sshd_config`, à la fin, puis `sudo systemctl reload ssh` :
   ```
   Match User djv
       AllowTcpForwarding remote
       GatewayPorts no
       PermitTTY no
       X11Forwarding no
       AllowAgentForwarding no
   ```
3. Certificat générique (défi DNS, une fois ; le renouvellement dépend du registraire, voir son greffon certbot) :
   ```bash
   sudo certbot certonly --manual --preferred-challenges dns -d 'djvinny.ca' -d '*.djvinny.ca'
   ```
4. Script et minuterie :
   ```bash
   sudo install -D -m 755 djvinny-sync.py /opt/djvinny/djvinny-sync.py
   ```
   ```bash
   sudo install -m 644 djvinny-sync.service djvinny-sync.timer /etc/systemd/system/
   ```
   `/etc/djvinny-sync.env` (mode 600, propriétaire root) :
   ```
   CONVEX_SITE_URL=https://<déploiement>.convex.site
   VPS_TOKEN=<longue valeur aléatoire>
   DOMAINE=djvinny.ca
   TUNNEL_USER=djv
   ```
   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now djvinny-sync.timer
   ```
5. Variables d'environnement Convex (`npx convex env set NOM valeur`) :

   | Variable | Valeur |
   |---|---|
   | `VPS_HOST` | adresse du VPS (ex. `5.78.177.164`) |
   | `VPS_USER` | `djv` |
   | `VPS_HOST_KEY` | contenu de `/etc/ssh/ssh_host_ed25519_key.pub` sans le commentaire (`ssh-ed25519 AAAA…`) |
   | `VPS_TOKEN` | la même valeur que dans `/etc/djvinny-sync.env` |
   | `DOMAINE` | `djvinny.ca` |

   Sans `VPS_HOST`, les serveurs locaux n'ouvrent aucun tunnel automatique.

## Vérifier

```bash
sudo systemctl start djvinny-sync && journalctl -u djvinny-sync -n 20
```

Essai sans toucher au système (sur n'importe quel ordinateur) :

```bash
CONVEX_SITE_URL=http://127.0.0.1:3211 VPS_TOKEN=… python3 djvinny-sync.py --racine /tmp/essai --sans-recharger
```
