# Écran Relecture : plan de réalisation

Objet : le superviseur tire l'échantillon hebdomadaire de décisions du cerveau, relit chaque dossier tel qu'il se présentait au moment de la décision, sans voir la décision du cerveau, et donne la sienne ; l'écart alimente l'indicateur d'erreurs. Chemin `/relecture` (paramètres `?echantillon=<id>`, `?statut=a-relire|relus|tous`), accès : profil Superviseur.

## Parcours
1. Le superviseur ouvre `/relecture` : la liste des échantillons (le plus récent d'abord) et, si aucun n'existe, « Aucun échantillon tiré. Tirez celui de la semaine. ».
2. « Tirer l'échantillon de la semaine » : il choisit la semaine (par défaut la dernière semaine complète) et valide ; l'échantillon est créé ; l'écran l'ouvre.
3. Dans l'échantillon, les éléments « À relire » s'affichent un par carte : tableau des entrées du dossier à l'instant de la décision ; choix de sa propre décision ; commentaire facultatif ; « Enregistrer ma relecture ».
4. Après enregistrement, la carte montre la décision du cerveau (action et règle) et « Accord » ou « Écart » ; les compteurs de l'échantillon se mettent à jour.
5. Erreurs et états vides : voir les tableaux.

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Relecture » | | |
| Tirage | liste « Semaine à relire » (les 8 dernières semaines ISO, la semaine en cours comprise, libellées « 2026-W41 (du 05/10/2026 au 11/10/2026) » ; défaut : la dernière semaine complète) et bouton « Tirer l'échantillon de la semaine » | le bouton envoie la semaine choisie ; pendant l'envoi : désactivé | `POST /review-samples` |
| Tableau | « Échantillons » : « Semaine », « Tiré le », « Tiré par », « Taille », « Relus » (`N / T`), « Écarts », « Actions » (« Ouvrir l'échantillon <semaine> ») | pagination 10 / 25 / 50 | `GET /review-samples` |
| En-tête de l'échantillon | « Échantillon <semaine> » ; « Tiré le JJ/MM/AAAA HH:mm par <e-mail> » ; « Décisions de la semaine : P » ; « Taille de l'échantillon : T » ; « Graine du tirage » (valeur complète, police à chasse fixe) ; « Version de politique » | la graine rend le tirage reproductible | `GET /review-samples/:id` |
| Filtre | liste « Statut » : « À relire » (défaut), « Relus », « Tous » | porté par `?statut=` | `GET /review-samples/:id/items?status=` |
| Carte d'élément | titre « Décision n° <rang> · dossier <identifiant client> » (lien « Ouvrir le dossier <identifiant client> » vers la fiche) ; mention « Entrées du dossier au JJ/MM/AAAA HH:mm » ; tableau « Entrées » (nom, valeur) | aucune action, règle, version de politique ou probabilité du cerveau tant que l'élément est à relire | `ReviewItemDto` |
| Choix | groupe radio « Votre décision pour le dossier <identifiant client> » : « Aucune », « Relance », « Proposition », « Transfert proposé » | aucune option préchoisie | |
| Champ | « Commentaire (facultatif) » | 0 à 1 000 caractères | |
| Bouton | « Enregistrer ma relecture » | désactivé tant qu'aucune décision n'est choisie | `POST /review-samples/:id/items/:itemId/review` |
| Carte relue | « Votre décision : <libellé> » ; « Décision du cerveau : <libellé> (règle <règle>) » ; pastille « Accord » ou « Écart » ; commentaire ; « Relu par <e-mail> le JJ/MM/AAAA HH:mm » | lecture seule | `ReviewItemDto` |
| Progression | « N relus sur T » avec barre | | `reviewedCount`, `size` |

### Résultats et erreurs
| Réponse | Message |
|---|---|
| tirage `201` | notification « Échantillon tiré. » |
| `409 reviews.already_drawn` | « L'échantillon de cette semaine a déjà été tiré. » ; il est ouvert |
| `409 reviews.no_decisions` | « Le cerveau n'a pris aucune décision cette semaine-là. » |
| `409 reviews.week_in_future` | « Cette semaine n'a pas commencé. » |
| `409 reviews.no_active_policy` | « Aucune version de politique n'est active : la taille de l'échantillon est inconnue. » |
| relecture `200` | notification « Relecture enregistrée. » ; la carte devient « relue » |
| `409 reviews.already_reviewed` | « Cet élément a déjà été relu. » ; la carte se recharge |
| autres | `rule-foundation-api-failure-handling` |

## Règles
- `rule-recouvrement-screen-review` (user) : l'écran Relecture permet de tirer l'échantillon, de relire et de donner sa décision.
- `rule-recouvrement-screen-review-blind` (user) : avant sa réponse, le superviseur ne voit que les entrées du dossier telles qu'au moment de la décision, sans la décision du cerveau ; le studio n'affiche aucun champ de décision pour un élément « À relire » (l'API n'en rend pas).
- `rule-recouvrement-screen-review-gap` (user) : une fois la relecture donnée, l'écart avec la décision du cerveau est signalé (« Accord » / « Écart ») ; il alimente l'indicateur « erreurs / décisions relues ».
- `rule-recouvrement-screen-review-reproducible` (user) : la graine du tirage est affichée ; le même tirage sur les mêmes décisions redonne le même échantillon.
- `rule-recouvrement-screen-review-final` (inferred) : une relecture donnée ne se modifie plus ; les contrôles de la carte relue sont absents.
- `rule-recouvrement-screen-review-manual-draw` (inferred) : le tirage est déclenché par le superviseur (aucune planification automatique).

## Accès
Profil Superviseur seulement ; les autres voient « Accès refusé ».

## Hypothèses
- La semaine est la semaine ISO (lundi à dimanche, Europe/Paris), identifiée par `AAAA-Www`.
- Les entrées d'un élément sont celles du journal des décisions, formatées par l'API ; le studio ne les calcule pas.
- Les décisions relues sont celles du type « action du jour » : le superviseur répond avec le même vocabulaire (aucune, relance, proposition, transfert proposé).
