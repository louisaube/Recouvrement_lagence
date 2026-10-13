# Écran File de décisions : plan de réalisation

Objet : le superviseur voit tout ce qui l'attend (contestations, montants au-delà du seuil, échelles épuisées, paiements non affectés, sorties comptables en écart, prescriptions proches ou échues, alertes, demandes d'intervention humaine, transferts proposés) et tranche chaque élément par une décision motivée. Chemin `/file-de-decisions` (paramètres `?statut=ouverts|decides`, `?type=`), accès : profil Superviseur.

## Parcours
1. Le superviseur ouvre l'écran : onglet « Ouverts » (du plus ancien au plus récent), compteurs par type.
2. Il choisit un élément (« Décider : <résumé> ») : le dialogue montre le résumé, le détail, les décisions permises ; il choisit une décision, écrit le motif, enregistre.
3. Pour un paiement non affecté, il choisit la facture à laquelle l'affecter parmi les propositions ou en cherchant par numéro.
4. L'élément passe à l'onglet « Décidés » où il se relit (décision, motif, auteur, date).
5. Erreurs et états vides : voir les tableaux.

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « File de décisions » | | |
| Onglets | liste d'onglets « Statut des éléments » : « Ouverts (N) », « Décidés » | N = total des éléments ouverts ; porté par `?statut=` | `GET /decision-queue/counts` |
| Filtre | liste « Type » : « Tous » puis les dix types avec leur compteur d'éléments ouverts, par exemple « Paiement non affecté (3) » ; types : Contestation, Montant au-delà du seuil, Échelle épuisée, Paiement non affecté, Sortie comptable en écart, Prescription proche, Prescription échue, Alerte, Demande d'intervention humaine, Transfert proposé | porté par `?type=` ; recharge à la première page | `GET /decision-queue/items?type=` |
| Tableau | colonnes « Type » (pastille), « Dossier » (lien « Ouvrir le dossier <identifiant client> » ou « — »), « Résumé » (texte de l'API, tronqué avec infobulle), « Ouvert le » ; onglet « Décidés » : « Décision », « Décidé par », « Décidé le » | pagination 10 / 25 / 50 ; ouvert : du plus ancien ; décidé : du plus récent | `GET /decision-queue/items?status=` |
| Action | bouton « Décider : <résumé> » (onglet « Ouverts ») ; « Voir : <résumé> » (onglet « Décidés ») | ouvre le dialogue | |
| Dialogue de décision | titre « Décision » ; le résumé ; tableau « Détail » (libellé : valeur, texte de l'API) ; groupe de boutons radio « Décision » (une option par décision permise, libellés du référentiel §4 : « Prendre acte », « Acquitter », « Autoriser la négociation », « Transférer à l'étape suivante », « Maintenir le dossier », « Affecter à une facture », « Remettre en attente de constatation », « Rendre le dossier au cerveau », « Approuver le transfert », « Refuser le transfert ») ; zone de texte « Motif de la décision » (obligatoire, 1 à 1 000 caractères, compteur) ; boutons « Annuler » et « Enregistrer la décision » | aucune décision préchoisie ; « Enregistrer la décision » désactivé tant qu'une décision et un motif manquent | `POST /decision-queue/items/:id/decision` |
| Choix de facture (paiement non affecté, décision « Affecter à une facture ») | groupe radio « Facture à créditer » : propositions (« <numéro> · <SIREN de l'entité> · solde <montant> ») ; champ « Rechercher une facture par numéro » (préfixe, 1 caractère au moins) listant jusqu'à 10 résultats | facture obligatoire pour « Affecter à une facture », absente pour les autres décisions | `candidates` ; `GET /invoices?number=` |
| Dialogue de relecture (onglet « Décidés ») | résumé, détail, « Décision : <libellé> », « Motif : <texte> », « Décidé par <e-mail> (ou « le système » pour une clôture automatique) le JJ/MM/AAAA HH:mm » ; bouton « Fermer » | lecture seule | `QueueItemDto.decision` |
| Listes vides | « Ouverts » : « Rien n'attend de décision. » ; « Décidés » : « Aucune décision enregistrée pour le moment. » ; avec filtre : « Aucun élément de ce type. » | | |

### Résultats et erreurs
| Réponse | Message |
|---|---|
| `200` | notification « Décision enregistrée. » ; dialogue fermé ; liste et compteurs rechargés |
| `409 queue.already_decided` | « Cet élément a déjà été décidé. La liste a été rechargée. » |
| `409 queue.decision_not_allowed` | « Cette décision n'est pas permise pour cet élément. » ; le dialogue se recharge |
| `409 queue.invoice_not_open` | « Cette facture n'est pas ouverte. Choisissez-en une autre. » |
| `400` | « Données invalides. Vérifiez les champs. » |
| autres | `rule-foundation-api-failure-handling` |

## Règles
- `rule-recouvrement-screen-queue` (user) : l'écran File de décisions liste les éléments du superviseur et lui permet de les trancher ; chaque décision est motivée.
- `rule-recouvrement-screen-queue-no-local-rules` (inferred) : les décisions proposées sont exactement `allowedDecisions` de l'élément ; le studio ne code ni types ni décisions permises au-delà de leurs libellés (`labels.ts`) ; un code inconnu s'affiche tel quel.
- `rule-recouvrement-screen-queue-assign-needs-invoice` (inferred) : un paiement non affecté ne se règle que par l'affectation à une facture choisie par le superviseur ; sans facture choisie, « Enregistrer la décision » reste désactivé.
- `rule-recouvrement-screen-queue-label-by-type` (inferred) : la décision `acknowledge` s'affiche « Acquitter » pour une alerte et « Prendre acte » pour tout autre type.
- `rule-recouvrement-screen-queue-summary-plain` (inferred) : résumés, détails et motifs sont du texte brut (`rule-recouvrement-ui-plain-text`).
- `rule-recouvrement-screen-queue-deep-link` (inferred) : `?type=` et `?statut=` permettent d'arriver filtré depuis l'accueil ; une valeur invalide est ignorée et retirée de l'adresse.

## Accès
Profil Superviseur seulement ; les autres voient « Accès refusé ».

## Hypothèses
- Le dialogue ne présente que les décisions permises par l'API ; l'effet de chaque décision (transition d'état, affectation) se lit ensuite sur la fiche du dossier.
- Aucun filtre par dossier ou par date dans cette version ; la file est triée par ancienneté.
