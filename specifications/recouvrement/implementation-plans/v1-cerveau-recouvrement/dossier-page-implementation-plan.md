# Écran Fiche dossier : plan de réalisation

Objet : le superviseur lit tout ce qui définit un dossier : état, factures, gels, offres débloquées, engagements, sorties comptables, décisions du cerveau avec leur motif interne, historique des états ; il peut proposer un passage en perte. Chemin `/dossiers/:id`, accès : profil Superviseur. Seul écran où le motif interne d'une décision (règle, version de politique, montants de référence) est lisible.

## Parcours
1. Depuis la liste, la file, un ordre de lot ou une sortie comptable, le superviseur ouvre la fiche.
2. En haut, le résumé ; dessous, sept sections empilées, chacune avec son titre : Factures, Gels, Offres débloquées, Engagements, Sorties comptables, Décisions du cerveau, Historique des états. Une barre de liens d'ancre nommée « Sections de la fiche » permet d'y sauter.
3. Dans « Factures », le superviseur peut ouvrir « Proposer un passage en perte », choisir des factures et des montants, saisir un motif, enregistrer ; la sortie naît « À approuver » (écran Sorties comptables).
4. Dans « Décisions du cerveau », une ligne se déplie pour montrer les entrées complètes et le motif interne.
5. Erreurs : `404 repository.not_found` ou identifiant mal formé : « Ce dossier n'existe pas. » avec le lien « Retour aux dossiers » ; autres : message générique et « Réessayer » par section (une section en échec ne vide pas les autres).

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Retour | « Dossiers » (flèche) | vers `/dossiers` en conservant les filtres de la liste si l'on vient d'elle | |
| Titre | « Dossier <identifiant client> » | pastilles : état, nature, segment | `GET /cases/:id` |
| Résumé | « Montant négociable », « Solde ouvert », « Factures ouvertes », « Entités créancières », « SIREN du débiteur » (entreprise seulement), « Version de politique active » | | idem |
| Alerte | « Ce dossier a N élément(s) ouvert(s) dans la file de décisions. » avec le lien « File de décisions » (vers `/file-de-decisions`) | affichée si N > 0 | `openQueueItems` |
| Section | « Factures » : « Pièce » (Facture / Avoir), « Numéro », « Entité créancière », « Montant », « Solde », « Date de facture », « Échéance », « Retard (jours) », « Situation » (« Négociable », « Gelée », « Prescription proche », « Prescrite »), « Couvert par une sortie » | une facture gelée est grisée avec le motif du gel en infobulle ; un avoir est affiché avec son solde négatif | `invoices` |
| Bouton | « Proposer un passage en perte » | ouvre le dialogue ; absent si le dossier est « Soldé » | |
| Dialogue | titre « Proposer un passage en perte » ; tableau des factures ouvertes avec case « Inclure la facture <numéro> » et champ « Montant à passer en perte (€) » (≤ solde) ; zone « Motif du passage en perte » (obligatoire, 1 à 500 caractères) ; boutons « Annuler » et « Proposer le passage en perte » | validation locale : au moins une facture, montants > 0 et ≤ solde, motif non vide | `POST /ledger-outputs/write-offs` |
| Section | « Gels » : « Type » (« Litige », « Contestation », « Paiement non affecté »), « Portée » (« Facture <numéro> » / « Dossier »), « Depuis le », « Référence » | « Aucun gel. » si vide | `freezes` |
| Section | « Offres débloquées » : « Débloquée le », « Statut » (En cours, Remplacée, Acceptée, Révoquée), « Total », « Remise », « Échéances » (date : montant), « Contrepartie » (Date ferme le JJ/MM/AAAA, Premier versement de X, Prélèvement, Aucune) | « Aucune offre débloquée. » si vide | `unlockedOffers` |
| Section | « Engagements » : « Pris le », « Statut » (En cours, Tenu, Rompu), « Montant », « Remise », « Moyen de paiement », « Échéances » (date : montant, payé), « Canal », « Version d'agent » | « Aucun engagement. » si vide | `commitments` |
| Section | « Sorties comptables » : « Référence », « Type », « Statut », « Montant », « Créée le » | « Aucune sortie comptable. » ; lien « Sorties comptables » | `ledgerOutputs` |
| Section | « Décisions du cerveau » : « Date », « Type de décision » (Action du jour, Offre, Contrôle d'engagement, Seuil, Prescription, Plafond d'encours), « Résultat », « Règle appliquée », « Version de politique », « Probabilité » ; bouton de dépliage « Voir le motif interne de la décision du JJ/MM/AAAA HH:mm » : tableaux « Entrées » (nom : valeur) et « Motif interne » (nom : valeur) | pagination 10 / 25 / 50 ; « Aucune décision. » si vide ; probabilité affichée `1` tant qu'elle vaut 1 | `GET /cases/:id/decisions` |
| Section | « Historique des états » : « Date », « De », « Vers », « Cause », « Acteur », « Référence » | pagination 10 / 25 / 50 ; la première ligne a « De » vide (« — ») ; causes en français (Import, Offre débloquée, Engagement inscrit, Engagement tenu, Engagement rompu, Contestation, Litige ouvert, Paiement non affecté, Toutes les factures gelées, Gel levé, Élément de file ouvert, Élément de file décidé, Transfert approuvé, Solde apuré) | `GET /cases/:id/state-history` |

### Résultats et erreurs du passage en perte
| Réponse | Message |
|---|---|
| `201` | notification « Passage en perte <référence> proposé. À approuver dans Sorties comptables. » ; fiche rechargée |
| `409 ledger.amount_exceeds_balance` | « Le montant dépasse le solde disponible de la facture <numéro>. » sous le champ concerné si l'API l'indique, sinon en alerte du dialogue |
| `409 ledger.case_settled` | « Ce dossier est soldé. » |
| `404` | « Facture introuvable. Rechargez la fiche. » |
| `400` | « Données invalides. Vérifiez les champs. » |

## Règles
- `rule-recouvrement-screen-case-sheet` (user) : la fiche montre l'état, les factures, les gels, les offres débloquées, les engagements, les sorties comptables et les décisions avec leur motif interne.
- `rule-recouvrement-screen-case-internal-reason` (user) : le motif interne (règle, version de politique, montants de référence) n'est affiché que dans cette fiche ; la relecture ne montre, après la réponse du superviseur, que l'action et la règle du cerveau ; aucune autre vue du studio et aucune réponse d'agent n'en porte.
- `rule-recouvrement-screen-case-transitions-visible` (user) : chaque transition d'état figure dans l'historique avec sa cause et son acteur.
- `rule-recouvrement-screen-case-frozen-visible` (user) : une facture gelée est signalée comme telle et son motif est lisible ; les gels de dossier sont listés.
- `rule-recouvrement-screen-case-write-off` (inferred) : le passage en perte se propose depuis la fiche ; la sortie créée suit l'approbation par lot ; le studio ne contrôle que les bornes locales, l'API décide.
- `rule-recouvrement-screen-case-sections-independent` (inferred) : chaque section se charge et échoue indépendamment (les décisions et l'historique sont paginés par leurs propres routes).

## Accès
Profil Superviseur seulement ; les autres profils voient « Accès refusé ». Le service litiges lit les dossiers concernés par ses litiges dans l'écran Litiges, pas ici.

## Hypothèses
- La fiche n'affiche pas les interlocuteurs ni leurs coordonnées (hors demande) ; ni la liste des conversations ou des appels d'agents, qui sont journalisés mais lisibles seulement par le journal d'audit.
- Les entrées d'une décision sont affichées en texte brut, valeurs formatées par l'API (`inputs`, `internalReason`).
- Le dernier état connu est celui du dossier à l'ouverture de la page ; la page ne se rafraîchit pas seule.
