#!/usr/bin/env bash
# Démarrage ou reprise d'une session cloud : la machine a pu être recyclée pendant l'attente (PostgreSQL arrêté,
# fabrication interrompue sans fin écrite). La veille remet la machine en route et reprend la fabrication interrompue ;
# sa sortie est lue par Claude au début de la session. Hors session cloud (machine locale), rien n'est lancé.
[ "${CLAUDE_CODE_REMOTE:-}" = true ] || [ "${CUISINE_VEILLE:-}" = 1 ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
[ -x .cuisine/bin/cuisine ] && [ -f package.json ] || exit 0
echo "Veille de la cuisine ($(date '+%d/%m %H:%M')) :"
.cuisine/bin/cuisine veille --relance 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -12
exit 0
