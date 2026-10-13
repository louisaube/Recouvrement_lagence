# Demande à l'API : relecture hebdomadaire d'un échantillon de décisions

Écran demandeur : Relecture. Besoin : tirer l'échantillon de la semaine (le cerveau tire au sort), présenter au superviseur les entrées de chaque dossier telles qu'au moment de la décision sans la décision du cerveau, recueillir la décision du superviseur, et montrer l'écart une fois la relecture donnée. L'écart alimente l'indicateur « erreurs / décisions relues ». Le tirage de 5 % de dossiers est hors demande.

## Opérations
Toutes les routes : garde de profil `supervisor`. Listes : `from`, `size` (1 à 100, défaut 10), `{ items, total }`.

| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /review-samples` | `reviews:list` | profil `supervisor` | `from`, `size` | `200 { items: ReviewSampleDto[], total }`, de la semaine la plus récente à la plus ancienne |
| `POST /review-samples` | `reviews:draw` | profil `supervisor` | corps strict `{ week?: string /* ^[0-9]{4}-W(0[1-9]\|[1-4][0-9]\|5[0-3])$ */ }` ; `week` absent : semaine ISO complète précédente (fuseau Europe/Paris) | `201 { sample: ReviewSampleDto }` ; `400` ; `409 reviews.already_drawn` ; `409 reviews.no_decisions` ; `409 reviews.week_in_future` ; `409 reviews.no_active_policy` |
| `GET /review-samples/:id` | `reviews:get` | profil `supervisor` | `id` uuid | `200 { sample: ReviewSampleDto }` ; `404 repository.not_found` |
| `GET /review-samples/:id/items` | `reviews:items` | profil `supervisor` | `status` : `to_review` \| `reviewed` (absent : tous) ; `from`, `size` | `200 { items: ReviewItemDto[], total }` triés par rang de tirage ; `404` |
| `POST /review-samples/:id/items/:itemId/review` | `reviews:review` | profil `supervisor` | `id`, `itemId` uuid ; corps strict `{ action: 'none' \| 'reminder' \| 'proposal' \| 'transfer_proposed', comment?: string (rogné, 1..1000) }` | `200 { item: ReviewItemDto }` ; `400` ; `404` ; `409 reviews.already_reviewed` |

DTO :
- `ReviewSampleDto` = `{ id, week: string, weekStart: date, weekEnd: date, drawnAt, drawnBy: { id, email }, seed: string(64), size: integer, poolSize: integer, reviewedCount: integer, disagreementCount: integer, policyVersion: { id, label } }`.
- `ReviewItemDto` = `{ id, rank: integer, status: 'to_review' \| 'reviewed', caseId, debtorId, decidedAt, inputs: { name: string(1..100), value: string(0..500) }[], supervisorAction: action \| null, comment: string \| null, reviewedBy: { id, email } \| null, reviewedAt \| null, brainAction: action \| null /* rendu seulement une fois relu */, brainRule: string \| null /* idem */, agreed: boolean \| null }`.

Trace d'audit : `draw` et `review` sont tracées (type d'objet « Relecture », actions `reviews:draw` et `reviews:review`, identifiant = id de l'échantillon ; résumés « Échantillon de relecture 2026-W41 tiré : 25 décisions. » et « Décision relue sur l'échantillon 2026-W41. », sans motif ni identifiant client).

## Règles
- `rule-recouvrement-review-weekly-sample` (user) : le cerveau tire chaque semaine l'échantillon au sort ; sa taille est `reviewSampleSize` de la politique active au moment du tirage (si le jeu des décisions est plus petit, toutes sont retenues) ; un seul échantillon par semaine ISO (index unique de la base sur `week`).
- `rule-recouvrement-review-manual-trigger` (inferred) : aucun ordonnanceur n'existe : c'est le superviseur qui déclenche le tirage de la semaine.
- `rule-recouvrement-review-pool` (inferred) : le jeu tiré est l'ensemble des décisions du cerveau de type `daily_action` prises pendant la semaine ISO (lundi 00:00 au dimanche 24:00, Europe/Paris), hors lots `replaced` et hors rejeu des dossiers témoins.
- `rule-recouvrement-review-reproducible` (user) : le tirage est reproductible : `seed` = SHA-256 hexadécimal de la chaîne `<semaine>|<identifiant de la version de politique>` ; le jeu est trié par identifiant de décision croissant (texte) ; pour i de n − 1 à 1, on échange l'élément i avec l'élément j = (les 16 premiers caractères hexadécimaux de SHA-256(`<seed>:<i>`) lus comme un entier non signé) modulo (i + 1) ; les N premiers éléments sont l'échantillon, numérotés de 1 à N (`rank`). Même graine et même jeu donnent le même échantillon.
- `rule-recouvrement-review-blind` (user) : avant sa relecture, un élément ne rend que les entrées du dossier telles qu'au moment de la décision (copie figée dans le journal des décisions, pas l'état courant) ; ni l'action, ni la règle, ni la probabilité, ni la version de politique de la décision ne figurent dans `ReviewItemDto` tant que `status` est `to_review`.
- `rule-recouvrement-review-gap-feeds-indicator` (user) : une fois la relecture donnée, `agreed` indique si l'action du superviseur égale celle du cerveau ; chaque écart compte comme une erreur dans l'indicateur « erreurs / décisions relues » (`indicateurs-api-modification-request.md`).
- `rule-recouvrement-review-final` (inferred) : une relecture donnée ne se modifie pas (`409 reviews.already_reviewed`).
- `rule-recouvrement-review-supervisor-only` (user) : seul le superviseur relit ; les autres profils reçoivent `403 security.access_denied`.

## Compatibilité
Aucune opération existante modifiée. Dépend du journal des décisions (`dossiers-api-modification-request.md`, `rule-recouvrement-decision-journal`) qui conserve les entrées complètes de chaque décision. `specifications/permissions.yaml` : une ligne par opération.
