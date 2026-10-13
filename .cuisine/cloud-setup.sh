#!/bin/bash
# Script d'environnement pour les sessions cloud Claude Code (Paramètres de l'environnement > script de démarrage).
# Installe les outils système de Cuisine sauvage ; la préparation propre au dépôt se fait ensuite par "cuisine up".
set -e
apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql psmisc >/dev/null
service postgresql start
su postgres -c "psql -tc \"select 1 from pg_roles where rolname='database'\"" | grep -q 1 || su postgres -c "psql -qc \"create role database login superuser password 'database'\""
command -v pnpm >/dev/null || npm i -g pnpm >/dev/null
pip install -q --break-system-packages pyyaml schemathesis bcrypt
V=1.11.7; curl -sSL "https://github.com/oasdiff/oasdiff/releases/download/v$V/oasdiff_${V}_linux_amd64.tar.gz" | tar -xz -C /usr/local/bin oasdiff
mkdir -p "$HOME/.cuisine-vendor" && cd "$HOME/.cuisine-vendor" && [ -x yamloop/bin/yamloop ] || { rm -rf yamloop; git clone -q https://github.com/maleus-ai/yamloop.git && cd yamloop && git checkout -q 444df9f && npm install --silent && npm run -s build; }
