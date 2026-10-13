# Écran Politique : plan de réalisation

Objet : le superviseur consulte les versions de la politique, lit pour chacune les contrôles d'activation et les résultats des dossiers témoins, voit ses paramètres, et active une version. Aucun éditeur : une version se dépose depuis l'écran Imports et ne se modifie jamais. Chemin `/politique` (paramètre `?version=<id>`), accès : profil Superviseur.

## Parcours
1. Le superviseur ouvre `/politique` : le bandeau dit quelle version est active ; le tableau liste les versions ; le détail de la version active (sinon de la plus récente) s'affiche dessous. Sans aucune version : « Aucune version de politique pour le moment. Importez-en une depuis l'écran Imports. » avec le lien « Importer une version ».
2. Il ouvre une version importée (« Ouvrir la version <libellé> ») : contrôles d'activation, dossiers témoins, paramètres généraux, règles par segment et nature.
3. Si les six contrôles réussissent, « Activer cette version » est disponible : dialogue de confirmation, activation, notification. Si l'un échoue, le bouton est désactivé et la raison est lisible sous chaque contrôle en échec.
4. Une version active ou remplacée se consulte, sans bouton d'activation.
5. Erreurs : liste ou détail en échec : « Une erreur est survenue. Veuillez réessayer. » avec « Réessayer ».

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre et lien | « Politique » ; bouton « Importer une version » | lien vers `/imports?fichier=politique` | |
| Bandeau | « Version active : <libellé> (<JJ/MM/AAAA>), activée par <e-mail> le JJ/MM/AAAA. » ou « Aucune version active : le cerveau ne peut décider aucun dossier. » | avertissement si aucune | `GET /policy-versions?status=active&from=0&size=1` |
| Filtre | liste « Statut » : « Tous », « Importée », « Active », « Remplacée » | recharge à la première page | `GET /policy-versions?status=` |
| Tableau | « Versions » : « Libellé », « Date de version », « Statut » (pastille), « Importée par », « Importée le », « Activée le », « Contrôles » (« Tous réussis » / « N échec(s) » / « — »), « Actions » (bouton « Ouvrir la version <libellé> ») | pagination 10 / 25 / 50 ; version affichée surlignée | `GET /policy-versions` |
| Détail : en-tête | « Version « <libellé> » » ; « Date de version », « Empreinte du fichier » (SHA-256 raccourci, valeur complète en infobulle), « Importée par », « Activée par » | | `GET /policy-versions/:id` |
| Section | « Contrôles d'activation » : une ligne par contrôle (libellés du référentiel §7), état « Réussi » ou « Échec » (icône et texte), liste des problèmes sous un échec | les contrôles sont recalculés à chaque lecture | idem (`checks`) |
| Section | « Dossiers témoins » : « Identifiant », « Description », « Attendu » (action — règle), « Obtenu », « Résultat » (« Conforme » / « Écart ») | | idem (`witnesses`) |
| Section | « Paramètres généraux » : liste de définitions « Fraîcheur maximale du relevé (jours) », « Imports avant écart d'une sortie comptable », « Taille de l'échantillon de relecture », « Moyens de paiement », « Plafonds de part par type de décision », « Plafonds d'encours sous échéancier » (tableau « Version d'agent », « Segment », « Plafond ») | | idem (`global`) |
| Section | « Règles par segment et nature » : « Segment », « Nature », « Horizon (jours) », « Étape suivante » (Recouvreur externe / Contentieux / Cession), « Plancher » (% du montant négociable), « Offres dans l'échelle », « Durée maximale d'un échéancier (jours) », « Seuil de montant », « Pièces exigées », « Prescription » (« délai (jours) depuis la date de facture / l'échéance, alerte N jours avant ») | chaque ligne se déplie avec « Échelle d'offres » | idem (`rules`) |
| Échelle (dépliée) | « Échelle d'offres : <segment> · <nature> » : « Rang », « Type » (Paiement unique / Échéancier), « Valeur » (% du montant négociable), « Premier paiement (jours) », « Échéances » (nombre × intervalle), « Frais sur délai » (%), « Contrepartie » (Date ferme dans N jours / Premier versement de N % / Prélèvement / Aucune) | | idem |
| Bouton | « Activer cette version » | visible pour une version « Importée » ; désactivé si un contrôle échoue (infobulle « Un contrôle d'activation échoue. ») | `POST /policy-versions/:id/activate` |
| Dialogue | titre « Activer la version « <libellé> » ? » ; texte « Elle remplacera la version active actuelle. Cette action est tracée au journal d'audit. » (sans version active : « Elle deviendra la version active. ») ; boutons « Annuler » et « Activer » | « Activation… » et boutons désactivés pendant l'envoi | idem |
| Résultats | notification « Version activée. » ; `409 policies.activation_blocked` : alerte « Activation refusée : » suivie des contrôles en échec et de leurs problèmes (lus dans `details`) ; `409 policies.not_activatable` : « Cette version ne peut plus être activée. » ; liste rechargée dans les deux cas | | |

## Règles
- `rule-recouvrement-screen-policy` (user) : l'écran Politique montre les versions, les contrôles d'activation, les dossiers témoins et l'activation.
- `rule-recouvrement-screen-policy-read-only` (user) : aucune commande de modification, de suppression ni d'édition d'une version n'existe ; une version active n'est jamais modifiée, une nouvelle la remplace.
- `rule-recouvrement-screen-policy-activation-gate` (user) : l'activation n'est offerte que si les six contrôles réussissent ; le serveur les rejoue et reste l'autorité (`409 policies.activation_blocked`).
- `rule-recouvrement-screen-policy-identified` (user) : la version affiche qui l'a importée et qui l'a activée, avec la date ; l'empreinte du fichier est visible.
- `rule-recouvrement-screen-policy-percent` (inferred) : les points de base s'affichent en pourcentage (`rule-recouvrement-ui-formats`) ; les montants du seuil et des plafonds d'encours en euros.
- `rule-recouvrement-screen-policy-version-url` (inferred) : la version affichée est portée par `?version=` (lien partageable, repris de `/imports`) ; un identifiant inconnu (`404`) affiche « Cette version n'existe pas. » et retire le paramètre.

## Accès
Profil Superviseur seulement : la politique n'est jamais visible d'un autre profil (`rule-recouvrement-policy-supervisor-only`). Les autres voient « Accès refusé » et aucune route de politique n'est appelée.

## Hypothèses
- Le détail d'une version ne montre pas le graphe JDM lui-même (hors demande : éditeur de politique) ; ses effets se lisent par les dossiers témoins et les règles.
- Les libellés des actions du jour des témoins sont ceux du référentiel : « Aucune », « Relance », « Proposition », « Transfert proposé » ; la règle appliquée est affichée telle que la politique la nomme.
