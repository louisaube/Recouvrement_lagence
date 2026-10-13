# Écran Imports : plan de réalisation

Objet : le superviseur charge chacun des six fichiers d'entrée (Créances, Paiements, Litiges, Interlocuteurs, Pièces, Politique), lit l'aperçu, les erreurs et le rapport d'écarts avec l'import précédent du même type, puis donne le feu vert. Chemin `/imports` (paramètre `?fichier=creances|paiements|litiges|interlocuteurs|pieces|politique`, `creances` par défaut), accès : profil Superviseur. Le parcours en trois étapes est le parcours générique du socle (`studio/src/app/shared/import/`), étendu.

## Parcours
1. Le superviseur ouvre `/imports`. En haut, l'état du relevé bancaire ; dessous, une rangée d'onglets (un par fichier) ; dessous, le parcours d'import du fichier choisi ; en bas, l'historique.
2. **Étape 1, dépôt** (tableurs) : panneau « Colonnes attendues » du fichier (spécification de l'API). Pour Créances, le superviseur saisit d'abord « Total de contrôle (€) », puis dépose le fichier ; sans total, aucun envoi : message « Saisissez le total de contrôle avant de déposer le fichier. ». Le dépôt lance l'analyse (barre de progression, « Annuler »). Fichier refusé : retour au dépôt avec le message de refus.
3. **Étape 2, aperçu** : résumé (lignes lues, valides, en erreur, « Rien n'a encore été enregistré. »), erreurs paginées, puis « Rapport d'écarts » (nouveau, soldé, modifié, disparu selon le fichier). Pour Créances et Paiements, la première erreur refuse tout le fichier : un bandeau l'indique et le feu vert est désactivé.
4. **Étape 3, feu vert** : bouton « Donner le feu vert » (avec le nombre de lignes), dialogue de confirmation, puis résultat : lignes importées, effets (dossiers créés, soldés, paiements affectés ou non affectés, éléments de file ouverts), avertissement des lignes ignorées.
5. **Politique** : dépôt d'un fichier `.json` ; l'aperçu montre la validité, les erreurs de format (chemin et raison), les six contrôles d'activation et les dossiers témoins ; le feu vert crée une version « Importée » (non active) et propose de l'ouvrir dans l'écran Politique.
6. États vides et erreurs : voir les tableaux ; l'historique vide dit « Aucun import confirmé pour le moment. ».

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Imports » | | |
| Bandeau de relevé | « Relevé bancaire frais : relevé du JJ/MM/AAAA » (succès) ou « Relevé bancaire périmé ou absent : aucune offre ni aucun ordre d'envoi tant qu'un relevé frais n'est pas confirmé. » (avertissement, avec la date du dernier relevé si elle existe et la fraîcheur maximale) | recalculé après chaque confirmation de Paiements | `GET /recovery-imports/status` |
| Dernier import par type | « Dernier import : JJ/MM/AAAA HH:mm, <nom du fichier> » sous chaque onglet, « Aucun import confirmé. » sinon | | `GET /recovery-imports/status` (`lastConfirmed`) |
| Onglets | liste d'onglets nommée « Fichiers à importer » : « Créances », « Paiements », « Litiges », « Interlocuteurs », « Pièces », « Politique » | l'onglet actif est porté par `?fichier=` ; changer d'onglet abandonne l'aperçu en cours sans message | |
| Champ (Créances) | « Total de contrôle (€) » | obligatoire avant dépôt ; aide : « Solde du compte clients à la date d'extraction, tel que l'outil comptable le donne. » ; accepte `1 234 567,89` ; validation locale : non vide, motif de `controlTotal` ; envoyé tel quel (rogné) dans la partie `controlTotal` | `POST /recovery-imports/receivables/preview` |
| Zone de dépôt | « Glissez un fichier .xlsx ou .csv ici » (Politique : « Glissez un fichier .json ici ») ; bouton « Choisir un fichier » ; champ caché de nom accessible « Fichier à importer » | comme le socle (un seul fichier, contrôles locaux d'extension, de taille et de fichier vide) | `POST .../preview` ; Politique : `POST /policy-versions/previews` |
| Panneau | « Colonnes attendues » | texte et tableau du socle ; mention supplémentaire pour Créances et Paiements : « Ce fichier est refusé en entier dès la première erreur. » ; pour Politique le panneau est remplacé par « Fichier JSON : décision JDM, paramètres et dossiers témoins (2 Mo au maximum). » | `GET /recovery-imports/{type}/specification` |
| Résumé de l'aperçu | « Lignes lues : T », « Lignes valides : V », « Lignes en erreur : E », « Rien n'a encore été enregistré. » | formats français ; Créances ajoute « Total des soldes du fichier : X » et « Total de contrôle saisi : Y » (en rouge si différents) | `RecoveryImportPreviewDto` |
| Bandeau de refus | « Fichier refusé en entier : la première erreur suffit. Corrigez le fichier et déposez-le à nouveau. » | erreur ; affiché si `accepted` est faux pour Créances ou Paiements ; le tableau d'erreurs montre l'unique erreur | |
| Tableau | « Lignes en erreur » | colonnes « Ligne », « Colonne », « Raison » ; comme le socle (pagination 10 / 25 / 50) | `GET .../{importId}/errors` |
| Rapport | « Rapport d'écarts » | voir ci-dessous | `GET .../{importId}/report` |
| Légende du rapport | « Comparé à l'import du JJ/MM/AAAA (<fichier>) » ou « Aucun import précédent : tout est nouveau. » | | idem (`previous`) |
| Lignes du rapport | une ligne par catégorie : libellé de l'API, « N ligne(s) », « M dossier(s) » ; bouton « Voir le détail : <libellé> » | ouvre la liste paginée (10 / 25 / 50) : colonnes « Clé », « Débiteur », « Détail » ; « Aucun élément. » si vide | `GET .../report/items?category=` |
| Notes du rapport | une ligne par note : libellé de l'API et nombre | masquées si aucune | `notes` |
| Bouton | « Donner le feu vert (N lignes) » | N = lignes valides ; désactivé avec « Aucune ligne valide : rien à importer. » si V = 0 ; désactivé si le fichier est refusé en entier | |
| Dialogue | titre « Donner le feu vert » ; texte « N ligne(s) seront importées. M ligne(s) en erreur seront ignorées et ne seront pas importées. Cette action est tracée au journal d'audit. » (deuxième phrase si M > 0 ; fichiers refusés en entier : « Le fichier sera importé en entier. ») ; boutons « Annuler » et « Confirmer le feu vert » | pendant l'envoi : boutons désactivés, « Import en cours… » ; une série de clics n'envoie qu'une requête | `POST .../{importId}/confirm` |
| Bouton | « Choisir un autre fichier » | retour au dépôt | |
| Résultat | alerte de succès « N ligne(s) importée(s). » ; liste « Effets » (libellé et nombre rendus par l'API) ; avertissement « M ligne(s) valide(s) à l'aperçu n'ont pas pu être enregistrées ou existaient déjà. » si `skippedCount` > 0 ; boutons « Importer un autre fichier » et lien « File de décisions » (vers `/file-de-decisions`) | | `RecoveryImportConfirmDto` |
| Aperçu de politique | bloc « Version « <libellé> » du JJ/MM/AAAA » avec « Empreinte : <12 premiers caractères> » ; liste « Contrôles d'activation » (six lignes : libellé du référentiel, « Réussi » ou « Échec », problèmes) ; tableau « Dossiers témoins » (« Identifiant », « Attendu », « Obtenu », « Résultat ») ; tableau « Erreurs du fichier » (« Chemin », « Raison ») si invalide | alerte d'avertissement si un contrôle échoue : « Des contrôles d'activation échouent : la version pourra être importée mais ne pourra pas être activée tant qu'ils échouent. » ; bouton « Donner le feu vert » désactivé avec « Fichier invalide : rien à importer. » si `valid` est faux | `PolicyPreviewDto` |
| Résultat de politique | « Version « <libellé> » importée. Elle n'est pas encore active. » et lien « Ouvrir la version » (vers `/politique?version=<id>`) | | `POST /policy-versions/previews/:previewId/confirm` |
| Historique | titre « Historique des imports » ; liste « Type de fichier » (« Tous », les cinq types) ; colonnes « Date », « Fichier », « Type », « Confirmé par », « Lignes », « Importées », « Ignorées » | pagination 10 / 25 / 50 ; rechargé après un feu vert | `GET /recovery-imports/history` |

### Messages de refus propres à cet écran (en plus de ceux de `importMessages.ts`)
| Réponse | Message |
|---|---|
| `400 imports.control_total_required` | « Saisissez le total de contrôle. » |
| `400 imports.control_total_invalid` | « Le total de contrôle est illisible. Exemple : 1 234 567,89. » |
| `409 imports.file_refused` | « Ce fichier est refusé en entier : corrigez-le et déposez-le à nouveau. » |
| `409 imports.stale_extraction` | « Un cliché plus récent a été confirmé entre-temps. Déposez à nouveau le fichier. » |
| `400 policies.invalid_file_type` | « Ce fichier n'est pas un fichier JSON valide. » |
| `413 policies.file_too_large` | « Le fichier est trop volumineux (maximum 2 Mo). » |
| `409 policies.already_imported` | « Cette version de politique a déjà été importée. » |
| `409 policies.invalid_file` | « Ce fichier de politique est invalide : corrigez les erreurs et déposez-le à nouveau. » |
| `404 policies.preview_not_found` | « L'aperçu a expiré ou n'existe plus. Déposez à nouveau le fichier. » |

## Règles
- `rule-recouvrement-screen-imports` (user) : l'écran Imports offre les six fichiers, l'aperçu, les erreurs, le rapport d'écarts et le feu vert.
- `rule-recouvrement-import-flow-reuse` (inferred) : le parcours générique du socle (`ImportFlow`) est réutilisé et étendu par des propriétés (libellés du bouton et du dialogue, champ supplémentaire avant dépôt, contenu supplémentaire de l'aperçu, mention de refus en entier) ; aucune règle de validation des cellules n'est codée dans le studio (`rule-foundation-import-no-client-parsing` : le navigateur ne lit pas le fichier ; seul le total de contrôle saisi est contrôlé localement).
- `rule-recouvrement-import-report-before-green-light` (user) : le rapport d'écarts est lu avant le feu vert, à partir de l'aperçu ; la confirmation vaut feu vert et n'est offerte qu'au superviseur.
- `rule-recouvrement-import-statement-banner` (user) : le bandeau de relevé reflète `fresh` ; un relevé périmé est signalé comme bloquant les offres et les ordres.
- `rule-recouvrement-import-reload-after-confirm` (inferred) : après un feu vert, le bandeau, le « Dernier import » et l'historique sont rechargés ; les compteurs de l'accueil le sont à la prochaine ouverture.
- `rule-recouvrement-import-tab-reset` (inferred) : changer d'onglet vide l'état du parcours ; le total de contrôle saisi n'est pas conservé.
- `rule-recouvrement-import-confirm-once` (inferred) : une série de clics sur « Confirmer le feu vert » n'envoie qu'une requête, comme le dialogue de confirmation du socle (`specifications/socle/70-ecrans.md` §7, étape 3).
- `rule-recouvrement-import-policy-flow` (inferred) : l'onglet Politique reprend les trois étapes avec ses routes propres (`politiques-api-modification-request.md`) ; l'aperçu de politique ne pagine pas ses erreurs (100 au plus).

## Accès
Profil Superviseur seulement. Les autres profils voient « Accès refusé » à `/imports` ; aucune route d'import n'est appelée.

## Hypothèses
- Le superviseur saisit le total de contrôle avant le dépôt, car l'analyse en a besoin (contrôle bloquant du fichier Créances).
- Le fichier Politique n'a pas de panneau de colonnes : son format est décrit par `politiques-api-modification-request.md` et par la documentation hors écran.
- Le bouton « Donner le feu vert » ne fait aucune confirmation par e-mail ni double validation : la trace d'audit suffit.
- Un relevé sans aucun mouvement ne peut pas être déposé (le socle refuse un fichier sans ligne de données) ; hors demande de cette version.
