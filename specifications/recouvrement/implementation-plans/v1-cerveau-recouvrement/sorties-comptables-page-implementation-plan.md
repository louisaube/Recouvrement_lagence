# Écran Sorties comptables : plan de réalisation

Objet : le superviseur suit les sorties comptables par état (à approuver, approuvées, constatées, en écart), approuve les sorties par lot et exporte les sorties approuvées dans un fichier à saisir dans l'outil comptable. Chemin `/sorties-comptables` (paramètres `?etat=a-approuver|approuvees|constatees|en-ecart`, `?type=`, `?entite=`), accès : profil Superviseur.

## Parcours
1. Le superviseur ouvre l'écran : l'onglet « À approuver » est affiché avec les compteurs de chaque état.
2. Il coche des sorties (au plus 500), puis « Approuver la sélection » ; dialogue de confirmation ; les sorties passent à l'onglet « Approuvées ».
3. Dans « Approuvées », il télécharge le fichier par « Exporter les sorties approuvées (CSV) » et le saisit dans l'outil comptable (hors studio). Les sorties passent à « Constatées » quand un import de créances ultérieur les reflète.
4. Dans « En écart », il lit la liste et traite chaque sortie dans la file de décisions (lien).
5. Erreurs et états vides : voir les tableaux.

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Sorties comptables » | | |
| Onglets | liste d'onglets « États des sorties » : « À approuver (N) », « Approuvées (N) », « Constatées (N) », « En écart (N) » | N = compteur de l'état ; l'onglet actif est porté par `?etat=` ; changer d'onglet vide la sélection | `GET /ledger-outputs/counts` |
| Filtres | liste « Type » (« Tous », « Avoir de remise », « Passage en perte ») ; champ « Entité créancière (SIREN) » (9 chiffres, filtre appliqué à 9 chiffres) | portés par l'adresse ; recharge à la première page | `GET /ledger-outputs?status=&type=&creditor=` |
| Tableau | colonnes : « Référence », « Type », « Entité créancière », « Débiteur » (lien « Ouvrir le dossier <identifiant client> »), « Factures » (numéros, tronqués avec infobulle), « Montant », « Motif », « Créée le » ; onglet « Approuvées » et « En écart » : « Approuvée le » et « Imports depuis l'approbation » (`N / max`, `N` seul si le maximum est inconnu) ; onglet « Constatées » : « Constatée le » | pagination 10 / 25 / 50 ; origine de la sortie (engagement ou superviseur) en texte secondaire sous le type | `GET /ledger-outputs` |
| Cases | « Sélectionner la sortie <référence> » (une par ligne) et « Sélectionner toutes les sorties de la page » (en-tête) | onglet « À approuver » seulement ; la sélection est conservée entre les pages, au plus 500 ; au-delà : message « La sélection est limitée à 500 sorties. » et la case n'est pas cochée | |
| Bouton | « Approuver la sélection (N) » | désactivé si N = 0 | `POST /ledger-outputs/approvals` |
| Dialogue | titre « Approuver les sorties » ; texte « N sortie(s) comptable(s) seront approuvées, pour un montant total de X. Elles devront être saisies dans l'outil comptable. Cette action est tracée au journal d'audit. » ; boutons « Annuler » et « Approuver » | pendant l'envoi : boutons désactivés, « Approbation en cours… » ; le montant total est la somme des montants de la sélection connue de la page, sinon la mention est omise | idem |
| Bouton | « Exporter les sorties approuvées (CSV) » | visible dans l'onglet « Approuvées » ; télécharge le fichier `sorties-comptables-AAAA-MM-JJ.csv` (nom donné par l'API) ; échec : notification « Export impossible. Réessayez. » | `GET /ledger-outputs/export` |
| Texte | onglet « En écart » : « Ces sorties n'ont pas été constatées dans le nombre d'imports fixé par la politique. Traitez-les dans la file de décisions. » avec le lien « File de décisions » | | |
| Listes vides | « À approuver » : « Aucune sortie à approuver. » ; « Approuvées » : « Aucune sortie approuvée en attente de constat. » ; « Constatées » : « Aucune sortie constatée. » ; « En écart » : « Aucune sortie en écart. » ; avec filtres : « Aucune sortie ne correspond à ces filtres. » | | |

### Résultats et erreurs
| Réponse | Message |
|---|---|
| `200` approbation | notification « N sortie(s) approuvée(s). » ; sélection vidée, compteurs et liste rechargés |
| `409 ledger.not_approvable` | « Une des sorties n'est plus à approuver. La liste a été rechargée. » ; aucune sortie approuvée |
| `404 repository.not_found` | idem |
| autres | `rule-foundation-api-failure-handling` |

## Règles
- `rule-recouvrement-screen-ledger` (user) : l'écran Sorties comptables montre les états à approuver, approuvées, constatées et en écart, l'approbation par lot et l'export.
- `rule-recouvrement-screen-ledger-batch-approval` (user) : l'approbation se fait par lot, sur sélection explicite ; aucune approbation implicite ni « tout approuver » sans sélection.
- `rule-recouvrement-screen-ledger-export-pivot` (user) : l'export est le fichier au format pivot rendu par l'API, sans transformation par le studio ; il est répétable.
- `rule-recouvrement-screen-ledger-no-accounting-link` (user) : aucun bouton ne lit ni n'écrit dans un outil comptable.
- `rule-recouvrement-screen-ledger-selection` (inferred) : la sélection est limitée à l'onglet « À approuver » et à 500 sorties (limite de l'API) ; les cases n'existent pas ailleurs.

## Accès
Profil Superviseur seulement ; les autres voient « Accès refusé ».

## Hypothèses
- Le passage en perte se propose depuis la fiche du dossier (`dossier-page-implementation-plan.md`), pas depuis cet écran.
- L'export est téléchargé par le navigateur avec la session de l'utilisateur (requête avec cookie), puis enregistré comme fichier ; aucun contenu n'est affiché dans l'écran.
