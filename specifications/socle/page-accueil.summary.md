# Accueil (`/`) et mise en page commune : état réalisé

Page protégée provisoire et cadre commun de toutes les pages connectées. Code : `features/home/pages/HomePage.tsx`, `features/auth/components/{RequireSession,RequireAdmin,AppLayout}.tsx`, `shared/FullScreenLoading.tsx`, `shared/useCall.ts`, `shared/labels.ts`. Écran : `70-ecrans.md` §2, §4, §5.

## Ce qui existe
- **Accueil** : titre « Bienvenue » puis, sur une ligne séparée, l'e-mail de l'utilisateur ; aucune carte, bouton, lien, champ ni appel d'API (`rule-foundation-home-welcome` user, `rule-foundation-home-replaceable` user). Tout chemin inconnu redirige vers `/`.
- **En-tête commun** (`rule-foundation-layout-header`, user) : « Recouvrement » (lien vers `/`), e-mail tronqué, pastille de rôle (« Administrateur » / « Utilisateur », `rule-foundation-role-label` inferred) et « Se déconnecter » (icône seule sous 600 px).
- **Onglets d'administration** (`rule-foundation-admin-nav`, inferred), pour les administrateurs : navigation « Administration » avec Utilisateurs, Groupes, Périmètres, Journal ; l'onglet actif suit le début du chemin.
- **Déconnexion** (`rule-foundation-logout`, inferred) : `POST /auth/logout`, état local effacé, retour à `/connexion` même si l'appel échoue.
- **Garde de session** : sans session, redirection avec remplacement vers `/connexion?redirection=<chemin + paramètres encodés>` (`rule-foundation-protected-redirect`, user) ; tant que `current-user` n'a pas répondu, seul « Chargement… » est rendu (`rule-foundation-no-protected-flash`, inferred).
- **Garde « Accès refusé »** (`rule-foundation-admin-screens-guard`, inferred) : un utilisateur ordinaire sur une adresse d'administration voit « Accès refusé », « Vous n'avez pas les droits nécessaires pour consulter cette page. » et « Retour à l'accueil », sans appel aux routes d'administration. La sécurité reste portée par l'API.
- **Échecs d'API** (`rule-foundation-api-failure-handling`, inferred) : 401 en cours d'usage = fin de session ; 403 « Action non autorisée. » ; autres « Une erreur est survenue. Veuillez réessayer. » avec « Réessayer » pour les listes ; 400 de formulaire « Données invalides. Vérifiez les champs. ». Aucun message technique affiché.
- **Français partout** (`rule-foundation-french-ui`, user) : `<html lang="fr">`, locale MUI `frFR` pour la pagination.

## Limites connues
- La page n'a aucune fonction : les versions métier la remplaceront. Pas d'écran propre pour les utilisateurs ordinaires (Q-COMPTES-03).
