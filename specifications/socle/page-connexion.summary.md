# Connexion (`/connexion`) : état réalisé

Écran public, sans mise en page commune. Code : `studio/src/app/features/auth/pages/LoginPage.tsx`, `SessionProvider` (`hooks/useSession.tsx`), `shared/safeRedirect.ts`. Règles API : `20-authentification-session.md`. Écran : `70-ecrans.md` §3.

## Ce qui existe
- Carte centrée : « Monappli » en surtitre, titre « Connexion », champs « Adresse e-mail » (focus initial, `autocomplete=username`) et « Mot de passe » (masqué, `current-password`), bouton « Se connecter » (« Connexion en cours… » et désactivé pendant l'envoi). Ni « se souvenir de moi », ni lien d'inscription, ni « mot de passe oublié » (`rule-foundation-login-screen` user, `rule-foundation-no-self-signup` user, `rule-foundation-no-password-reset` user).
- **Message unique** (`rule-foundation-login-single-error`, user) : tout échec (401, 400, réseau, 5xx, session non établie après la connexion) affiche « Identifiants incorrects. » dans une alerte au-dessus du bouton ; le message reste quand on modifie un champ et disparaît à la soumission suivante.
- **Garde de soumission** (`rule-foundation-login-submit-guard`, inferred) : e-mail (rogné) ou mot de passe vide : aucune requête, même message ; pas de seconde soumission pendant l'envoi.
- **Parcours** : `POST /auth/login { email rogné, password, returnToken: false }` (cookie posé par l'API), puis `GET /auth/current-user`, puis redirection avec remplacement d'historique.
- **Destination** (`rule-foundation-login-redirect-home`, inferred) : `?redirection=` si c'est un chemin interne sûr, sinon `/` (refusés : sans `/` initial, `//`, `/\`, caractères de contrôle, `/connexion`).
- **Déjà connecté** (`rule-foundation-login-already-connected`, inferred) : un utilisateur connecté est redirigé vers la même destination ; l'écran « Chargement… » s'affiche pendant la vérification de session.
- **Session restaurée au chargement** par `GET /auth/current-user` (`rule-foundation-session-persists` user) ; `{}`, 401 ou erreur réseau signifient « non connecté » (`rule-foundation-session-expired` inferred, `rule-foundation-api-unreachable` inferred).

## Limites connues
- Aucune limitation du nombre d'essais de connexion.
- Le rôle n'est pas revérifié pendant la session ; la déconnexion ne révoque pas le jeton côté serveur (Q-AUTH-03).
