# Politique (`/politique`) : état réalisé

Profil Superviseur seulement (`rule-recouvrement-policy-supervisor-only`, user). Code : `features/policies/pages/PoliciesPage.tsx`, `components/PolicyDetail.tsx`. Plan : `politique-page-implementation-plan.md`. API : `/policy-versions` (voir `module-recouvrement.summary.md`).

## Ce qui existe
- Titre « Politique », bouton « Importer une version » (vers `/imports?fichier=politique`). Sans version : « Aucune version de politique pour le moment. Importez-en une depuis l'écran Imports. ».
- Bandeau « Version active : <libellé> (<date>), activée par <e-mail> le … » ou « Aucune version active : le cerveau ne peut décider aucun dossier. ».
- Tableau « Versions » filtré par « Statut » (Tous, Importée, Active, Remplacée), pagination 10 / 25 / 50, bouton « Ouvrir la version <libellé> » ; colonne « Contrôles » d'après `checksPassed`.
- Version affichée portée par `?version=` (`rule-recouvrement-screen-policy-version-url`, inferred) : identifiant inconnu, « Cette version n'existe pas. » et paramètre retiré.
- Détail : empreinte du fichier, importée par, activée par, dates (`rule-recouvrement-screen-policy-identified`, user) ; « Contrôles d'activation » (six, « Réussi » / « Échec » et problèmes) ; « Dossiers témoins » (« Conforme » / « Écart ») ; « Paramètres généraux » ; « Règles par segment et nature » avec « Échelle d'offres » dépliable. Points de base en pourcentage, seuils et plafonds en euros (`rule-recouvrement-screen-policy-percent`, inferred).
- **Activation** (`rule-recouvrement-screen-policy-activation-gate`, user) : « Activer cette version » pour une version « Importée », désactivé (« Un contrôle d'activation échoue. ») si un contrôle échoue ; dialogue « Activer la version « <libellé> » ? » ; notification « Version activée. » ; `policies.activation_blocked` : « Activation refusée : » et les contrôles en échec ; `policies.not_activatable` : « Cette version ne peut plus être activée. ». Le serveur rejoue les six contrôles.
- Aucune commande de modification ni de suppression (`rule-recouvrement-screen-policy-read-only`, user). Écran d'ensemble : `rule-recouvrement-screen-policy` (user).
- Erreur de liste ou de détail : « Une erreur est survenue. Veuillez réessayer. » avec « Réessayer ».

## Limites connues
- Le graphe JDM n'est pas affiché : ses effets se lisent par les dossiers témoins et les règles.
- Aucun éditeur : une version se dépose depuis Imports et ne change plus.
- Une version datée avant la version active reste activable (`rule-recouvrement-policy-activation-date`, inferred, D-0011), à confirmer côté API.
