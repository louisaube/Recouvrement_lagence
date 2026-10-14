# Utilisateurs, profils de recouvrement (`/utilisateurs`) : état réalisé

Complète `specifications/socle/page-utilisateurs.summary.md` (le reste de l'écran est inchangé). Code : `features/users/pages/UsersPage.tsx`, `components/UserDialog.tsx`, `features/profiles/hooks/useUserProfiles.ts`. Plan : `utilisateurs-page-implementation-plan.md`.

## Ce qui existe
- Colonne « Profil » : pastille (« Superviseur », « Compte agent · Voix » / « Courriel et SMS » / « Courrier », « Service litiges », « Lecteur des indicateurs ») ou « Aucun profil ». Les profils sont lus en entier par `GET /user-profiles` avec la page de comptes ; l'administrateur seul attribue les profils, depuis cet écran (`rule-recouvrement-users-profile-screen`, inferred).
- Dialogues de création et de modification : champ « Profil » à choix unique, « Aucun profil » par défaut (`rule-recouvrement-users-single-profile`, user, D-0018) ; « Canal » visible et obligatoire pour « Compte agent » seulement.
- **Deux appels** (`rule-recouvrement-users-profile-two-calls`, inferred) : `POST /users` ou `PATCH /users/:id`, puis `PUT /user-profiles/:userId` si un profil est choisi ou a changé ; « Aucun profil » sur un compte qui en a un envoie `{ profile: null, channel: null }`. Si le second appel échoue : avertissement « Utilisateur enregistré, mais le profil n'a pas pu être attribué. Modifiez l'utilisateur pour réessayer. ».
- **Validation locale** (`rule-recouvrement-users-profile-local-validation`, inferred) : « Compte agent » exige un canal et refuse le rôle « Administrateur ». Messages des refus `profiles.channel_taken`, `profiles.agent_requires_user_role`, `profiles.channel_required`, `profiles.cannot_change_own_profile`. Sa propre ligne : « Profil » désactivé.
- Échec du chargement des profils : « Impossible de charger les profils. » avec « Réessayer », « Enregistrer » désactivé.

## Limites connues
- Le serveur reste l'autorité des règles de profil (`rule-recouvrement-agent-user-role`, `-agent-one-per-channel`, `-own-profile-locked`).
- L'import de comptes ne porte pas de profil. Aucun jeton ni invitation pour un compte agent (Q-RECOUVREMENT-03, D-0019 : la connexion du socle suffit).
