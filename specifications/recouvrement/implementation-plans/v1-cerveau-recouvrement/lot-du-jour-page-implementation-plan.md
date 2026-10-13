# Écran Lot du jour : plan de réalisation

Objet : le superviseur déclenche la préparation du lot du jour, lit ses contrôles, ses blocages et les ordres d'envoi structurés qu'il contient, et libère par une décision motivée un lot bloqué. Libéré, un lot est seulement marqué prêt : aucun envoi n'existe dans cette version. Chemin `/lot-du-jour` (paramètre `?lot=<id>` pour un lot passé), accès : profil Superviseur.

## Parcours
1. Le superviseur ouvre `/lot-du-jour` : la carte du jour dit « Pas encore préparé » ou l'état du lot de la date du jour, et l'historique liste les lots passés.
2. « Préparer le lot du jour » : le bouton est désactivé pendant la préparation (« Préparation en cours… ») ; à la réponse, le lot s'affiche : contrôles, parts par type de décision, dossiers exclus, ordres.
3. Lot **Prêt** (tous les contrôles passent) : rien à faire. Lot **Bloqué** : les contrôles en échec sont nommés ; le superviseur peut corriger la cause (par exemple confirmer un relevé frais) et préparer de nouveau (le lot bloqué est remplacé), ou libérer le lot par « Libérer le lot malgré le blocage » avec un motif.
4. Lot **À libérer** (seulement si la libération explicite est retenue, Q-RECOUVREMENT-04 option B) : « Libérer le lot ».
5. Le superviseur ouvre un lot passé depuis l'historique : lecture seule.
6. Erreurs : voir le tableau.

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Lot du jour » | | |
| Carte du jour | « Lot du JJ/MM/AAAA » ; pastille « Pas encore préparé », « Bloqué », « À libérer », « Prêt » ; « Préparé par <e-mail> » ; mention fixe « Libéré, le lot est seulement marqué prêt : aucun envoi n'existe dans cette version. » | le lot du jour est celui dont la date est celle du jour ; sinon « Pas encore préparé » | `GET /daily-batches?from=0&size=1` puis `GET /daily-batches/:id` |
| Bouton | « Préparer le lot du jour » | désactivé si le lot du jour est « Prêt » ou « À libérer » ; sous un lot « Bloqué », texte d'aide : « Une nouvelle préparation remplace le lot bloqué. » | `POST /daily-batches` |
| Section | « Contrôles » : une ligne par contrôle (libellés du référentiel §7), « Réussi » ou « Échec », problèmes en dessous | un échec est en couleur d'erreur | `checks` |
| Section | « Parts par type de décision » : « Type » (Aucune, Relance, Proposition, Transfert proposé), « Dossiers », « Part », « Mode » (« Plafond fixe » / « Statistique »), « Moyenne », « Écart-type », « Limite », « État » (« Dans la limite » / « Hors limite ») | « Moyenne », « Écart-type » et « Limite » vides (« — ») en mode plafond fixe où elles n'existent pas ; en mode plafond fixe « Limite » est le plafond | `shares` |
| Section | « Dossiers exclus » : « Raison » (« Pièce exigée absente », « Canal suspendu », « Canal non autorisé », « Aucun interlocuteur joignable », « Dossier gelé », « Relevé périmé », « Part couverte par une sortie comptable »), « Nombre » | « Aucun dossier exclu. » si vide | `excluded` |
| Section | « Ordres d'envoi » : filtres « Type » (Tous, Relance, Proposition, Confirmation d'engagement) et « Canal » (Tous, Voix, Courriel et SMS, Courrier) ; colonnes « Dossier » (lien « Ouvrir le dossier <identifiant client> » vers `/dossiers/<id>`), « Interlocuteur » (rôle), « Canal », « Type », « Conditions » (liste nom : valeur), « Statut » (Prévu / Bloqué / Annulé) | pagination 10 / 25 / 50 ; « Aucun ordre dans ce lot. » si vide ; aucun texte rédigé n'est affiché | `GET /daily-batches/:id/orders` |
| Section | « Libération » : si bloqué, bouton « Libérer le lot malgré le blocage » ; si à libérer, bouton « Libérer le lot » ; si libéré par décision, « Libéré par <e-mail> le JJ/MM/AAAA HH:mm. Motif : <motif> » | | `POST /daily-batches/:id/release` |
| Dialogue | titre « Libérer le lot » ; champ « Motif de la libération » (zone de texte, obligatoire, 1 à 1 000 caractères, compteur) ; texte « Les contrôles en échec resteront affichés. Cette action est tracée au journal d'audit. » (lot bloqué seulement) ; boutons « Annuler » et « Libérer le lot » | validation locale : motif non vide après rognage | idem |
| Section | « Historique des lots » : « Date », « Statut », « Dossiers », « Ordres », « Contrôles en échec », « Préparé par » ; bouton « Ouvrir le lot du JJ/MM/AAAA » | pagination 10 / 25 / 50 ; un lot « Remplacé » est affiché en gris | `GET /daily-batches` |

### Résultats et erreurs
| Réponse | Message |
|---|---|
| `201` lot prêt | notification « Lot du jour prêt. » |
| `201` lot bloqué | alerte d'avertissement « Le lot du jour est bloqué : <nombre> contrôle(s) en échec. Une alerte a été ajoutée à la file de décisions. » si le contrôle de parts échoue, sinon sans la seconde phrase |
| `201` lot à libérer | notification « Lot du jour préparé : à libérer. » |
| `409 batches.no_active_policy` | « Aucune version de politique n'est active. Activez-en une depuis l'écran Politique. » avec lien vers `/politique` |
| `409 batches.already_released` | « Le lot du jour est déjà préparé. » ; la page se recharge |
| `409 batches.not_releasable` | « Ce lot ne peut plus être libéré. » ; la page se recharge |
| libération réussie | notification « Lot libéré. » |
| autres | `rule-foundation-api-failure-handling` |

## Règles
- `rule-recouvrement-screen-batch` (user) : l'écran Lot du jour offre la préparation, les contrôles, les blocages et la libération.
- `rule-recouvrement-screen-batch-no-text` (user) : les ordres sont affichés comme des données structurées (dossier, interlocuteur, canal, conditions) ; le studio n'affiche, n'écrit et n'envoie aucun texte de message.
- `rule-recouvrement-screen-batch-blocked-needs-reason` (user) : un lot bloqué ne se libère que par décision motivée du superviseur ; sans motif, aucun appel n'est envoyé.
- `rule-recouvrement-screen-batch-states` (inferred) : les boutons dépendent du statut renvoyé par l'API ; le studio ne recalcule aucun contrôle ni aucune part.
- `rule-recouvrement-screen-batch-no-send` (user) : aucun bouton « Envoyer » n'existe ; « Prêt » est seulement un marquage.
- `rule-recouvrement-screen-batch-link-case` (inferred) : chaque ordre renvoie à la fiche du dossier (`/dossiers/<id>`).

## Accès
Profil Superviseur seulement ; les autres voient « Accès refusé ».

## Hypothèses
- La préparation est un appel synchrone (indicateur de progression, pas d'actualisation) : la taille du portefeuille de cette version le permet.
- Le choix entre libération automatique et libération explicite d'un lot sain relève de Q-RECOUVREMENT-04 ; le texte ci-dessus décrit l'option par défaut (A), où la rubrique « Libération » n'apparaît que pour un lot bloqué.
- Les parts sont affichées en pourcentage (`rule-recouvrement-ui-formats`), la moyenne et l'écart-type avec une décimale.
