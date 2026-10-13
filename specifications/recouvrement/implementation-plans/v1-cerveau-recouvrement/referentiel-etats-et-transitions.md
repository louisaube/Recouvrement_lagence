# Référentiel des états, des transitions et du vocabulaire : version `v1-cerveau-recouvrement`

Livrable de la version (« Le référentiel des états et des transitions permises est un livrable de la version », `rule-recouvrement-case-state-referential`). Les plans de page et les demandes d'API s'y réfèrent ; les codes sont ceux de l'API (anglais, stables), les libellés sont ceux du studio (français). Toute valeur numérique (délais, seuils, taux, montants) vient de la politique ou d'un fichier importé : ce document n'en fixe aucune.

## 1. États du dossier

| Code API | Libellé | Sens |
|---|---|---|
| `open` | Ouvert | Au moins une facture ouverte négociable, aucune négociation en cours |
| `negotiating` | En négociation | Au moins une offre a été débloquée et aucun engagement n'est en cours |
| `committed` | Engagé | Un engagement est en cours (non tenu, non rompu) |
| `frozen` | Gelé | Négociation arrêtée : un gel de dossier est actif, ou toutes les factures ouvertes sont gelées |
| `supervisor_queue` | En file du superviseur | Un élément de file attend une décision du superviseur sur ce dossier |
| `transferred` | Transféré à l'étape suivante | Étape suivante décidée (recouvreur externe, contentieux ou cession) ; état final |
| `settled` | Soldé | Plus aucune facture ouverte (soldes tous nuls ou factures absentes du dernier cliché) ; état final |

`transferred` et `settled` sont finaux : aucun événement n'en fait sortir un dossier, sauf la réapparition d'une facture ouverte du même débiteur dans un import de créances, qui rouvre un dossier `settled` (transition `settled → open`, cause `import`). Un dossier `transferred` ne rouvre jamais.

### Précédence quand plusieurs conditions sont vraies
L'état stocké est recalculé après chaque événement ; la première condition vraie de la liste l'emporte :
1. `settled` ; 2. `transferred` ; 3. `frozen` ; 4. `supervisor_queue` ; 5. `committed` ; 6. `negotiating` ; 7. `open`.
Exemple : un dossier engagé qui reçoit une contestation passe à `frozen` ; quand le gel tombe, il revient à `committed` si l'engagement est toujours en cours.

## 2. Transitions permises

Toute transition est journalisée (table d'historique du dossier : instant, état de départ, état d'arrivée, cause, acteur, référence) et affichée sur la fiche. Une transition absente du tableau est interdite et n'est jamais produite.

| De | Vers | Cause (`cause`) | Acteur | Condition |
|---|---|---|---|---|
| (création) | `open` | `import` | import de créances | Débiteur nouveau avec une facture ouverte |
| `settled` | `open` | `import` | import de créances | Facture ouverte réapparue |
| `open` | `negotiating` | `offer_unlocked` | agent | Première offre rendue par l'outil « offre suivante » |
| `negotiating` | `committed` | `commitment_registered` | agent | Engagement inscrit |
| `committed` | `open` | `commitment_broken` | cerveau | Déchéance : versement manqué à sa date ; les concessions de l'engagement tombent |
| `committed` | `open` | `commitment_held` | cerveau | Engagement tenu, il reste des factures ouvertes |
| `committed` | `settled` | `commitment_held` | cerveau | Engagement tenu et plus aucune facture ouverte |
| `open`, `negotiating`, `committed` | `frozen` | `contestation`, `dispute_opened`, `unassigned_payment`, `all_invoices_frozen` | agent, service litiges, import, cerveau | Gel actif (voir §3) |
| `frozen` | état de précédence | `freeze_released` | service litiges, superviseur, import | Dernier gel levé |
| `open`, `negotiating`, `committed` | `supervisor_queue` | `queue_item_opened` | cerveau, agent | Élément de file ouvert sur le dossier (voir §4) |
| `supervisor_queue` | état de précédence | `queue_item_decided` | superviseur | Dernier élément du dossier décidé, hors transfert |
| `supervisor_queue`, `open`, `negotiating`, `committed` | `transferred` | `transfer_approved` | superviseur | Décision « Approuver le transfert » ou « Transférer » |
| `open`, `negotiating`, `committed`, `frozen`, `supervisor_queue` | `settled` | `balance_cleared` | import, lettrage | Plus aucune facture ouverte |

Rappels : le cerveau n'exécute jamais le transfert d'un dossier de famille (`rule-recouvrement-family-transfer-never-executed`) ni d'une entreprise (Q-RECOUVREMENT-07, décision D-0003) : il le propose, seul le superviseur le décide. Aucune transition ne part de `transferred`.

## 3. Gels
Un gel est une ligne de la fiche (portée, code, depuis, référence). Un gel lève la négociation de ce qu'il couvre ; le montant négociable exclut les factures gelées.

| Code | Portée | Posé par | Levé par |
|---|---|---|---|
| `dispute` | facture | litige ouvert (import Litiges, contestation, service litiges) | clôture du litige par le service litiges (une facture reste gelée tant qu'un autre litige est ouvert sur elle) |
| `contestation` | dossier | contestation exprimée dans une conversation | clôture du dernier litige né de cette contestation |
| `unassigned_payment` | dossier | paiement non affecté dont le montant égale une facture ouverte ou le solde total du dossier | affectation du paiement par le superviseur |

## 4. Éléments de la file du superviseur

| Code | Libellé | Ouvert par | Décisions permises (code : libellé) |
|---|---|---|---|
| `contestation` | Contestation | agent (contestation signalée) | `acknowledge` : Prendre acte |
| `amount_over_threshold` | Montant au-delà du seuil | cerveau (montant négociable supérieur au seuil de la politique) | `authorize` : Autoriser la négociation ; `transfer` : Transférer à l'étape suivante |
| `ladder_exhausted` | Échelle épuisée | outil « offre suivante » (aucune autre offre) | `keep` : Maintenir le dossier ; `transfer` : Transférer à l'étape suivante |
| `unassigned_payment` | Paiement non affecté | lettrage | `assign` : Affecter à une facture (facture obligatoire) |
| `accounting_gap` | Sortie comptable en écart | constat des sorties après un import de créances | `reapprove` : Remettre en attente de constatation |
| `prescription_near` | Prescription proche | cerveau (délai d'alerte atteint) | `acknowledge` : Prendre acte ; `transfer` : Transférer à l'étape suivante |
| `prescription_expired` | Prescription échue | cerveau (délai de prescription échu) | `acknowledge` : Prendre acte ; `transfer` : Transférer à l'étape suivante |
| `alert` | Alerte | arrêt automatique du lot, plafond d'encours, confirmation écrite refusée | `acknowledge` : Acquitter |
| `human_request` | Demande d'intervention humaine | agent | `resume` : Rendre le dossier au cerveau ; `transfer` : Transférer à l'étape suivante |
| `transfer_proposed` | Transfert proposé | cerveau (action « transfert proposé » de la politique) | `approve_transfer` : Approuver le transfert ; `reject_transfer` : Refuser le transfert |

Statut d'un élément : `open` (Ouvert) ou `decided` (Décidé). Une décision porte un motif de 1 à 1 000 caractères, est journalisée (journal du socle) et conservée avec son auteur. Un élément `accounting_gap` ou `unassigned_payment` se clôt aussi sans décision (`auto_closed`) quand sa cause disparaît (voir `file-de-decisions-api-modification-request.md`).

## 5. Statuts des autres objets

| Objet | Codes | Libellés |
|---|---|---|
| Version de politique | `imported`, `active`, `superseded` | Importée, Active, Remplacée |
| Sortie comptable | `to_approve`, `approved`, `recognized`, `gap` | À approuver, Approuvée, Constatée, En écart |
| Type de sortie comptable | `discount_credit`, `write_off` | Avoir de remise, Passage en perte |
| Lot du jour | `blocked`, `ready`, `replaced` | Bloqué, Prêt, Remplacé |
| Ordre d'envoi | `planned`, `blocked`, `cancelled` | Prévu, Bloqué, Annulé |
| Type d'ordre | `reminder`, `proposal`, `commitment_confirmation` | Relance, Proposition, Confirmation d'engagement |
| Engagement | `pending`, `held`, `broken` | En cours, Tenu, Rompu |
| Litige | `open`, `closed` | Ouvert, Clos |
| Origine d'un litige | `import`, `contestation`, `service` | Import, Contestation du débiteur, Service litiges |
| Élément de relecture | `to_review`, `reviewed` | À relire, Relu |

## 6. Nature, canaux, profils, contreparties, actions du jour

| Famille | Codes | Libellés |
|---|---|---|
| Nature du débiteur | `family`, `company` | Famille, Entreprise |
| Canal | `voice`, `email_sms`, `mail` | Voix, Courriel et SMS, Courrier |
| Profil | `supervisor`, `agent`, `litigation`, `indicators` | Superviseur, Compte agent, Service litiges, Lecteur des indicateurs |
| Rôle d'interlocuteur | `accounts_payable`, `buyer`, `approver`, `payer` | Comptabilité fournisseurs, Acheteur, Valideur, Payeur |
| Contrepartie | `firm_date`, `first_payment`, `direct_debit` | Date ferme, Premier versement, Prélèvement |
| Action du jour (politique) | `none`, `reminder`, `proposal`, `transfer_proposed` | Aucune, Relance, Proposition, Transfert proposé |
| Étape suivante | `external_collector`, `litigation`, `assignment` | Recouvreur externe, Contentieux, Cession |
| Nature de pièce | `invoice`, `credit_note` | Facture, Avoir |
| Type de pièce justificative | `contract`, `order`, `delivery_proof` | Contrat, Commande, Preuve de livraison |

## 7. Contrôles
| Famille | Code | Libellé |
|---|---|---|
| Activation d'une politique | `floor` | Aucune offre sous le plancher de son segment |
| | `decreasing_concessions` | Concessions décroissantes |
| | `counterparts` | Chaque concession porte une contrepartie |
| | `schedule_limits` | Échéanciers dans la durée maximale, sans frais ni intérêt pour une famille |
| | `segments_covered` | Chaque segment des créances confirmées a une règle |
| | `witnesses` | Dossiers témoins conformes aux décisions attendues |
| Lot du jour | `statement_fresh` | Relevé bancaire frais |
| | `witnesses_replayed` | Dossiers témoins rejoués sans écart |
| | `decision_share` | Part de chaque type de décision dans la limite |
| | `no_duplicate_order` | Aucun ordre en double (dossier, type, jour) |
