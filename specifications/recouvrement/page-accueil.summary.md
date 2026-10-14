# Accueil et mise en page commune (`/`) : état réalisé

Code : `features/home/pages/HomePage.tsx`, `features/auth/components/AppLayout.tsx`, `AccessDenied.tsx`, `features/profiles/{hooks/useProfile.tsx,components/RequireProfile.tsx}`, `shared/{format.ts,recouvrementLabels.ts}`. Plan : `accueil-page-implementation-plan.md`.

## Ce qui existe
- « Chargement… » tant que l'utilisateur et `GET /profiles/me` n'ont pas répondu ; le profil est lu une fois par session (`rule-recouvrement-session-profile`, inferred).
- « Bienvenue » et l'e-mail ; pastille de profil à côté de celle du rôle (« Compte agent (Voix) » etc.).
- **Barre « Recouvrement »** selon le profil (`rule-recouvrement-nav-by-profile`, inferred) : superviseur, dans l'ordre, Imports, Politique, Lot du jour, Sorties comptables, File de décisions, Dossiers, Relecture, Indicateurs, Journal ; service litiges : Litiges ; lecteur des indicateurs : Indicateurs ; agent et sans profil : aucun onglet.
- **Contenu par profil** (`rule-recouvrement-home-by-profile`, inferred) : superviseur, section « À traiter » avec « File de décisions : N à traiter » (`GET /decision-queue/counts`), « Sorties comptables : N à approuver », « Lot du jour : » (Pas encore préparé / Bloqué / Prêt), « Relevé bancaire : » (« Frais (relevé du JJ/MM/AAAA) » ou « Périmé ou absent : aucune offre ni aucun ordre d'envoi », lien `/imports?fichier=paiements`, `GET /recovery-imports/status`) ; service litiges : « Litiges ouverts : N » (`GET /disputes?status=open&from=0&size=1`) ; indicateurs : carte « Indicateurs » ; agent : « Ce compte est réservé aux agents : il n'a pas d'écran. » (`rule-recouvrement-agent-no-screen`, inferred) ; sans profil : « Aucun profil de recouvrement ne vous a été attribué. Contactez un administrateur. ».
- Une carte en échec affiche « Indisponible » et « Réessayer » sans gêner les autres.
- **Garde d'écran** (`rule-recouvrement-screen-guard`, inferred) : « Accès refusé » à la même adresse, sans appel de route de l'écran ; le serveur reste l'autorité (`rule-recouvrement-profile-server-enforced`, user).
- Formats français partout (`rule-recouvrement-ui-formats`, inferred).

## Limites connues
- Les routes `/ledger-outputs/counts` et `/daily-batches` n'existent pas dans ce lot : les cartes « Sorties comptables » et « Lot du jour » affichent « Indisponible ».
- Les écrans cibles de la plupart des onglets et cartes (lot du jour, sorties comptables, file de décisions, dossiers, relecture, indicateurs, litiges) ne sont pas construits : l'adresse retombe sur l'accueil.
- Pas d'actualisation automatique ; un changement de profil n'est vu qu'au rechargement.
