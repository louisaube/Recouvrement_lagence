# Lot du jour (`/lot-du-jour`) : état réalisé

Profil Superviseur seulement (`RequireProfile profiles={['supervisor']}` dans `App.tsx`). Code : `features/batches/pages/DailyBatchPage.tsx`, `components/{BatchOrders,ReleaseDialog}.tsx`, libellés dans `shared/recouvrementLabels.ts`. Plan : `lot-du-jour-page-implementation-plan.md`. API : `/daily-batches` (voir `module-recouvrement.summary.md`). L'écran est la porte d'entrée de `rule-recouvrement-screen-batch` (user) : préparation, contrôles, blocages, libération.

## Ce qui existe
- Titre « Lot du jour » et bouton « Préparer le lot du jour » (« Préparation en cours… » pendant l'appel). Désactivé quand le lot affiché est `ready`. Le lot du jour est le plus récent de la liste si sa date est celle d'aujourd'hui (Europe/Paris) ; sinon la fiche indique « Pas encore préparé ».
- Fiche « Lot du JJ/MM/AAAA » avec pastille de statut (Prêt, Bloqué, Remplacé, ou « Pas encore préparé »), « Préparé par <e-mail> » et la mention « Libéré, le lot est seulement marqué prêt : aucun envoi n'existe dans cette version. » Aucun bouton « Envoyer » (`rule-recouvrement-screen-batch-no-send`, user). Pour un lot bloqué du jour : « Une nouvelle préparation remplace le lot bloqué. »
- Les pastilles et boutons suivent le statut renvoyé par l'API ; le studio ne recalcule ni contrôle ni part (`rule-recouvrement-screen-batch-states`, inferred).
- **Notification après préparation** : « Lot du jour prêt. » ou « Le lot du jour est bloqué : N contrôle(s) en échec. », complété par « Une alerte a été ajoutée à la file de décisions. » quand le contrôle des parts échoue.
- **Contrôles** (section « Contrôles ») : les quatre, « Relevé bancaire frais », « Dossiers témoins rejoués sans écart », « Part de chaque type de décision dans la limite », « Aucun ordre en double (dossier, type, jour) », chacun « Réussi » ou « Échec » avec ses problèmes en texte brut.
- **Parts** (« Parts par type de décision ») : tableau Type, Dossiers, Part, Mode (« Plafond fixe » ou « Statistique »), Moyenne, Écart-type, Limite, État (« Dans la limite » / « Hors limite »). Moyenne, écart-type et seuil à une décimale ; tirets en mode plafond fixe.
- **Dossiers exclus** : tableau Raison / Nombre (Pièce exigée absente, Canal suspendu, Canal non autorisé, Aucun interlocuteur joignable, Dossier gelé, Relevé périmé, Part couverte par une sortie comptable) ; vide : « Aucun dossier exclu. ».
- **Ordres d'envoi** : données structurées, jamais un texte de message (`rule-recouvrement-screen-batch-no-text`, user). Filtres « Type » (Relance, Proposition, Confirmation d'engagement) et « Canal » ; colonnes Dossier, Interlocuteur (rôle), Canal, Type, Conditions (liste « nom : valeur »), Statut (Prévu, Bloqué, Annulé, avec la raison du blocage). Chaque dossier est un lien « Ouvrir le dossier <identifiant> » vers `/dossiers/<id>` (`rule-recouvrement-screen-batch-link-case`, inferred). Vide : « Aucun ordre dans ce lot. ».
- **Libération** : pour un lot bloqué du jour, bouton « Libérer le lot malgré le blocage » ; dialogue « Libérer le lot » (rappel que les contrôles en échec restent affichés et que l'action est tracée), champ « Motif de la libération » obligatoire, 1000 caractères au plus avec compteur ; sans motif aucun appel n'est envoyé (`rule-recouvrement-screen-batch-blocked-needs-reason`, user). Succès : « Lot libéré. ». Un lot libéré affiche « Libéré par <e-mail> le <date et heure>. Motif : … » et garde ses contrôles en échec.
- **Historique des lots** : tableau Date, Statut, Dossiers, Ordres, Contrôles en échec, Préparé par, Actions ; lots remplacés grisés ; vide : « Aucun lot pour le moment. ». Le bouton « Ouvrir le lot du JJ/MM/AAAA » charge un lot passé par `?lot=<id>` ; en consultation d'un lot passé, ni préparation ni libération, et « Revenir au lot du jour » retire le paramètre. Un identifiant inconnu ou mal formé retire le paramètre et revient au jour.
- **Erreurs** : `batches.no_active_policy` → « Aucune version de politique n'est active. Activez-en une depuis l'écran Politique. » (lien) ; `batches.already_released` → « Le lot du jour est déjà préparé. » (liste rechargée) ; `batches.not_releasable` → « Ce lot ne peut plus être libéré. » ; autres échecs : message générique, avec « Réessayer » sur les chargements.

## Règles d'API exercées
`rule-recouvrement-batch-prepared-by-supervisor`, `-batch-brain-decides`, `-batch-release-mode`, `-batch-blocked-release-by-decision`, `-batch-auto-stop`, `-batch-orders-structured`, `-batch-one-per-day` (voir `module-recouvrement.summary.md`).

## Limites connues
- La fiche dossier (`/dossiers/<id>`) n'est pas construite : les liens des ordres retombent sur l'accueil.
- Aucun envoi, aucune file d'envoi, aucune action sur un ordre isolé ; « Prêt » est un marquage.
- Aucun ordre de confirmation d'engagement n'apparaît tant que les engagements n'existent pas (lot des outils des agents) ; le filtre « Type » le propose déjà.
- La raison d'exclusion « Part couverte par une sortie comptable » ne peut pas apparaître avant le lot des sorties comptables.
- Pas d'actualisation automatique ; l'historique est rechargé après chaque préparation ou libération.
