# Utilisateurs (`/utilisateurs`) : état réalisé

Écran réservé aux administrateurs. Code : `features/users/pages/UsersPage.tsx`, `components/UserDialog.tsx`, `hooks/useUserLoader.ts`, `shared/components/{AdminList,FormDialog,PageHeader}.tsx`, `shared/usePagedList.ts`. Règles API : `30-comptes.md`. Écran : `70-ecrans.md` §6.

## Ce qui existe
- En-tête : titre « Utilisateurs », bouton secondaire « Importer des utilisateurs » (vers `/utilisateurs/import`) et bouton principal « Nouvel utilisateur » (`rule-foundation-users-admin-screen`, user).
- Tableau lu par `GET /users?from=&size=` (trié par e-mail) : « Adresse e-mail » (tronquée, valeur complète en infobulle), « Rôle », « Groupes » (une pastille par groupe, « Aucun groupe »), « Actions » (« Modifier », nom accessible « Modifier l'utilisateur <e-mail> »). Pagination serveur 10 / 25 / 50 (`rule-foundation-list-pagination`, inferred). Vide : « Aucun utilisateur. ». Ni suppression, ni désactivation, ni recherche (`rule-foundation-user-no-delete` inferred).
- **Création** : champs « Adresse e-mail », « Mot de passe » (aide « 8 caractères minimum. »), « Rôle » (« Utilisateur » par défaut), « Groupes » (aide rappelant qu'un utilisateur sans groupe ne voit aucune donnée rattachée à un périmètre, `rule-foundation-user-no-group-no-data` user). Validation locale : e-mail ≤ 254 avec `@`, mot de passe 8 à 72 (`rule-foundation-user-create-fields` inferred). Envoi `POST /users`.
- **Modification** : e-mail en lecture seule, pas de mot de passe ; envoi de `{ role, groupIds }` seulement (`rule-foundation-user-edit-scope` inferred, `rule-foundation-user-groups-membership` user). Sur la ligne de l'administrateur connecté, « Rôle » est désactivé avec « Vous ne pouvez pas modifier votre propre rôle. » (`rule-foundation-user-own-role-locked`, inferred).
- Succès : dialogue fermé, liste rechargée (première page après création), notifications « Utilisateur créé. » / « Utilisateur modifié. ». Échecs, saisies conservées : `users.email_already_exists` → « Cette adresse e-mail est déjà utilisée. » sous le champ (`rule-foundation-user-email-unique` inferred) ; `users.cannot_change_own_role` → « Vous ne pouvez pas modifier votre propre rôle. » ; 400 → « Données invalides. Vérifiez les champs. ». Échec du chargement des groupes : « Impossible de charger les groupes. » avec « Réessayer », « Enregistrer » désactivé.

## Limites connues
- Ni e-mail ni mot de passe ne sont modifiables ; aucun moyen de définir un mot de passe pour un compte importé.
- La liste n'est pas rechargée après un import ; elle l'est à la réouverture de l'écran.
