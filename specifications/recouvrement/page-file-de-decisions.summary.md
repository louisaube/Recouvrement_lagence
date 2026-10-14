# File de décisions (`/file-de-decisions`) : état réalisé

Profil Superviseur seulement (`RequireProfile profiles={['supervisor']}` dans `App.tsx`). Code : `features/decisions/pages/DecisionQueuePage.tsx`, `components/DecisionDialog.tsx` (contient aussi `DecisionReview`), libellés dans `shared/recouvrementLabels.ts` (`QUEUE_TYPES`, `queueTypeLabel`, `queueDecisionLabel`). Plan : `file-de-decisions-page-implementation-plan.md`. API : `/decision-queue` (voir `module-recouvrement.summary.md`). Relevé à la lecture du code, sans exécution des suites ni du navigateur. Le studio n'est pas commité à ce jour.

## Ce qui existe
- Titre « File de décisions » ; onglets « Ouverts (N) » (N lu dans `GET /decision-queue/counts`) et « Décidés » ; filtre « Type » (« Tous » et les dix types, chacun suivi de son nombre d'éléments ouverts). Changer d'onglet ou de type recommence la liste à la première page. Le studio ne code que les libellés des types et des décisions ; un code inconnu s'affiche tel quel (`rule-recouvrement-screen-queue-no-local-rules`, inferred).
- **Adresse** : `?statut=ouverts|decides` et `?type=<type>` permettent d'arriver filtré ; une valeur invalide est ignorée et retirée de l'adresse (`rule-recouvrement-screen-queue-deep-link`, inferred).
- **Liste** (`GET /decision-queue/items`) : ouverts, colonnes Type, Dossier, Résumé, Ouvert le, Actions, du plus ancien au plus récent ; décidés, colonnes Type, Dossier, Résumé, Décision, Décidé par (« le système » pour une clôture automatique), Décidé le, Actions, du plus récent au plus ancien (`rule-recouvrement-queue-order`, user). Le dossier est un lien « Ouvrir le dossier <identifiant> » vers `/dossiers/<id>`, un tiret sans dossier. Bouton « Décider : <résumé> » (ouverts) ou « Voir : <résumé> » (décidés). Vide : « Rien n'attend de décision. », « Aucune décision enregistrée pour le moment. » ou « Aucun élément de ce type. ».
- **Texte brut** : résumés, détails et motifs ne sont jamais rendus comme du HTML (`rule-recouvrement-screen-queue-summary-plain`, inferred).
- **Dialogue « Décision »** (élément ouvert) : résumé, tableau « Détail » (libellé / valeur), choix de la décision parmi exactement `allowedDecisions` de l'élément (`rule-recouvrement-screen-queue-no-local-rules`) ; « Acquitter » pour une alerte, « Prendre acte » pour tout autre élément (`rule-recouvrement-screen-queue-label-by-type`, inferred) ; champ « Motif de la décision » obligatoire, 1000 caractères au plus avec compteur (`rule-recouvrement-screen-queue`, user ; `rule-recouvrement-queue-decision-motivated`, user). « Enregistrer la décision » reste désactivé sans décision ni motif. Plein écran sur petit écran. Un choix qui n'est plus permis après rechargement est retiré.
- **Affectation d'un paiement non affecté** : la décision « Affecter à une facture » fait apparaître « Rechercher une facture par numéro » (`GET /invoices`, 10 résultats, après 300 ms) et la liste « Facture à créditer » (candidates de l'élément, puis résultats de la recherche), libellée « numéro · SIREN · solde » ; sans facture choisie, l'enregistrement reste désactivé (`rule-recouvrement-screen-queue-assign-needs-invoice`, inferred). Recherche en échec : « La recherche a échoué. Veuillez réessayer. ».
- **Élément décidé** : le bouton « Voir » ouvre le dialogue « Décision » en lecture seule : résumé, détail, décision, motif, « Décidé par <e-mail> le <date et heure> », bouton « Fermer ».
- **Enregistrement** (`POST /decision-queue/items/{id}/decision`) : succès, « Décision enregistrée. », liste et compteurs rechargés. Erreurs : `queue.already_decided` → « Cet élément a déjà été décidé. La liste a été rechargée. » (dialogue fermé) ; `queue.decision_not_allowed` → « Cette décision n'est pas permise pour cet élément. » (liste rechargée, dialogue ouvert avec l'élément frais) ; `queue.invoice_not_open` → « Cette facture n'est pas ouverte. Choisissez-en une autre. » ; 400 → « Données invalides. Vérifiez les champs. » ; 403 → « Action non autorisée. » ; autres → « Une erreur est survenue. Veuillez réessayer. ».
- **Retour à la dernière page** : si la dernière décision d'une dernière page la vide, la liste recule à la nouvelle dernière page.

## Accès depuis les autres écrans
- Onglet « File de décisions » de la barre « Recouvrement » (`AppLayout.tsx`) ; carte « File de décisions : N à traiter » de l'accueil ; bouton vers `/file-de-decisions` de l'écran Imports (`RecoveryImportTab.tsx`).

## Règles d'API exercées
`rule-recouvrement-queue-contents`, `-queue-order`, `-queue-allowed-decisions`, `-queue-decision-motivated`, `-queue-decided-final`, `-queue-effects`, `-family-transfer-never-executed` (voir `module-recouvrement.summary.md`).

## Limites connues
- La fiche dossier (`/dossiers/<id>`) n'est pas construite : les liens de la colonne Dossier retombent sur l'accueil.
- Pas d'actualisation automatique : la liste et les compteurs sont rechargés après chaque décision ou au changement d'onglet ou de filtre.
- La décision « Remettre en attente de constatation » (sortie comptable en écart) clôt l'élément sans effet tant que les sorties comptables n'existent pas.
- Pas de test navigateur relu pour cet écran dans ce relevé.
