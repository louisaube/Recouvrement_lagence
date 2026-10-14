# Imports (`/imports`) : état réalisé

Profil Superviseur seulement. Code : `features/imports/pages/ImportsPage.tsx`, `components/{RecoveryImportTab,PolicyImportFlow,ImportReport,StatementBanner,ImportHistory}.tsx`, `hooks/useRecoveryImportApi.ts`, parcours générique `shared/import/`. Plan : `imports-page-implementation-plan.md`.

## Ce qui existe
- Titre « Imports », bandeau du relevé bancaire (`rule-recouvrement-import-statement-banner`, user) : « Relevé bancaire frais : relevé du JJ/MM/AAAA » ou « Relevé bancaire périmé ou absent : aucune offre ni aucun ordre d'envoi tant qu'un relevé frais n'est pas confirmé. » (`GET /recovery-imports/status`).
- Liste d'onglets « Fichiers à importer » : Créances, Paiements, Litiges, Interlocuteurs, Pièces, Politique, portée par `?fichier=` (`creances` par défaut). Les six fichiers, l'aperçu, les erreurs, le rapport et le feu vert (`rule-recouvrement-screen-imports`, user). Changer d'onglet vide le parcours, total de contrôle compris (`rule-recouvrement-import-tab-reset`, inferred). Sous les cinq onglets de tableur : « Dernier import : JJ/MM/AAAA HH:mm, <fichier> » ou « Aucun import confirmé. ».
- Le parcours en trois étapes du socle est réutilisé et étendu par propriétés (`rule-recouvrement-import-flow-reuse`, inferred) ; le navigateur ne lit pas le fichier.
- **Créances** : champ « Total de contrôle (€) » obligatoire avant dépôt (« Saisissez le total de contrôle avant de déposer le fichier. »), envoyé en paramètre `controlTotal`. Résumé avec « Total des soldes du fichier » et « Total de contrôle saisi ». Créances et Paiements : bandeau « Fichier refusé en entier : la première erreur suffit. … » et feu vert désactivé.
- **Rapport d'écarts** avant le feu vert (`rule-recouvrement-import-report-before-green-light`, user) : légende « Comparé à l'import du … » ou « Aucun import précédent : tout est nouveau. », catégories avec « Voir le détail : <libellé> » (liste paginée « Clé », « Débiteur », « Détail »), notes. Texte affiché en brut (`rule-recouvrement-ui-plain-text`, inferred).
- **Feu vert** : « Donner le feu vert (N lignes) », dialogue « Confirmer le feu vert » (un seul envoi : `rule-recouvrement-import-confirm-once`, inferred), résultat « N ligne(s) importée(s). », liste « Effets », avertissement des lignes ignorées, lien « File de décisions ». Après confirmation : bandeau, « Dernier import » et historique rechargés (`rule-recouvrement-import-reload-after-confirm`, inferred).
- **Politique** (`rule-recouvrement-import-policy-flow`, inferred) : dépôt `.json`, aperçu (validité, erreurs « Chemin » / « Raison », « Contrôles d'activation », « Dossiers témoins »), feu vert qui crée une version « Importée » non active avec lien « Ouvrir la version » vers `/politique?version=<id>`.
- « Historique des imports » : filtre « Type de fichier », colonnes Date, Fichier, Type, Confirmé par, Lignes, Importées, Ignorées ; vide : « Aucun import confirmé pour le moment. ».
- Messages propres : `imports.control_total_required|invalid`, `imports.file_refused`, `imports.stale_extraction`, `policies.invalid_file_type|file_too_large|already_imported|invalid_file|preview_not_found`.

## Règles d'API exercées
`rule-recouvrement-import-green-light`, `-import-refuse-whole`, `-import-report`, `-receivables-control-total`, `-statement-fresh`, `-lettrage-*`, `-disputes-import-freeze` (voir `module-recouvrement.summary.md`).

## Limites connues
- Le lien « File de décisions » du résultat mène à l'accueil : l'écran n'est pas construit dans ce lot.
- Un relevé sans aucun mouvement ne peut pas être déposé (le socle refuse un fichier sans ligne de données).
- Pas d'édition de fichier ni de double validation : la trace d'audit suffit.
