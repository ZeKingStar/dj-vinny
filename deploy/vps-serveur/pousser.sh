#!/bin/bash
# Depuis le PC (Git Bash), à la racine du dossier de l'app : bash deploy/vps-serveur/pousser.sh
# Copie le code (sans .env, data, node_modules) vers le VPS et installe les dépendances. Relancer ensuite : sudo systemctl restart djvinny-serveur
set -e
tar czf - --exclude=node_modules --exclude=.git --exclude=.claude --exclude=data --exclude='.env*' --exclude=video --exclude=docs \
  --exclude=installateur --exclude=convex --exclude=outils --exclude=samples --exclude='*.log' \
  server.js match.js report.js package.json package-lock.json public views locales announce voix curated sounds deploy/vps-serveur \
| ssh monvps 'mkdir -p ~/djvinny-app && cd ~/djvinny-app && tar xzf - && npm ci --omit=dev --silent && ls'
