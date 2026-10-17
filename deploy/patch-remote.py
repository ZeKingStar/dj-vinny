#!/usr/bin/env python3
# Ouvre la télécommande (/remote) sur djvinny.korvia.ca : ajoute ses chemins à la liste autorisée
# et une règle serrée sur /login. Usage : patch-remote.py <fichier du site>   (idempotent)
import sys

path = sys.argv[1]
s = open(path, encoding="utf-8").read()
if "djv_login" in s:
    print("déjà appliqué")
    sys.exit(0)

old = r"location ~ ^/(index\.html|souhaits\.html|style\.css|anim\.js|favicon\.ico|manifest\.webmanifest|sw\.js|vinny[-0-9a-z]*\.(svg|png)|api/(state|events|search|request|wish|config))$ {"
new = r"location ~ ^/(index\.html|souhaits\.html|style\.css|anim\.js|favicon\.ico|manifest\.webmanifest|sw\.js|vinny[-0-9a-z]*\.(svg|png)|login\.html|remote|api/(state|events|search|request|wish|config|remote|remote/status|gain|linedance|fx|queue/reorder|queue/[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+))$ {"
if s.count(old) != 1:
    sys.exit("liste autorisée introuvable ou en double : fichier modifié à la main ? rien n'a été changé")
s = s.replace(old, new)

marker = "    # Tout le reste : refusé"
login = """    # Connexion de l'hôte (télécommande) : très peu d'essais par minute et par adresse
    location = /login {
        limit_req zone=djv_login burst=5 nodelay;
        proxy_pass http://127.0.0.1:3010;
        include /etc/nginx/djvinny-proxy.conf;
    }

"""
if s.count(marker) != 1:
    sys.exit("repère « Tout le reste : refusé » introuvable : rien n'a été changé")
s = s.replace(marker, login + marker)
open(path, "w", encoding="utf-8").write(s)
print("modifié")
