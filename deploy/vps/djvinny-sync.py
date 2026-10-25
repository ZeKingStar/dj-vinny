#!/usr/bin/env python3
"""Passerelle DJ Vinny sur le VPS : lancé chaque minute par djvinny-sync.timer.

Lit dans Convex la liste des clients (GET /vps/clients), puis :
  1. authorized_keys de l'utilisateur des tunnels : une clé par client, limitée au relais de SON port (aucun shell) ;
  2. nginx : un bloc par sous-domaine, ouvert (routes invités relayées vers le tunnel) ou fermé (« Soirée non active »).
Ne recharge nginx que si quelque chose a changé, après « nginx -t » ; en cas d'échec, remet l'ancien fichier.
Le VPS va chercher le travail : Convex n'a aucun accès au VPS. Aucun code de client ne tourne ici.

Réglages (/etc/djvinny-sync.env) : CONVEX_SITE_URL, VPS_TOKEN, DOMAINE (djvinny.ca), TUNNEL_USER (djv).
Essai sans toucher au système : --racine DOSSIER (écrit sous ce dossier) --sans-recharger.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, urllib.request

SOUS_DOMAINE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$")
CLE = re.compile(r"^ssh-ed25519 [A-Za-z0-9+/]{68}={0,2}$")
# mêmes routes que deploy/djvinny.nginx : seules les pages et API des invités (et la télécommande, protégée par mot de passe) passent
ROUTES = (r"^/(index\.html|souhaits\.html|style\.css|anim\.js|i18n\.js|favicon\.ico|manifest\.webmanifest|sw\.js|vinny[-0-9a-z]*\.(svg|png)"
          r"|login\.html|remote|api/(state|events|search|request|wish|config|remote|remote/status|gain|linedance|fx|queue/reorder"
          r"|queue/[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+))$")
FERME = "Soirée non active / Party not active"


def lire_clients(url, jeton):
    req = urllib.request.Request(url.rstrip("/") + "/vps/clients", headers={"Authorization": "Bearer " + jeton})
    with urllib.request.urlopen(req, timeout=20) as r:
        clients = json.load(r)["clients"]
    # défense : on ne fait confiance à rien de ce qui sera écrit dans des fichiers système
    return sorted((c for c in clients if SOUS_DOMAINE.match(str(c.get("sousDomaine", ""))) and isinstance(c.get("port"), int) and 1024 < c["port"] < 65536),
                  key=lambda c: c["sousDomaine"])


def authorized_keys(clients):
    lignes = ["# Généré par djvinny-sync.py : ne pas modifier à la main"]
    for c in clients:
        if c.get("cleSsh") and CLE.match(c["cleSsh"]):
            lignes.append(f'restrict,port-forwarding,permitlisten="127.0.0.1:{c["port"]}" {c["cleSsh"]} djvinny-{c["sousDomaine"]}')
    return "\n".join(lignes) + "\n"


def nginx(clients, domaine):
    cert = f"/etc/letsencrypt/live/{domaine}"  # certificat générique *.domaine (voir README.md)
    out = [f"# Généré par djvinny-sync.py : ne pas modifier à la main\n",
           "server {\n    listen 80;\n    listen [::]:80;\n"
           f"    server_name *.{domaine};\n    return 301 https://$host$request_uri;\n}}\n"]
    for c in clients:
        tete = (f"server {{\n    listen 443 ssl;\n    listen [::]:443 ssl;\n    server_name {c['sousDomaine']}.{domaine};\n"
                f"    ssl_certificate {cert}/fullchain.pem;\n    ssl_certificate_key {cert}/privkey.pem;\n")
        if c.get("ouvert"):
            proxy = f"        proxy_pass http://127.0.0.1:{c['port']};\n        include /etc/nginx/djvinny-proxy.conf;\n"
            out.append(tete + f"    location = / {{\n{proxy}    }}\n    location ~ {ROUTES} {{\n{proxy}    }}\n"
                       f"    location = /login {{\n        limit_req zone=djv_login burst=5 nodelay;\n{proxy}    }}\n"
                       "    location / {\n        return 404;\n    }\n}\n")
        else:
            out.append(tete + f"    location / {{\n        default_type text/plain;\n        return 503 \"{FERME}\";\n    }}\n}}\n")
    return "\n".join(out)


def ecrire_si_change(chemin, contenu, mode):
    """Écrit le fichier seulement s'il change ; renvoie l'ancien contenu (None si inchangé, '' s'il n'existait pas)."""
    ancien = open(chemin, encoding="utf-8").read() if os.path.exists(chemin) else ""
    if ancien == contenu:
        return None
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(chemin))
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write(contenu)
    os.chmod(tmp, mode)
    os.replace(tmp, chemin)  # remplacement atomique : jamais de fichier à moitié écrit
    return ancien


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--racine", default="/", help="dossier racine (essais)")
    ap.add_argument("--sans-recharger", action="store_true", help="ne lance ni nginx -t ni le rechargement")
    a = ap.parse_args()
    url, jeton = os.environ.get("CONVEX_SITE_URL", ""), os.environ.get("VPS_TOKEN", "")
    domaine, user = os.environ.get("DOMAINE", "djvinny.ca"), os.environ.get("TUNNEL_USER", "djv")
    if not url or not jeton:
        sys.exit("CONVEX_SITE_URL et VPS_TOKEN requis (/etc/djvinny-sync.env)")
    try:
        clients = lire_clients(url, jeton)
    except Exception as e:  # Convex injoignable ou jeton refusé : on ne touche à rien
        sys.exit(f"Lecture de Convex impossible ({e}) : rien n'est modifié")
    r = lambda p: os.path.join(a.racine, p.lstrip("/"))

    cles = r(f"/home/{user}/.ssh/authorized_keys")
    if ecrire_si_change(cles, authorized_keys(clients), 0o600) is not None:
        if a.racine == "/":
            shutil.chown(cles, user, user)
        print("Clés des tunnels mises à jour")

    conf = r("/etc/nginx/sites-enabled/djvinny-clients.conf")
    ancien = ecrire_si_change(conf, nginx(clients, domaine), 0o644)
    if ancien is not None:
        if not a.sans_recharger:
            if subprocess.run(["nginx", "-t"], capture_output=True).returncode != 0:
                if ancien:
                    ecrire_si_change(conf, ancien, 0o644)
                else:
                    os.remove(conf)
                sys.exit("ÉCHEC de nginx -t : ancien fichier remis, nginx inchangé")
            subprocess.run(["systemctl", "reload", "nginx"], check=True)
        print("nginx : " + ", ".join(f"{c['sousDomaine']}={'ouvert' if c.get('ouvert') else 'fermé'}" for c in clients))


if __name__ == "__main__":
    main()
