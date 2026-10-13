# Écran Litiges : plan de réalisation

Objet : le service litiges voit les factures en litige, les contestations des débiteurs et les dossiers concernés ; il ouvre un litige (ce qui gèle la facture) et le clôt (ce qui la dégèle). Rien d'autre. Chemin `/litiges` (paramètres `statut=ouverts|clos|tous`, `origine`, `recherche`), accès : profil Service litiges.

## Parcours
1. Le service litiges ouvre `/litiges` : onglet « Ouverts », du plus ancien au plus récent.
2. Il ouvre un litige (« Voir le litige <numéro de facture> ») : un panneau latéral montre la facture, le dossier concerné (identifiant client, nature, état, factures ouvertes et gelées), le motif, le responsable et, pour une contestation, le texte du débiteur avec le canal et la date.
3. Il clôt le litige : note de clôture obligatoire ; la facture est dégelée (sauf autre litige ouvert) ; le litige passe dans « Clos ».
4. Il ouvre un litige : recherche de la facture par numéro, motif, responsable ; la facture est gelée.
5. Vide : « Aucun litige ouvert. » / « Aucun litige clos. » / « Aucun litige. » ; avec filtres : « Aucun litige ne correspond à ces filtres. » Erreur : message générique et « Réessayer ».

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre et bouton | « Litiges » ; « Ouvrir un litige » | | |
| Onglets | liste d'onglets « Statut des litiges » : « Ouverts », « Clos », « Tous » | porté par `?statut=` | `GET /disputes?status=` |
| Filtres | liste « Origine » (« Toutes », « Import », « Contestation du débiteur », « Service litiges ») ; champ « Rechercher un numéro de facture ou un identifiant client » | appliqués à 400 ms ; portés par l'adresse | `origin`, `search` |
| Tableau | colonnes « Facture » (numéro), « Entité créancière », « Débiteur », « Solde », « Motif » (tronqué, infobulle), « Responsable », « Origine », « Ouvert le », « Clos le » (onglets Clos et Tous), « Actions » (« Voir le litige <numéro> ») | pagination 10 / 25 / 50 | `GET /disputes` |
| Panneau de détail | titre « Litige sur la facture <numéro> » ; blocs « Facture » (entité, débiteur, solde, gelée oui / non), « Dossier concerné » (identifiant client, nature, état, « N factures ouvertes dont M gelées »), « Motif », « Responsable », « Ouvert le » (et « par <e-mail> » si le litige vient du service) | texte brut | `GET /disputes/:id` |
| Bloc de contestation | « Contestation du débiteur » : « Canal » (Voix, Courriel et SMS, Courrier), « Conversation », « Exprimée le », texte | affiché si le litige est né d'une contestation | `contestation` |
| Clôture | si clos : « Clos le JJ/MM/AAAA HH:mm par <e-mail> », « Note de clôture : <texte> » | | |
| Bouton | « Clore le litige » | visible si ouvert ; ouvre le dialogue | `POST /disputes/:id/close` |
| Dialogue de clôture | titre « Clore le litige » ; zone « Note de clôture » (obligatoire, 1 à 500 caractères) ; texte « La facture sera dégelée si aucun autre litige ne la vise. Cette action est tracée au journal d'audit. » ; boutons « Annuler » et « Clore le litige » | | idem |
| Dialogue d'ouverture | titre « Ouvrir un litige » ; champ « Numéro de facture » (recherche par préfixe, résultats en liste radio « <numéro> · <SIREN> · débiteur <identifiant> · solde <montant> », « Déjà gelée » signalée) ; champ « Motif » (1 à 500) ; champ « Responsable » (1 à 100) ; boutons « Annuler » et « Ouvrir le litige » | validation locale : facture choisie, motif et responsable non vides après rognage | `GET /disputes/invoices?number=` puis `POST /disputes` |

### Résultats et erreurs
| Réponse | Message |
|---|---|
| ouverture `201` | notification « Litige ouvert. » ; liste rechargée |
| clôture `200` | notification « Litige clos. » ; panneau mis à jour |
| `409 disputes.already_open` | « Cette facture est déjà en litige. » |
| `409 disputes.already_closed` | « Ce litige est déjà clos. » ; panneau rechargé |
| `404 repository.not_found` | « Facture ou litige introuvable. Rechargez la liste. » |
| `400` | « Données invalides. Vérifiez les champs. » |

## Règles
- `rule-recouvrement-screen-disputes` (user) : l'écran Litiges montre les factures en litige, les contestations et les dossiers concernés, et permet d'ouvrir et de clore un litige.
- `rule-recouvrement-screen-disputes-only` (user) : aucun autre écran, aucune autre donnée n'est offerte au service litiges : pas de fiche dossier, pas de décisions du cerveau, pas de politique, pas de journal ; son menu ne contient que « Litiges ».
- `rule-recouvrement-screen-disputes-freeze-visible` (user) : ouvrir un litige gèle la facture et le clore la dégèle ; la liste et le panneau reflètent l'état gelé renvoyé par l'API (`frozen`, `caseState`).
- `rule-recouvrement-screen-disputes-text-plain` (inferred) : motifs, notes et textes de contestation sont du texte brut (`rule-recouvrement-ui-plain-text`).

## Accès
Profil Service litiges seulement. Le superviseur, le lecteur des indicateurs, le compte agent et un administrateur sans profil voient « Accès refusé » et aucune route de litige n'est appelée.

## Hypothèses
- Les contestations ne forment pas une liste distincte : chaque contestation visible est celle d'un litige d'origine « Contestation du débiteur » (un litige par facture visée).
- Le service litiges ne modifie ni le motif ni le responsable d'un litige existant (hors demande).
