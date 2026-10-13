# 00 — Vue d'ensemble du socle

## 1. Objet

Le socle est la base commune de toute application web produite par la chaîne de fabrication. Il ne contient **aucun domaine métier**. Il fournit :

1. une **API HTTP** (contrat : `in/specifications/openapi.json`) et un **studio** (interface web en français) ;
2. l'**authentification** par e-mail et mot de passe, avec une session qui survit au rechargement de la page ;
3. l'**administration** des comptes, des groupes et des périmètres ;
4. un **mécanisme de filtrage par périmètre** (règle par ligne) que les futures tables métier réutilisent ;
5. un **journal d'audit** inaltérable, alimenté par simple déclaration sur les routes d'écriture ;
6. un **mécanisme d'import** de fichiers `.xlsx` / `.csv` (aperçu puis confirmation), démontré sur l'import en masse de comptes.

Le socle est livré en quatre versions successives, toutes à couvrir par la réécriture :

| Version | Demande d'origine (résumé) |
|---|---|
| `socle-connexion` | écran de connexion, message d'erreur unique, mise en page commune, redirection des pages protégées, session persistante, accueil « Bienvenue ». Ni inscription libre ni mot de passe oublié. |
| `socle-groupes-perimetres` | groupes et périmètres, règle par ligne réutilisable, accès administrateur réglable par route, restriction de la lecture des comptes, écrans d'administration. Pas de multi-entreprise. |
| `socle-journal-audit` | trace de toute action d'écriture, survivant à la suppression de l'auteur, jamais modifiable ; déclaration par route ; écran de consultation filtrable et partageable par lien. |
| `socle-import-excel` | import `.xlsx`/`.csv` en flux avec `@maleus/xlsx`, très gros fichiers, colonnes déclarées par la fonctionnalité, aperçu puis confirmation, pas de double import, fichiers piégés refusés, respect des périmètres, trace d'audit ; démonstration sur l'import de comptes. |

Le nom d'application par défaut est **« Recouvrement »** ; il apparaît dans l'en-tête du studio, sur l'écran de connexion et dans le nom du cookie de session (`recouvrement-jwt-<hôte>`).

## 2. Documents de la spécification

| Fichier | Contenu |
|---|---|
| `00-vue-ensemble.md` | ce document : objet, rôles, glossaire, principes transverses |
| `10-plateforme.md` | comportements transverses de l'API (erreurs, validation, accès par défaut, santé, contrat) |
| `20-authentification-session.md` | connexion, session, déconnexion |
| `30-comptes.md` | comptes utilisateurs |
| `40-groupes-perimetres.md` | périmètres, groupes, règle par ligne |
| `50-journal-audit.md` | journal d'audit |
| `60-import.md` | mécanisme d'import et import de comptes |
| `70-ecrans.md` | écrans du studio |
| `90-capacites-pour-le-metier.md` | ce que le socle garantit aux futures fonctionnalités métier |
| `99-questions-ouvertes.md` | points que les sources ne permettent pas de trancher |

Documents d'entrée complémentaires (non réécrits ici, qui font foi) : contrat d'API `in/specifications/openapi.json`, matrice des droits `in/specifications/permissions.yaml` et `in/permissions-foundation.yaml`, contrat de données `out/data-contract.md`, suite de recette `in/acceptance/`.

### Format des règles

Chaque règle porte un identifiant stable `rule-…` (cité par la suite de recette) et sa provenance :

- **(user)** : exigence issue d'une demande d'origine ;
- **(inferred)** : exigence déduite pendant la fabrication, devenue partie du comportement attendu.

Une règle est énoncée comme un comportement observable de l'extérieur, avec les erreurs attendues sous la forme `statut code` (par exemple `409 users.email_already_exists`). Les exigences de plateforme sans identifiant d'origine portent un identifiant `EXI-…` propre à ce document ; la recette ne les cite pas.

## 3. Rôles

| Rôle | Valeur dans l'API | Libellé à l'écran | Peut faire |
|---|---|---|---|
| Visiteur | (aucun jeton) | — | se connecter, se déconnecter, interroger `GET /auth/current-user` (réponse vide), le point de santé. Toute autre route répond `401`. |
| Utilisateur | `user` | « Utilisateur » | tout ce que fait le visiteur ; lire **son propre** compte et ses groupes (`GET /users/:id` avec son identifiant). Voir les données métier des périmètres atteints par ses groupes (futures fonctionnalités). Aucun écran d'administration. |
| Administrateur | `admin` | « Administrateur » | tout ce que fait l'utilisateur ; gérer comptes, groupes, périmètres ; consulter le journal d'audit ; importer des comptes. Atteint tous les périmètres, sauf si une route restreint cet accès (lecture seule ou aucun). |

Il n'existe que ces deux rôles stockés (`user`, `admin`). Le rôle « visiteur » désigne l'absence de session.

Un refus de rôle répond `403 security.access_denied` ; l'absence d'authentification répond `401` (codes `security.missing_token` ou `security.invalid_token`). La matrice complète route × rôle est dans les fichiers de permissions.

## 4. Glossaire

**Compte** (ou utilisateur) — personne pouvant se connecter : identifiant (uuid), adresse e-mail unique (comparaison exacte, sensible à la casse), rôle (`user` ou `admin`), appartenances à des groupes, et un secret d'authentification (empreinte de mot de passe). Table `base.users`, secret dans `base.credentials`. Un compte n'est jamais supprimé ni désactivé par l'application.

**Périmètre** — ensemble nommé de données (un site, une crèche…), identifié par un **code** unique et immuable (`creche-1`) et doté d'un **nom** d'affichage. Les futures tables métier rattachent chaque ligne à un code de périmètre. Table `base.scopes`. Jamais supprimé.

**Groupe** — ensemble nommé de comptes (ses **membres**, zéro ou plus) qui donne accès à **un ou plusieurs périmètres**. Nom unique sans tenir compte de la casse. Tables `base.groups`, `base.group_users`, `base.group_scopes`. Jamais supprimé.

**Périmètres atteints** (d'un utilisateur ordinaire) — union des périmètres des groupes dont il est membre, lue à chaque requête. Sans groupe : aucun périmètre.

**Règle par ligne** — garantie du socle : une ligne métier rattachée à un périmètre n'est lisible et modifiable que par les appelants qui atteignent ce périmètre.

**Régime d'accès** (d'une route) — déclaration obligatoire de qui peut appeler une route : publique, ou réservée à des rôles, avec un code d'action `<fonctionnalité>:<verbe>` (par exemple `groups:update`) et, si besoin, le niveau d'accès d'un administrateur aux périmètres (complet, lecture seule, aucun).

**Trace d'audit** (ou entrée du journal) — enregistrement d'une action d'écriture réussie : qui (identifiant et e-mail copiés), quand (milliseconde), quelle action (code), quel type d'objet (libellé français), quel identifiant d'objet, quel périmètre le cas échéant, et un résumé lisible en français sans secret. Table `base.audit_logs`. Jamais modifiée ni effacée par l'application.

**Import** — reprise de données depuis un fichier `.xlsx` ou `.csv` en deux temps : un **aperçu** (analyse sans aucune écriture métier, résultat conservé temporairement et identifié par un `importId`), puis une **confirmation** qui enregistre les seules lignes valides. Un fichier (mêmes octets) confirmé une fois pour une fonctionnalité ne peut plus l'être. Tables `base.import_previews`, `base.import_preview_rows`, `base.import_preview_errors`.

**Aperçu** — résultat d'analyse d'un fichier : nombre de lignes lues, valides, en erreur, et liste paginée des erreurs (ligne, colonne, raison). Privé à l'administrateur qui l'a créé ; expire au bout de 2 heures.

**Studio** — l'application web (interface) qui consomme l'API.

## 5. Principes transverses

1. **Français partout côté utilisateur** : tous les textes du studio, les libellés de types d'objet et les résumés du journal, les raisons d'erreur d'import. Les codes techniques (codes d'erreur, codes d'action) restent en anglais et ne sont jamais montrés comme message à l'utilisateur, sauf le code d'action affiché tel quel en texte secondaire dans le journal.
2. **L'API est l'autorité.** Les contrôles du studio (garde de rôle, validations locales) sont des commodités ; toute règle est vérifiée par l'API.
3. **Refus par défaut** : une route sans régime d'accès déclaré n'est pas accessible ; un contexte d'accès aux périmètres absent signifie « aucune ligne », jamais « toutes les lignes ».
4. **Jamais d'erreur 500 sur une entrée** : toute entrée invalide, tout conflit d'unicité (y compris en concurrence) et tout fichier piégé produisent une réponse 4xx documentée ; les réponses respectent strictement le schéma du contrat.
5. **Pas de suppression** dans cette version : ni compte, ni groupe, ni périmètre, ni entrée de journal. Les routes `DELETE` correspondantes n'existent pas (`404`).
6. **Pas de multi-entreprise** : aucune notion d'entreprise, de société ou de locataire nulle part (`rule-foundation-no-multi-company`, voir `40-groupes-perimetres.md`).
7. **Atomicité** : chaque écriture de l'API est tout ou rien, trace d'audit comprise.
8. **Pas de secret exposé** : mots de passe, jetons et empreintes n'apparaissent dans aucune réponse, aucune trace, aucun message.
9. **Contrat fidèle** : toute borne vérifiée par l'API (longueurs, minimum, maximum, nombre d'éléments, format) est déclarée dans le contrat OpenAPI, et inversement.
