# Écran Dossiers (liste) : plan de réalisation

Objet : le superviseur retrouve un dossier (un débiteur et ses factures et avoirs ouverts) par son identifiant client, son état, sa nature, son segment ou l'entité créancière, et ouvre sa fiche. Chemin `/dossiers` (paramètres `recherche`, `etat`, `nature`, `segment`, `entite`), accès : profil Superviseur.

## Parcours
1. Le superviseur ouvre `/dossiers` : les dossiers au plus gros montant négociable d'abord, dix par page.
2. Il filtre ; l'adresse porte les filtres et se partage (même principe que le journal du socle).
3. Il ouvre un dossier par son identifiant client : fiche `/dossiers/<id>`.
4. Vide : « Aucun dossier pour le moment. Importez un fichier de créances depuis l'écran Imports. » sans filtre, « Aucun dossier ne correspond à ces filtres. » avec filtres. Erreur : « Une erreur est survenue. Veuillez réessayer. » avec « Réessayer ».

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Dossiers » | | |
| Filtre | champ « Rechercher un identifiant client » | texte 1 à 50 caractères, appliqué après 400 ms sans frappe ; vide : retiré | `GET /cases?search=` |
| Filtre | liste « État » : « Tous », « Ouvert », « En négociation », « Engagé », « Gelé », « En file du superviseur », « Transféré à l'étape suivante », « Soldé » | | `state` |
| Filtre | liste « Nature » : « Toutes », « Famille », « Entreprise » | | `nature` |
| Filtre | liste « Segment » : « Tous » puis les segments connus | valeurs chargées une fois | `GET /cases/filters` |
| Filtre | liste « Entité créancière » : « Toutes » puis les SIREN connus | | `GET /cases/filters` |
| Bouton | « Réinitialiser les filtres » | désactivé sans filtre actif | |
| Tableau | colonnes « Débiteur » (lien « Ouvrir le dossier <identifiant client> »), « Nature », « Segment », « Entités créancières » (SIREN séparés par des virgules), « État » (pastille), « Montant négociable », « Solde ouvert », « Factures ouvertes », « Retard maximal (jours) » | pagination 10 / 25 / 50 ; ordre de l'API (montant négociable décroissant) ; défilement horizontal sous 600 px | `GET /cases` |

## Règles
- `rule-recouvrement-screen-cases-list` (user) : l'écran Dossiers liste les dossiers du superviseur et mène à leur fiche.
- `rule-recouvrement-screen-cases-shareable-filter` (inferred) : les filtres sont portés par les paramètres d'adresse `recherche`, `etat`, `nature`, `segment`, `entite` ; une valeur invalide (état ou nature inconnus, SIREN qui n'a pas 9 chiffres, texte de plus de 50 caractères) est ignorée et retirée de l'adresse ; un segment ou un SIREN inconnu des listes reste appliqué ; modifier un filtre repart de la première page.
- `rule-recouvrement-screen-cases-no-nominal-export` (inferred) : aucun export ni copie en masse de la liste n'est offert.

## Accès
Profil Superviseur seulement. Le service litiges, le lecteur des indicateurs et le compte agent voient « Accès refusé » (le lecteur ne voit aucun dossier ni donnée nominative).

## Hypothèses
- La liste n'affiche ni nom ni coordonnée du débiteur : le fichier Créances ne porte que son identifiant client.
- L'état affiché est celui de l'API (stocké, recalculé à chaque événement) ; le studio n'en déduit aucun.
