# Écran Accueil et mise en page commune : plan de réalisation

Objet : remplacer l'accueil provisoire (`rule-foundation-home-replaceable`) par un accueil qui dit à chaque profil ce qui l'attend, et faire porter à la mise en page commune le menu « Recouvrement » et la garde de profil que tous les écrans de la version réutilisent. Chemin `/`, accès : tout compte connecté.

## Parcours
1. Après connexion, le studio charge `GET /auth/current-user` puis `GET /profiles/me` ; « Chargement… » plein écran tant que les deux n'ont pas répondu (`rule-foundation-no-protected-flash`). Échec de `GET /profiles/me` autre que `401` : écran d'erreur plein écran « Une erreur est survenue. Veuillez réessayer. » avec le bouton « Réessayer » (le profil est connu avant tout rendu protégé).
2. L'accueil affiche « Bienvenue » et l'e-mail (inchangé), puis le contenu du profil :
   - **Superviseur** : section « À traiter » avec quatre cartes-liens ;
   - **Service litiges** : une carte-lien ;
   - **Lecteur des indicateurs** : une carte-lien ;
   - **Compte agent** : le message « Ce compte est réservé aux agents : il n'a pas d'écran. » et rien d'autre ;
   - **Sans profil** : le message « Aucun profil de recouvrement ne vous a été attribué. Contactez un administrateur. » (un administrateur voit en plus ses onglets « Administration »).
3. Une carte dont la donnée ne se charge pas affiche « Indisponible » et un bouton « Réessayer » ; les autres cartes restent utilisables.
4. Ouvrir une adresse que le profil n'a pas affiche l'écran « Accès refusé » (voir règles) sans appeler les routes de l'écran visé.

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Titre | « Bienvenue » | inchangé | `GET /auth/current-user` |
| E-mail | e-mail du compte | inchangé | idem |
| Pastille de profil (en-tête) | « Superviseur », « Compte agent (Voix) », « Service litiges », « Lecteur des indicateurs » à côté de la pastille de rôle | absente sans profil | `GET /profiles/me` |
| Barre de navigation | nom accessible « Recouvrement » ; onglets selon le profil (règle `rule-recouvrement-nav-by-profile`) | placée sous l'en-tête, au-dessus de la barre « Administration » ; défile horizontalement sur petit écran | `GET /profiles/me` |
| Carte « File de décisions » | « File de décisions : N à traiter » | lien vers `/file-de-decisions` ; N = éléments ouverts | `GET /decision-queue/counts` |
| Carte « Sorties comptables » | « Sorties comptables : N à approuver » | lien vers `/sorties-comptables` | `GET /ledger-outputs/counts` |
| Carte « Lot du jour » | « Lot du jour : » puis « Pas encore préparé », « Bloqué », « À libérer » ou « Prêt » | lien vers `/lot-du-jour` ; l'état est celui du lot daté d'aujourd'hui (Europe/Paris) | `GET /daily-batches?from=0&size=1` |
| Carte « Relevé bancaire » | « Relevé bancaire : » puis « Frais (relevé du JJ/MM/AAAA) » ou « Périmé ou absent : aucune offre ni aucun ordre d'envoi » | lien vers `/imports?fichier=paiements` ; état d'alerte si périmé | `GET /recovery-imports/status` |
| Carte « Litiges ouverts » | « Litiges ouverts : N » | lien vers `/litiges` | `GET /disputes?status=open&from=0&size=1` (`total`) |
| Carte « Indicateurs » | « Indicateurs » | lien vers `/indicateurs` | aucune |
| Bouton | « Réessayer » (sur une carte indisponible) | relance la lecture de la carte | route de la carte |
| Écran « Accès refusé » | titre « Accès refusé », texte « Vous n'avez pas les droits nécessaires pour consulter cette page. », bouton « Retour à l'accueil » | identique à `rule-foundation-admin-screens-guard`, appliqué à tout écran de recouvrement | aucune |

## Règles
- `rule-recouvrement-nav-by-profile` (inferred) : le menu « Recouvrement » ne montre que les écrans du profil ; le superviseur voit, dans cet ordre : « Imports » (`/imports`), « Politique » (`/politique`), « Lot du jour » (`/lot-du-jour`), « Sorties comptables » (`/sorties-comptables`), « File de décisions » (`/file-de-decisions`), « Dossiers » (`/dossiers`), « Relecture » (`/relecture`), « Indicateurs » (`/indicateurs`), « Journal » (`/journal`) ; le service litiges voit « Litiges » (`/litiges`) ; le lecteur des indicateurs voit « Indicateurs » ; le compte agent et un compte sans profil ne voient aucun onglet. L'onglet actif suit le début du chemin (« Dossiers » reste actif sur `/dossiers/<id>`). Masquer un onglet est une commodité : le serveur refuse chaque route (`rule-recouvrement-profile-server-enforced`).
- `rule-recouvrement-screen-guard` (inferred) : un écran de recouvrement ouvert par un profil qui n'y a pas droit affiche « Accès refusé » à la même adresse, dans la mise en page commune, et n'appelle aucune route de l'écran ; la garde se fonde sur `GET /profiles/me` ; un `403` reçu malgré tout affiche « Action non autorisée. » (`rule-foundation-api-failure-handling`). L'écran Journal est ouvert à l'administrateur et au superviseur.
- `rule-recouvrement-home-by-profile` (inferred) : l'accueil ne contient que les cartes du profil et ne fait que des lectures de comptage (`size=1` ou `counts`) ; il ne charge aucune liste complète.
- `rule-recouvrement-session-profile` (inferred) : le profil est lu une fois au chargement de la session, avec l'utilisateur ; un changement de profil en cours de session n'est vu qu'au rechargement (la sécurité reste celle du serveur, vérifiée à chaque requête).
- `rule-recouvrement-agent-no-screen` (inferred) : un compte agent est une machine : le studio ne lui offre aucun écran ; s'il se connecte, il voit l'accueil réduit à son message.
- `rule-recouvrement-ui-formats` (inferred) : dans tout le studio, un montant s'affiche en euros au format français (`1 234,56 €`, espace insécable) à partir de centimes entiers sans calcul flottant ; une date `JJ/MM/AAAA` et un instant `JJ/MM/AAAA HH:mm` au fuseau du navigateur ; un pourcentage issu de points de base s'affiche sans décimale inutile (`8 500` → `85 %`, `8 250` → `82,5 %`) ; un code inconnu de l'API s'affiche tel quel ; les libellés d'états, de statuts, de canaux et de profils sont ceux de `referentiel-etats-et-transitions.md`.
- `rule-recouvrement-ui-plain-text` (inferred) : tout texte venu de l'API ou d'un fichier (motifs, notes, textes de contestation, résumés, références) est affiché en texte brut, jamais comme du HTML.

## Accès
Tout compte connecté ouvre `/`. Un visiteur est redirigé vers `/connexion?redirection=%2F`. Le contenu dépend du profil (parcours 2) ; aucune carte n'est montrée à un profil qui n'a pas la route correspondante.

## Hypothèses
- Le lot « d'aujourd'hui » est celui dont `date` égale la date civile Europe/Paris ; si le plus récent lot est plus ancien, la carte dit « Pas encore préparé ».
- Un administrateur qui porte aussi un profil voit les cartes de ce profil ; sans profil, l'option A de Q-RECOUVREMENT-01 s'applique (aucune carte de recouvrement).
- Aucun graphique et aucune actualisation automatique : les cartes se rechargent à l'ouverture de la page.
