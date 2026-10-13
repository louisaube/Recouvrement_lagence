# Écran Journal d'audit (mise à jour) : plan de réalisation

Objet : le journal du socle (`/journal`, `specifications/socle/70-ecrans.md` §10) devient lisible par le superviseur, en plus de l'administrateur, et affiche en français les actions de cette version. L'écran lui-même (filtres, tableau, lien partageable, pagination) est inchangé.

## Parcours
Inchangé pour l'administrateur. Le superviseur y accède par l'onglet « Journal » du menu « Recouvrement » et y retrouve les imports confirmés, activations de politique, préparations et libérations de lot, approbations, décisions de la file, relectures, litiges et appels d'agents. Un autre profil voit « Accès refusé ».

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Garde d'accès | « Accès refusé » (titre), « Vous n'avez pas les droits nécessaires pour consulter cette page. », « Retour à l'accueil » | l'écran s'ouvre si le rôle est administrateur **ou** si le profil est Superviseur ; sinon la garde du socle s'applique, sans appel à `GET /audit-logs` | `GET /profiles/me` |
| Onglet | « Journal » dans le menu « Recouvrement » (superviseur) et dans « Administration » (administrateur) | un administrateur superviseur voit l'onglet dans les deux barres | |
| Colonne « Action » | pastille du verbe français et code en texte secondaire (inchangé) | verbes ajoutés ci-dessous | `GET /audit-logs` |
| Liste « Action » du filtre | « <verbe> — <code> » (inchangé) | les nouvelles actions apparaissent seules, par la déclaration de trace des routes | `GET /audit-logs/filters` |

### Verbes français des nouvelles actions (suffixe du code d'action)
| Suffixe | Verbe | Suffixe | Verbe |
|---|---|---|---|
| `set` | Attribution | `draw` | Tirage |
| `confirm` | Confirmation | `review` | Relecture |
| `activate` | Activation | `decide` | Décision |
| `prepare` | Préparation | `open` | Ouverture |
| `release` | Libération | `close` | Clôture |
| `approve` | Approbation | `open-conversation` | Ouverture de conversation |
| `write-off` | Passage en perte | `next-offer` | Offre suivante |
| `register-commitment` | Engagement | `report-dispute` | Contestation |
| `request-human` | Intervention humaine | `report-complaint` | Réclamation |
| `check-message` | Vérification de message | `mcp` | Appel MCP |
Le verbe de `import-confirm` reste « Confirmation d'import » comme au socle ; tout suffixe inconnu s'affiche tel quel.

## Règles
- `rule-recouvrement-screen-journal` (user) : le superviseur voit le journal ; l'écran est celui du socle.
- `rule-recouvrement-screen-journal-agent-never` (user) : le compte agent n'a ni onglet ni accès au journal ; le service litiges et le lecteur des indicateurs non plus.
- `rule-recouvrement-screen-journal-verbs` (inferred) : les verbes français ci-dessus s'ajoutent à `actionVerb` du studio (`studio/src/app/features/audit/hooks/auditFilters.ts`) ; les résumés rédigés par l'API sont affichés tels quels, en texte brut.
- Règles du socle inchangées : `rule-foundation-audit-french-screen`, `rule-foundation-audit-shareable-filter`, `rule-foundation-audit-period-inclusive-days`, `rule-foundation-audit-url-sanitized`.

## Accès
Administrateur (rôle) ou Superviseur (profil). Le serveur refuse `GET /audit-logs` à tout autre compte (`journal-api-modification-request.md`).

## Hypothèses
- Si la contestation de la déclaration d'accès (journal-api-modification-request) est refusée, le superviseur n'a pas le journal et l'onglet « Journal » du menu « Recouvrement » n'est pas livré.
- Le filtre « Auteur » liste aussi les comptes agent (leur e-mail est celui du compte).
