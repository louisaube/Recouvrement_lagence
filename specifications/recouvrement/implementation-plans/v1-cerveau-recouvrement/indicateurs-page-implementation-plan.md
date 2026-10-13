# Écran Indicateurs : plan de réalisation

Objet : le superviseur et le lecteur des indicateurs lisent les cinq indicateurs de la version, chacun en deux termes, sans note agrégée, par segment, version de politique et version d'agent. Aucun dossier, aucune donnée nominative. Chemin `/indicateurs` (paramètres `segment`, `politique`, `agent`, `du`, `au`), accès : profils Superviseur et Lecteur des indicateurs.

## Parcours
1. L'utilisateur ouvre `/indicateurs` : le tableau liste tous les triplets (segment, version de politique, version d'agent) connus.
2. Il filtre par segment, version de politique, version d'agent ou période ; l'adresse porte les filtres.
3. Chaque ligne donne les cinq indicateurs sous la forme « premier terme / second terme ». Rien n'est calculé en note, en moyenne ou en pourcentage.
4. Vide : « Aucune donnée pour ces filtres. » ; sans aucune donnée : « Aucun indicateur pour le moment. » Erreur : message générique et « Réessayer ».

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Indicateurs » | | |
| Texte | « Chaque indicateur est donné en deux termes, sans note agrégée. » | fixe | |
| Filtre | liste « Segment » (« Tous » puis les segments) | | `GET /indicators/filters` puis `GET /indicators?segment=` |
| Filtre | liste « Version de politique » (« Toutes » puis « <libellé> (JJ/MM/AAAA) ») | | `policyVersionId` |
| Filtre | liste « Version d'agent » (« Toutes » puis les versions) | | `agentVersion` |
| Filtres | champs date « Du » et « Au » | jours civils inclus ; « Du » postérieur à « Au » : les deux champs en erreur « La date de début doit précéder la date de fin. » et aucun appel | `from`, `to` |
| Bouton | « Réinitialiser les filtres » | désactivé sans filtre actif | |
| Tableau | légende « Indicateurs par segment, version de politique et version d'agent » ; colonnes « Segment », « Version de politique », « Version d'agent » (« Sans agent » si nulle ; « Sans politique » pour la politique nulle), « Encaissé / dû à l'horizon » (`12 345,00 € / 20 000,00 €`), « Engagements tenus / pris » (`8 / 10`), « Remises accordées / dû » (`1 000,00 € / 15 000,00 €`), « Réclamations / actions » (`2 / 340`), « Erreurs / décisions relues » (`1 / 25`) | pagination 10 / 25 / 50 (`rowFrom`, `rowSize`) ; défilement horizontal sous 600 px ; un dénominateur nul s'affiche `0 / 0`, jamais de division | `GET /indicators` |

## Règles
- `rule-recouvrement-screen-indicators` (user) : l'écran Indicateurs montre les cinq indicateurs par segment, version de politique et version d'agent.
- `rule-recouvrement-screen-indicators-two-terms` (user) : chaque indicateur est affiché en deux termes séparés par « / », sans pourcentage, ratio, note, moyenne ni total tous indicateurs confondus.
- `rule-recouvrement-screen-indicators-aggregate-only` (user) : l'écran n'affiche aucun dossier, identifiant client, SIREN, coordonnée ni numéro de facture, et ne propose aucun lien vers un dossier.
- `rule-recouvrement-screen-indicators-shareable` (inferred) : les filtres sont portés par `segment`, `politique` (uuid), `agent`, `du` et `au` (`AAAA-MM-JJ`) ; une valeur invalide est ignorée et retirée de l'adresse (même assainissement que `rule-foundation-audit-url-sanitized`) ; modifier un filtre repart de la première page.
- `rule-recouvrement-screen-indicators-period-days` (inferred) : « Du » et « Au » sont des jours civils entiers, bornes incluses, au fuseau Europe/Paris (le fuseau du navigateur n'intervient pas : les dates sont envoyées telles quelles).

## Accès
Profils Superviseur et Lecteur des indicateurs. Le lecteur n'a que cet écran dans son menu et reçoit « Accès refusé » partout ailleurs ; le service litiges, le compte agent et un compte sans profil voient « Accès refusé ».

## Hypothèses
- Les valeurs de segment et les libellés de politique ne sont pas des données nominatives.
- Aucune courbe ni graphique (hors demande) ; les chiffres sont lus tels que l'API les rend.
