# Demande à l'API : lecture du journal d'audit par le superviseur

Écran demandeur : Journal (celui du socle), ouvert au superviseur. Besoin : le superviseur lit le journal du socle (décisions, imports, approbations, activations, appels d'agents) ; aucun autre profil, sauf l'administrateur déjà admis.

## Opérations
| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /audit-logs` (existante) | `audit:list` (inchangée) | rôle `admin` **ou** profil `supervisor` | inchangée | inchangée ; un compte d'un autre profil et un utilisateur sans profil reçoivent `403 security.access_denied` |
| `GET /audit-logs/filters` (existante) | `audit:filters` (inchangée) | rôle `admin` **ou** profil `supervisor` | inchangée | inchangée |

Aucune autre propriété des opérations ne change : schémas, tri, filtres, pagination, codes d'erreur. Les entrées des routes de cette version apparaissent par la déclaration de trace de leurs routes (`rule-foundation-audit-declarative-route`) : actions `profiles:set`, `recovery-imports:confirm`, `policies:confirm`, `policies:activate`, `batches:prepare`, `batches:release`, `ledger:approve`, `ledger:write-off`, `queue:decide`, `disputes:open`, `disputes:close`, `reviews:draw`, `reviews:review` et les actions des outils d'agent (`outils-agents-api-modification-request.md`).

## Règles
- `rule-recouvrement-journal-supervisor` (user) : le superviseur voit le journal ; la vérification est faite par le serveur à chaque requête (`rule-recouvrement-profile-server-enforced`).
- `rule-recouvrement-journal-others-refused` (user) : le compte agent, le service litiges et le lecteur des indicateurs ne voient pas le journal (`403 security.access_denied`) ; l'accès de l'administrateur du socle est conservé (`rule-foundation-audit-admin-only` étendue, jamais restreinte).
- `rule-recouvrement-journal-agent-never` (user) : un compte agent ne voit jamais le journal, quelle que soit la route.

## Compatibilité
- Modification de la déclaration d'accès de deux opérations du socle : `api/src/features/audit/**` est gelé pour les agents de fabrication et `specifications/permissions.yaml` est en lecture seule. L'agent de fabrication ouvre donc deux contestations `OPEN: permissions GET /audit-logs: admettre le profil supervisor en plus du rôle admin` et `OPEN: permissions GET /audit-logs/filters: idem` dans `DISPUTES.md` de ce dossier de plans ; la mise en œuvre attendue est `roles: []` plus une garde métier « rôle `admin` ou profil `supervisor` » (l'accès reste refusé par défaut, la garde s'exécute avant la validation).
- Aucun changement de schéma OpenAPI : pas de rupture du contrat de référence ; seul `permissions.yaml` change (colonne `allow` observée : `[]` avec `customGuards`, au lieu de `[admin]`).
- Repli si la contestation est refusée : le studio n'affiche le journal qu'aux administrateurs (comportement actuel) et le superviseur n'y a pas accès ; l'écran Journal n'est alors pas livré au superviseur.
