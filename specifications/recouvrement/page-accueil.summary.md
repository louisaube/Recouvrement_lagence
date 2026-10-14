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
- La carte « Lot du jour » lit `GET /daily-batches` (premier lot de la liste) : « Prêt » ou « Bloqué » si ce lot porte la date du jour (Europe/Paris), « Pas encore préparé » sinon ; elle mène à `/lot-du-jour` (`page-lot-du-jour.summary.md`). Un lot remplacé ne s'y lit pas comme tel : le plus récent l'emporte.
- La route `/ledger-outputs/counts` n'existe pas : la carte « Sorties comptables » affiche « Indisponible ».
- La carte « File de décisions : N à traiter » mène à `/file-de-decisions` (`page-file-de-decisions.summary.md`) ; le nombre vient de `GET /decision-queue/counts`.
- Les écrans cibles des autres onglets et cartes (sorties comptables, dossiers, relecture, indicateurs, litiges) ne sont pas construits : l'adresse retombe sur l'accueil.
- Pas d'actualisation automatique ; un changement de profil n'est vu qu'au rechargement.
