# Module recouvrement : plan de réalisation

Version `v1-cerveau-recouvrement`. Plan de l'agent de fabrication du backend. Il s'appuie sur les demandes à l'API du frontend du même dossier (une par fonctionnalité, citées entre parenthèses) et sur `referentiel-etats-et-transitions.md` ; les schémas Zod, les bornes, les formes de réponse et les codes d'erreur **sont ceux de ces demandes** (elles ne sont pas recopiées ici : toute divergence se corrige dans la demande, pas dans le code). Le plan fixe ce que les demandes laissent au module : tables, contraintes de base, découpage, mécanismes, ordre de fabrication, tests. Aucun code n'est écrit par ce plan.

La provenance de chaque règle est celle écrite en amont (`user`, `inferred`, `inferred, default Q-RECOUVREMENT-NN`). Les règles que ce plan ajoute lui-même sont marquées `(inferred)` ou `(inferred, default Q-RECOUVREMENT-NN)` ; aucune règle amont n'est requalifiée. Les choix ouverts qui changeraient la recette sont dans `questions.yaml` (Q-RECOUVREMENT-13 à 20 ajoutés par ce plan ; 01 à 12 viennent du frontend) ; leur option par défaut est celle que ce plan construit.

## Découpage en fonctionnalités

Nouveaux dossiers `api/src/features/<feature>/` (module, controller, service, schemas, tables, `tests/`), chacun ajouté à `api/src/app.module.ts` (non gelé). Les dossiers gelés (`platform`, `auth`, `users`, `groups`, `scopes`, `audit`, `imports`, `main.ts`, `scripts`) ne sont pas modifiés ; leurs exports peuvent être importés.

| Fonctionnalité | Contenu | Demande |
|---|---|---|
| `profiles` | table des profils, garde `RequireProfile(...)`, 3 routes | `profils` |
| `cases` | débiteurs/dossiers, factures, gels, historique d'états, service d'états, montant négociable, 6 routes de lecture | `dossiers`, référentiel |
| `recovery-imports` | 5 définitions d'import, lettrage, rapport d'écarts, constat des sorties, 8 routes | `imports-recouvrement` |
| `policies` | versions, aperçus, adaptateur `@gorules/zen-engine`, six contrôles, 5 routes | `politiques` |
| `brain` | évaluation des dossiers, journal des décisions, calcul des offres, prescription, plafonds ; sans route (le journal est servi par `cases`) | `dossiers`, `outils-agents`, `lot-du-jour` |
| `negotiation` | offres débloquées, engagements, échéances ; services seulement | `outils-agents`, `dossiers` |
| `agent-tools` | conversations, journal des appels, idempotence, 8 routes REST, enveloppe MCP | `outils-agents` |
| `disputes` | litiges, contestations, 5 routes | `litiges` |
| `decision-queue` | éléments de file, décisions, 3 routes | `file-de-decisions` |
| `ledger` | sorties comptables, constat, export, 5 routes | `sorties-comptables` |
| `batches` | lots, ordres d'envoi, garde-fous, 5 routes | `lot-du-jour` |
| `reviews` | échantillons et relectures, 5 routes | `relecture` |
| `indicators` | faits d'indicateurs et agrégation, 2 routes | `indicateurs` |

Dépendances de code (pas de cycle de modules) : `cases` ← `brain` ← `negotiation`, `disputes`, `ledger`, `decision-queue` ← `recovery-imports`, `agent-tools`, `batches`, `reviews`, `indicators`. Les services du bas ne dépendent jamais des contrôleurs ; les événements qui touchent plusieurs fonctionnalités passent par `brain.evaluate(...)` (voir Règles transverses). Dépendances npm nouvelles de `api/` : `@gorules/zen-engine`, `@modelcontextprotocol/sdk`.

## Données

Tout dans le schéma `base`, une `*.tables.ts` par fonctionnalité, `pnpm migrate:gen && pnpm migrate:all`. Aucune table contractuelle n'est modifiée ; les tables ci-dessous sont des ajouts au contrat de données (contestation à ouvrir, voir plus bas). Convention : montants `bigint` en centimes avec `mode: 'number'` (toutes les bornes de l'API tiennent dans 2^53), dates métier `date`, instants `timestamptz`, énumérations en `text` avec contrainte `CHECK` (codes du référentiel §1 à §6) pour ne pas figer de types Postgres. Aucune table n'est rattachée à un périmètre (`scope_code` absent : l'accès repose sur les profils, demande `dossiers`, Compatibilité).

### Profils (`profiles.tables.ts`)
- `user_profiles` : `user_id` uuid PK, FK `base.users(id)` ON DELETE CASCADE ; `profile` text CHECK (`supervisor`, `agent`, `litigation`, `indicators`) ; `channel` text null CHECK (`voice`, `email_sms`, `mail`) ; `created_at`, `updated_at`. CHECK `(profile = 'agent') = (channel IS NOT NULL)`. Index unique partiel sur `channel` WHERE `profile = 'agent'` (`rule-recouvrement-agent-one-per-channel`). Déclencheur `BEFORE INSERT OR UPDATE` refusant un profil `agent` sur un compte dont `base.users.role <> 'user'`, et déclencheur sur `base.users` (`AFTER UPDATE OF role`) refusant le passage à `admin` d'un compte ayant un profil `agent` (ajout de déclencheurs, aucune colonne du contrat modifiée ; `PATCH /users/:id`, gelé, n'est pas adapté : voir « Risques », R6). Un seul profil par compte = la clé primaire (Q-RECOUVREMENT-02, option A).

### Dossiers (`cases.tables.ts`)
- `cases` : `id` uuid PK ; `debtor_id` text UNIQUE (1 à 50) ; `nature` CHECK (`family`, `company`) ; `debtor_siren` text null, CHECK `(nature = 'company') = (debtor_siren ~ '^[0-9]{9}$')` ; `segment` text CHECK `^[a-z0-9][a-z0-9_-]{0,49}$` ; `state` CHECK (7 états) ; `state_since` ; `transferred_at` null ; `transfer_kind` null ; `authorized_cents` bigint null (montant autorisé par `authorize`) ; `first_seen_on` date ; `first_seen_due_cents` bigint ; `first_policy_version_id` uuid null (version active à la première apparition, pour l'indicateur « encaissé / dû ») ; `rejected_transfer_rule` text null (règle au moment d'un `reject_transfer`) ; `created_at`, `updated_at`. Index sur `(state)`, `(segment)`.
- `invoices` : `id` PK ; `case_id` FK ; `kind` CHECK (`invoice`, `credit_note`) ; `number` (1 à 50) ; `creditor_siren` CHECK 9 chiffres ; UNIQUE `(creditor_siren, number)` ; `amount_cents`, `imported_balance_cents` (solde du dernier cliché), `balance_cents` (solde courant = solde du cliché moins les paiements appliqués postérieurs à l'extraction) ; `payer` text null ; `invoice_date`, `due_date` ; `channels` text[] (sous-ensemble des trois canaux) ; `closed_at` null ; `first_seen_on`, `first_seen_balance_cents` ; `last_extraction_date` ; `payer`. CHECK de signe : facture `amount > 0` et `0 <= balance <= amount` ; avoir `amount < 0` et `amount <= balance <= 0` ; `due_date >= invoice_date` ; valeurs absolues bornées à 10 000 000 000. Index `(case_id)`, `(number text_pattern_ops)` pour la recherche par préfixe.
- `freezes` : `id`, `case_id`, `code` CHECK (`dispute`, `contestation`, `unassigned_payment`), `scope` (`invoice`, `case`), `invoice_id` null (obligatoire ssi `scope = 'invoice'`), `source_type`, `source_id` (litige, contestation ou affectation de paiement), `reference` text (1 à 100), `since`, `released_at` null. Index unique partiel `(case_id, code, source_type, source_id) WHERE released_at IS NULL`. Le gel est une ligne, jamais recalculée à la lecture (`FreezeDto`).
- `case_state_history` : `id` bigserial, `case_id`, `at`, `from_state` null, `to_state`, `cause`, `actor` text (1 à 200), `reference` null. Déclencheurs refusant `UPDATE` et `DELETE` (comme `audit_logs`, TRUNCATE permis seulement dans une base `*_test`).
- `receivable_snapshots` : `id`, `import_id` FK `recovery_imports`, `extraction_date` UNIQUE, `control_total_cents`, `total_cents`, `confirmed_at`.

### Imports (`recovery-imports.tables.ts`)
Le mécanisme est celui du socle, mais les contrôles de fichier entier (arrêt à la première erreur, total de contrôle, cohérence entre lignes d'un même débiteur, date d'extraction unique) ne tiennent pas dans `ImportDefinition` du socle ; la fonctionnalité réutilise les primitives exportées de `features/imports/` (`MultipartParser`, réception en fichier temporaire, lecteurs CSV/xlsx, inspection du classeur, `echo`) et possède ses tables :
- `recovery_imports` : `id`, `type` CHECK (5 types), `status` (`preview`, `confirmed`, `consumed`), `actor_id`, `file_name`, `file_hash`, `total_rows`, `valid_rows`, `error_rows`, `error_entries`, `accepted` bool, `extraction_date` null, `control_total_cents` null, `computed_total_cents` null, `created_at`, `expires_at`, `confirmed_at`, `created_count`, `skipped_count`, `effects` jsonb. Index unique partiel `(type, file_hash) WHERE status = 'confirmed'` (`409 import.already_imported`).
- `recovery_import_rows` (`import_id`, `row_number`, `data` jsonb, PK composite) et `recovery_import_errors` (`import_id`, `seq`, `row_number`, `column`, `reason`, PK composite) : mêmes rôles que `import_preview_rows` / `import_preview_errors` du socle ; les lignes sont supprimées à la confirmation et à la purge des aperçus expirés (2 heures), les erreurs et les lignes de rapport suivent l'import.
- `recovery_import_report_items` : `import_id`, `category` (`new`, `settled`, `modified`, `removed`), `key` (1 à 200), `debtor_id` null, `detail` (1 à 300), PK `(import_id, category, key)`. Calculé à l'aperçu, conservé après confirmation (lecture d'un import confirmé).
- `payments` : `id`, `reference` text (1 à 100) UNIQUE, `amount_cents` > 0, `payment_date`, `statement_date`, `import_id`, `status` (`already_in_balances`, `applied`) ; `statements` : `statement_date`, `import_id`, `confirmed_at` (fraîcheur).
- `payment_allocations` : `id`, `payment_id` FK, `invoice_id` FK null (nul = non affecté), `amount_cents` > 0, `origin` CHECK (`reference`, `amount`, `excess`, `supervisor`), `parent_allocation_id` null (excédent), `created_at`, `assigned_by` null, `assigned_at` null. Le solde courant d'une facture = `imported_balance_cents` moins la somme de ses affectations dont le paiement est postérieur à l'extraction. Le lettrage automatique (origines `reference`, `amount`, `excess`) est recalculé en entier à chaque confirmation de Créances ou de Paiements, les affectations `supervisor` étant appliquées d'abord et conservées (`rule-recouvrement-unassigned-payment-freeze`).
- `contacts` : `id` uuid (conservé quand `(case_id, role, email, phone, postal_address)` est inchangé), `case_id`, `role` CHECK (4), `email`, `phone`, `postal_address` (null possibles, au moins une renseignée), `suspended_channels` text[] ; UNIQUE `(case_id, role, coalesce(email,''), coalesce(phone,''), coalesce(postal_address,''))`.
- `invoice_documents` : `invoice_id`, `type` CHECK (3), `reference` null, PK `(invoice_id, type)`.

### Politique (`policies.tables.ts`)
- `policy_versions` : `id`, `label` (1 à 100), `version_date` date, `status` CHECK (`imported`, `active`, `superseded`), `file_hash` char(64) UNIQUE, `document` jsonb (contenu normalisé du fichier : décision JDM, `parameters`, `witnesses`), `imported_by`, `imported_at`, `activated_by` null, `activated_at` null, `checks_passed` bool null. Index unique partiel `(status) WHERE status = 'active'` (au plus une version active). Déclencheur `BEFORE UPDATE` : seuls `status`, `activated_by`, `activated_at` peuvent changer, et seulement dans les sens `imported → active`, `active → superseded` ; `DELETE` refusé (`rule-recouvrement-policy-immutable`).
- `policy_previews` : `id`, `actor_id`, `file_name`, `file_hash`, `document` jsonb null, `valid`, `errors` jsonb, `created_at`, `expires_at` (2 heures, purgé à l'aperçu suivant).

### Cerveau (`brain.tables.ts`)
- `decisions` : `id` uuid (tri textuel exigé par le tirage de relecture), `case_id` FK, `decided_at`, `kind` CHECK (`daily_action`, `offer`, `commitment_check`, `threshold`, `prescription`, `exposure_ceiling`), `outcome` (1 à 100), `rule_id` null, `policy_version_id` null, `probability` numeric(5,4) CHECK `0 <= p <= 1` (1 par construction), `inputs` jsonb (entrées complètes, copie figée), `internal_reason` jsonb, `batch_id` null, `segment` (copie), `agent_version` null. Déclencheurs refusant `UPDATE`/`DELETE`. Le rejeu des dossiers témoins n'écrit jamais ici (`rule-recouvrement-witness-no-order`).
- `indicator_facts` : `id`, `indicator` CHECK (5), `fact_date` date (jour civil Europe/Paris), `segment`, `policy_version_id` null, `agent_version` null, `a_value` bigint, `b_value` bigint, `source_type`, `source_id` ; UNIQUE `(indicator, source_type, source_id)`. Écrite aux événements que décrivent les règles `rule-recouvrement-indicator-*` ; l'API agrège par `GROUP BY (segment, policy_version_id, agent_version)`. Voir le détail par indicateur plus bas.

### Négociation (`negotiation.tables.ts`)
- `unlocked_offers` : `id`, `case_id`, `conversation_id` (FK `agent_conversations`), `rank` int (interne, jamais rendu), `status` CHECK (`current`, `superseded`, `accepted`, `revoked`), `unlocked_at`, `policy_version_id`, `rule_segment`, `rule_nature`, `negotiable_cents` (au déblocage), `total_cents`, `discount_cents`, `installments` jsonb (`[{dueDate, amountCents}]`), `counterpart` jsonb null, `has_schedule` bool, `revoked_at` null. Index unique `(case_id, rank) WHERE status IN ('current','accepted')` (une marche de l'échelle à la fois par dossier).
- `commitments` : `id`, `case_id`, `offer_id` FK, `status` CHECK (`pending`, `held`, `broken`), `total_cents`, `discount_cents`, `payment_method`, `channel`, `agent_version`, `conversation_id` text, `policy_version_id`, `negotiable_cents`, `created_at`, `resolved_at` null. Index unique partiel `(case_id) WHERE status = 'pending'` (`409 commitments.already_committed`).
- `commitment_installments` (`commitment_id`, `ordinal`, `due_date`, `amount_cents`), `commitment_lines` (`commitment_id`, `invoice_id`, `amount_cents`, `balance_at_registration_cents` : `rule-recouvrement-commitment-covers-negotiable`, répartition de la remise au prorata). `paidCents` d'une échéance n'est pas stocké : calculé à la lecture par l'allocation du cumul affecté (voir Règles).

### Agents (`agent-tools.tables.ts`)
- `agent_conversations` : `id` uuid, `conversation_id` text (1 à 100), `account_id` FK `base.users`, `channel`, `case_id`, `interlocutor_id`, `agent_version`, `opened_at`, `ai_disclosure_given` bool CHECK vrai ; UNIQUE `(account_id, conversation_id)`.
- `agent_calls` : `id`, `account_id`, `agent_version`, `channel`, `conversation_id` text, `idempotency_key`, `tool`, `transport` (`rest`, `mcp`), `fingerprint` char(64), `request` jsonb (entrées, sans en-tête d'autorisation), `response_status` int, `response_body` jsonb, `called_at`. UNIQUE `(account_id, tool, idempotency_key)`. Déclencheurs refusant `UPDATE`/`DELETE`. Aucune route ne la lit (`rule-recouvrement-agent-calls-logged`).
- `complaints` : `id`, `case_id`, `conversation_row_id`, `agent_version`, `text` (1 à 1 000), `created_at`.

### Litiges (`disputes.tables.ts`)
- `disputes` : `id`, `invoice_id`, `case_id`, `origin` CHECK (`import`, `contestation`, `service`), `reason` (1 à 500), `owner` (1 à 100), `opened_at`, `opened_by` null, `closed_at` null, `closed_by` null, `close_note` null, `contestation_id` null. Index unique partiel `(invoice_id) WHERE closed_at IS NULL` (`rule-recouvrement-dispute-one-open-per-invoice`). CHECK `closed_at` renseigné ssi `close_note` renseigné ; déclencheur : un litige clos ne change plus.
- `contestations` : `id`, `case_id`, `agent_conversation_id`, `channel`, `text` (1 à 1 000), `stated_at`.

### File de décisions (`decision-queue.tables.ts`)
- `queue_items` : `id`, `type` CHECK (10 types), `status` (`open`, `decided`), `case_id` null, `object_key` text (1 à 100 : id du dossier, de la facture, de l'allocation, de la sortie, du lot, de l'ordre…), `summary` (1 à 300), `details` jsonb (au plus 20 lignes), `created_at`, `decided_at` null, `decision_code` null, `decision_reason` null (1 à 1 000), `decided_by` null (nul avec `decision_code = 'auto_closed'`). Index unique partiel `(type, object_key) WHERE status = 'open'` (`rule-recouvrement-queue-single-open`). Déclencheur : un élément `decided` ne change plus.

### Sorties comptables (`ledger.tables.ts`)
- Séquence `ledger_reference_seq` ; `ledger_outputs` : `id`, `reference` text UNIQUE DEFAULT `'SC-' || lpad(nextval(...)::text, 6, '0')` (jamais réutilisée), `type` CHECK (`discount_credit`, `write_off`), `origin` (`commitment`, `supervisor`), `status` CHECK (4), `creditor_siren`, `case_id`, `commitment_id` null, `amount_cents` > 0, `reason` (1 à 500), `created_at`, `approved_by` null, `approved_at` null, `recognized_at` null, `imports_since_approval` int >= 0. `ledger_output_lines` (`output_id`, `invoice_id`, `amount_cents` > 0, PK composite). Déclencheur `BEFORE UPDATE` n'admettant que les transitions `to_approve → approved`, `approved → recognized`, `approved → gap`, `gap → recognized`, `gap → approved` (`rule-recouvrement-ledger-states`) et gelant les autres colonnes (hors compteur et horodatages). Un avoir de remise et un passage en perte sont rattachés à une seule entité créancière (CHECK via la facture à la création, vérifié par le service).

### Lots (`batches.tables.ts`)
- `daily_batches` : `id`, `batch_date` date, `status` CHECK (4), `prepared_by`, `created_at`, `released_by` null, `released_at` null, `release_reason` null, `replaced_by` null, `policy_version_id` null, `case_count`, `checks` jsonb, `shares` jsonb, `excluded` jsonb. Index unique partiel `(batch_date) WHERE status <> 'replaced'` (`rule-recouvrement-batch-one-per-day`).
- `send_orders` : `id`, `batch_id` null, `type` CHECK (3), `status` CHECK (`planned`, `blocked`, `cancelled`), `case_id`, `interlocutor_id`, `channel`, `conditions` jsonb (`[{name, value}]`, jamais de texte rédigé), `block_reason` null, `order_date` date, `created_at`. Index unique partiel `(case_id, type, order_date) WHERE status = 'planned'` : c'est la garantie « aucun envoi en double » côté base (`rule-recouvrement-batch-no-duplicate-order`) ; les ordres `blocked` ne sont pas libérables et ne comptent pas.

### Relecture (`reviews.tables.ts`)
- `review_samples` : `id`, `week` text UNIQUE (`AAAA-Www`), `week_start`, `week_end`, `drawn_at`, `drawn_by`, `seed` char(64), `size`, `pool_size`, `policy_version_id`. `review_items` : `id`, `sample_id`, `rank`, `decision_id` FK `decisions`, `case_id`, `status`, `supervisor_action` null, `comment` null, `reviewed_by` null, `reviewed_at` null, `agreed` null ; UNIQUE `(sample_id, rank)` ; déclencheur : une relecture donnée ne change plus (`rule-recouvrement-review-final`).

### Migrations
Une migration par fonctionnalité dans l'ordre de fabrication (profils d'abord), plus une migration d'écriture de déclencheurs (`CREATE FUNCTION` / `CREATE TRIGGER` en SQL brut dans le fichier généré). Le déclencheur « append-only » du socle (`0001_audit_append_only`) sert de modèle, y compris l'exception TRUNCATE des bases `*_test`. `resetData()` des tests tronque toutes les tables de `base` : les nouvelles tables doivent donc être tronquables en base de test (vérifier que le helper les énumère ou qu'il lit le catalogue ; sinon contestation `OPEN: acceptance`, helper en `platform/testing/helpers.ts` gelé).

## Opérations

Convention d'accès : « garde P » = `@Access({ action, roles: [] })` + `@UseGuards(RequireProfile('P'))`. `RequireProfile` (dans `profiles/profile.guard.ts`) lit `user_profiles` **à chaque requête** (jamais le jeton), répond `401` sans jeton, `403 security.access_denied` si le profil manque ou diffère, **avant** toute validation et lecture de corps, sans révéler l'existence de l'objet (`rule-recouvrement-profile-server-enforced`). Un compte `admin` sans profil est refusé (Q-RECOUVREMENT-01, option A) ; un `admin` portant un profil exerce celui-ci. Schémas, bornes et codes d'erreur : ceux de la demande citée. Chaque `POST`/`PUT` est `@Audited` (objet et résumé donnés par la demande) ou `@AuditExempt('<raison>')`. Les routes statiques sont déclarées **avant** les routes à `:id` du même contrôleur (`/cases/filters`, `/disputes/invoices`, `/ledger-outputs/counts|export`, `/recovery-imports/history|status`, `/decision-queue/counts`, `/indicators/filters`).

| Fonctionnalité | Routes (action, accès) | Audit |
|---|---|---|
| `profiles` | `GET /profiles/me` (`profiles:me`, rôle `user`) ; `GET /user-profiles` (`profiles:list`, rôle `admin`) ; `PUT /user-profiles/:userId` (`profiles:set`, rôle `admin`) | `PUT` tracée « Profil de compte » |
| `cases` | `GET /cases`, `/cases/filters`, `/cases/:id`, `/cases/:id/decisions`, `/cases/:id/state-history`, `GET /invoices` (`cases:*`, `invoices:search`, garde `supervisor`) | lectures, aucune |
| `recovery-imports` | `GET /recovery-imports/:type/specification`, `POST .../preview`, `GET .../:importId/errors`, `.../report`, `.../report/items`, `POST .../:importId/confirm`, `GET /recovery-imports/history`, `/status` (garde `supervisor`) | `confirm` tracée (cinq types d'objet) ; `preview` exemptée |
| `policies` | `GET /policy-versions`, `/policy-versions/:id`, `POST /policy-versions/previews`, `POST .../previews/:previewId/confirm`, `POST /policy-versions/:id/activate` (garde `supervisor`) | `confirm`, `activate` tracées ; `previews` exemptée |
| `agent-tools` | `POST /agent/conversations`, `GET /agent/cases/:caseId`, `POST /agent/cases/:caseId/{next-offer,commitments,contestations,human-requests,complaints}`, `POST /agent/messages/check`, `POST /mcp` (garde `agent`) | toutes les écritures tracées « Appel d'agent » (`agent:*`) ; `messages/check` exemptée (aucun effet) ; `POST /mcp` tracée `agent:mcp` |
| `disputes` | `GET /disputes`, `/disputes/invoices`, `/disputes/:id`, `POST /disputes`, `POST /disputes/:id/close` (garde `litigation`) | `open`, `close` tracées |
| `decision-queue` | `GET /decision-queue/items`, `/counts`, `POST /decision-queue/items/:id/decision` (garde `supervisor`) | `decision` tracée |
| `ledger` | `GET /ledger-outputs`, `/counts`, `/export` (CSV), `POST /ledger-outputs/approvals`, `POST /ledger-outputs/write-offs` (garde `supervisor`) | `approvals`, `write-offs` tracées ; export non tracé |
| `batches` | `GET /daily-batches`, `/:id`, `/:id/orders`, `POST /daily-batches`, `POST /daily-batches/:id/release` (garde `supervisor`) | `prepare`, `release` tracées |
| `reviews` | `GET /review-samples`, `/:id`, `/:id/items`, `POST /review-samples`, `POST /review-samples/:id/items/:itemId/review` (garde `supervisor`) | `draw`, `review` tracées |
| `indicators` | `GET /indicators`, `/indicators/filters` (garde `supervisor` **ou** `indicators`) | lectures, aucune |
| `audit` (existantes) | `GET /audit-logs`, `/audit-logs/filters` : garde « rôle `admin` ou profil `supervisor` » | inchangé |

### Points de conception par fonctionnalité

**Profiles.** `PUT` en transaction : refuse l'auto-modification (`409 profiles.cannot_change_own_profile`), exige `channel` pour `agent` et le refuse ailleurs, refuse `agent` sur un compte non `user`, traduit la violation de l'index unique partiel en `409 profiles.channel_taken` ; `profile: null` supprime la ligne et rend `{profile: null, channel: null}`. `GET /user-profiles` ne rend que les comptes ayant un profil, triés par e-mail (`byLowerText`).

**Cases.** `CaseStateService.recompute(caseId, cause, actor, reference, tx)` est l'unique écrivain de `cases.state` : il évalue la précédence du référentiel §1 (`settled`, `transferred`, `frozen`, `supervisor_queue`, `committed`, `negotiating`, `open`), n'écrit une ligne d'historique que si l'état change, vérifie la transition contre le tableau du référentiel §2 (une transition absente lève une erreur interne `500` testée, jamais produite : `rule-recouvrement-case-state-referential`) et s'exécute dans la transaction de l'événement (`rule-recouvrement-state-transitions-logged`). `GET /cases` filtre par `state`, `nature`, `segment`, `creditor` (SIREN d'une facture), `search` (sous-chaîne sans casse sur `debtor_id`, caractères `%` et `_` échappés), trie par montant négociable décroissant puis `debtor_id` (`byText`) ; le montant négociable et `maxDaysLate` sont calculés en SQL (agrégat sur `invoices` et `freezes`), pas stockés. `GET /invoices` : préfixe sans casse, factures `kind = invoice`, `balance > 0`.

**Recovery-imports.** Une définition par type (colonnes du format pivot, noms comparés rognés sans casse, dates `AAAA-MM-JJ` ou `JJ/MM/AAAA`, montants convertis en centimes sans arrondi). `receivables` et `payments` : analyse arrêtée à la première erreur (`errorRows = 1`, une entrée), `accepted: false`, `confirm` répond `409 imports.file_refused`. L'analyseur multipart propre à la fonctionnalité accepte exactement une partie `file` et, pour `receivables`, une partie texte `controlTotal` (taille de champ bornée, toute autre partie refusée) ; la partie texte est lue avant la fin du fichier ou après selon l'ordre d'envoi, donc le contrôle de total se fait **après** la lecture complète du fichier (aucune dépendance à l'ordre des parties). Cohérence entre lignes d'un même débiteur : table de hachage clé `debiteur_id` (nature, SIREN, segment de la première ligne) ; avec un million de lignes la mémoire est bornée par le nombre de débiteurs, ce qui est acceptable et mesuré à la fabrication ; si ce n'est pas le cas, repli sur une table temporaire indexée. `confirm` : une seule transaction (`SELECT ... FOR UPDATE` sur l'import, index unique sur le condensé) qui, pour `receivables`, remplace le portefeuille (`rule-recouvrement-receivables-snapshot`) puis appelle dans l'ordre : lettrage rejoué, constat des sorties (`ledger.recognize`), évaluation de tous les dossiers touchés (`brain.evaluateMany`) ; `409 imports.stale_extraction` si un cliché plus récent est confirmé entre-temps (verrou consultatif sur `receivable_snapshots`). `GET status` : `fresh` = relevé confirmé le plus récent et `aujourd'hui (Europe/Paris) − lastStatementDate ≤ maxAgeDays` de la politique active ; faux sans politique active.

**Policies.** `PolicyEngine` (service) enveloppe `@gorules/zen-engine` : compile le graphe `decision` d'une version (`createDecision`), évalue `{segment, nature, state, daysLateMax, negotiableCents, overThreshold}`, normalise la sortie `{action, rule}` (sans correspondance : `none` / `no_rule`), met en cache par identifiant de version, est utilisé identiquement pour les témoins et pour les dossiers réels, et n'a aucun accès à la base ni au réseau (le graphe JDM est refusé s'il contient autre chose que des nœuds de décision et d'expression : liste blanche des types de nœud, testée). Les six contrôles sont des fonctions pures `(document, créances confirmées) → {passed, problems}` dans `policy-checks.ts`, exécutées à l'aperçu, à la lecture et à l'activation. Activation : transaction, verrou sur la ligne active et sur la version, six contrôles, ancienne version `superseded`, nouvelle `active`, `409 policies.activation_blocked` avec `details: [{path: code, reason}]` ; l'aperçu JSON est lu en flux de 2 097 152 octets au plus (`413 policies.file_too_large`) et décodé en UTF-8 strict (`400 policies.invalid_file_type`). L'empreinte SHA-256 est calculée sur les octets du fichier. Aucune valeur métier n'apparaît dans le code : bornes de validation du fichier de politique mises à part (elles sont de la validation de format, dans le schéma Zod du fichier), toute grandeur vient du document (`rule-recouvrement-policy-no-business-value-in-code`, vérifié par un test qui recherche les littéraux interdits dans `brain/`).

**Brain.** `BrainService` expose : `evaluate(caseId, trigger, tx)` et `evaluateMany`, appelés aux points de `rule-recouvrement-evaluation-points` (confirmation d'import, préparation de lot, appel d'outil d'agent, clôture de litige, décision du superviseur) ; il enchaîne, dans une transaction par dossier et dans cet ordre : (1) prescription (dates, éléments `prescription_near`/`prescription_expired` une fois par facture, décision `prescription`) ; (2) engagements (tenu, rompu, `commitment_check`) ; (3) gels de dossier (toutes factures gelées) ; (4) seuil (`amount_over_threshold`, décision `threshold`, mémoire de `authorized_cents`) ; (5) plafonds d'encours (décision `exposure_ceiling`, alerte) ; (6) `CaseStateService.recompute`. L'action du jour n'est décidée que par le lot (`DailyActionService`). `OfferService` calcule une offre à partir de la règle (arrondi à la moitié supérieure en arithmétique entière : `(valueBp × negotiable + 5000) / 10000` en `bigint`, jamais de flottant) et applique `rule-recouvrement-offer-computation`. `ClockService.today()` rend la date civile Europe/Paris (`Intl.DateTimeFormat` ou arithmétique de fuseau sans dépendance), seul point d'accès à l'heure pour les règles métier.

**Agent-tools.** Les huit opérations appellent des services `AgentToolsService.<outil>(ctx, input)` qui ne connaissent pas le transport ; `AgentController` (REST) et `McpService` (MCP) sont deux enveloppes minces (`rule-recouvrement-agent-two-transports`). Mécanisme d'appel (`AgentCallRunner`) :
1. `AgentProfileGuard` (garde `agent`, profil lu en base) puis `AgentContextGuard` : valide les quatre en-têtes (`X-Agent-Version`, `X-Channel`, `X-Conversation-Id`, `Idempotency-Key`) **avant** la validation du corps : `400 agent.missing_context` ; `X-Channel` différent du canal du compte : `403 agent.channel_mismatch`.
2. Dans la transaction de la route (celle de l'audit pour une écriture, une transaction propre pour la lecture) : recherche de `(account_id, outil, clé)` ; trouvée avec la même empreinte (SHA-256 des entrées validées et du dossier visé) : réponse enregistrée rejouée avec l'en-tête `Idempotent-Replayed: true` et sans nouvel effet ; trouvée avec une empreinte différente : `409 agent.idempotency_conflict`.
3. Sinon exécution, puis insertion de la ligne `agent_calls` **dans la même transaction que l'effet**. Deux appels simultanés de même clé : l'un des deux échoue à l'index unique `(account_id, tool, idempotency_key)` à la validation ; son effet est annulé et un filtre d'exceptions de contrôleur (`AgentCallFilter`, `@UseFilters` sur les contrôleurs agent) relit l'appel gagnant et rend sa réponse en rejeu : un seul effet.
4. Refus (`ApiError` de statut < 500) : la transaction d'audit est annulée avec l'effet, donc `AgentCallFilter` écrit la ligne de refus (`agent_calls`, `ON CONFLICT DO NOTHING`) par une connexion du pool **après** l'annulation (aucune connexion n'est tenue pendant l'écriture), puis délègue au formatage d'erreur du socle ; un refus rejoué avec la même clé rend le même refus. Les `5xx` ne sont pas conservés. Les refus des gardes (`401`, `403` de profil) précèdent l'identification du compte agent et ne sont pas journalisés.
5. `McpService` : `POST /mcp` répond toujours `200` pour un outil (le résultat porte `isError`) ; chaque outil s'exécute dans un point de sauvegarde (`db.transaction` imbriqué) : en cas de refus, l'effet est annulé, la ligne de refus est écrite dans la transaction de la route (qui est validée) et le résultat est `isError: true` avec `structuredContent = { status, code, message }` identique au corps REST. Le transport est celui du SDK (`@modelcontextprotocol/sdk`, Streamable HTTP sans état, réponse JSON) ; la requête express est convertie vers l'interface Web du transport du SDK si la version installée l'offre, sinon via une enveloppe de réponse minimale ; `GET /mcp` et `DELETE /mcp` sont déclarées cachées du contrat (`hidden: true`) derrière la garde `agent` et répondent `405` avec `Allow: POST` (`rule-recouvrement-mcp-405-after-auth`, plus bas). Le corps `POST /mcp` est déclaré comme objet libre de 1 Mio au plus, sans `rawBody` (le JSON est lu par l'intercepteur de validation).
6. `AgentAccessService.caseVisibleToAgent(caseId, channel, interlocutorId)` : dossier ni `settled` ni `transferred`, une facture négociable autorise le canal, interlocuteur joignable ; sinon `404 cases.not_found` (Q-RECOUVREMENT-08, option A). Chaque réponse agent est construite par des projections dédiées (`AgentCaseDto`, `AgentOfferDto`…) qui ne lisent jamais le segment, la règle, la version de politique, le rang ni les montants de référence ; un test de propriété vérifie qu'aucune clé interdite ne figure dans aucune réponse.
7. `MessageChecker` : analyse (montants, dates, termes internes) selon `rule-recouvrement-message-parsing`, comparée aux conditions débloquées (Q-RECOUVREMENT-11, option A) ; extraits tronqués à 100 caractères, 50 violations au plus.

**Disputes.** Ouverture/clôture dans une transaction avec gel/dégel (`freezes`), recalcul d'état et `brain.evaluate` ; la clôture lève le gel de dossier `contestation` quand le dernier litige né de cette contestation est clos. `GET /disputes/:id` ne rend que le résumé de dossier prévu (jamais la fiche).

**Decision-queue.** `QueueService.open(type, caseId, objectKey, summary, details, tx)` est l'unique créateur d'éléments (`INSERT ... ON CONFLICT DO NOTHING` sur l'index unique) ; `decide` verrouille l'élément (`FOR UPDATE`), contrôle la décision permise par type (table de configuration `queue-types.ts` du référentiel §4, source unique de `allowedDecisions`), le motif (rogné, 1 à 1 000), `invoiceId` (obligatoire seulement pour `assign`), applique les effets de `rule-recouvrement-queue-effects` et recalcule les dossiers touchés. Deux décisions simultanées : le verrou sérialise, la seconde reçoit `409 queue.already_decided`. `candidates` d'un paiement non affecté : au plus 50 factures ouvertes dont le solde ou le total de dossier correspond au montant.

**Ledger.** `LedgerService.createDiscountCredit(commitment, tx)` (appelé par le cerveau quand un engagement assorti d'une remise est tenu : une sortie par entité créancière, remise répartie au prorata des soldes à l'inscription, reliquat sur la facture au plus grand solde), `approve(ids)` (tout ou rien, `FOR UPDATE` dans l'ordre des identifiants contre les interblocages), `writeOff`, `recognize(importContext, tx)` (appelé par la confirmation de Créances), `export()` (CSV RFC 4180, `\n`, `identifiant,type,entite_siren,debiteur_id,factures,montant,motif`, montant en décimal exact construit à partir des centimes, jamais par division flottante, tri par `reference`). Les transitions illégales sont refusées aussi par le déclencheur.

**Batches.** `BatchService.prepare` : `409 batches.no_active_policy` sans version active ; transaction unique : remplace un lot `blocked` du jour (ordres `cancelled`), refuse `409 batches.already_released` si le lot du jour est `ready`/`pending_release`, évalue chaque dossier non final par `brain.evaluate` puis `DailyActionService` (décision `daily_action` journalisée avec entrées complètes), construit les ordres (éligibilité, canal et interlocuteur selon `rule-recouvrement-batch-channel-order`, pièces exigées, exclusions comptées par raison), insère les ordres (l'index unique écarte les doublons, comptés), rejoue les témoins (`WitnessReplayer`, lecture seule, aucune écriture hors du résultat du contrôle), calcule les parts et les seuils (`rule-recouvrement-batch-auto-stop`), fixe le statut (`ready` si tout passe selon Q-RECOUVREMENT-04 option A, sinon `blocked`) et ouvre l'alerte de blocage (une par lot). Un lot de zéro dossier est valide (parts à zéro, aucune division par zéro : le contrôle de part est réussi). `release` n'admet que `blocked` ou `pending_release`.

**Reviews.** Tirage reproductible exactement selon `rule-recouvrement-review-reproducible` (SHA-256 de chaînes, entiers lus sur 16 hexadécimaux en `BigInt`, tri textuel des identifiants de décision, échange de Fisher-Yates décroissant) ; la fonction est pure et testée contre des vecteurs calculés indépendamment dans le test. Avant relecture, `ReviewItemDto` est construit **sans lire** les colonnes de la décision hors `inputs` (projection explicite).

**Indicators.** Les faits (`indicator_facts`) sont écrits dans la transaction de l'événement qui les produit, un enregistrement par événement (idempotents par `(indicator, source_type, source_id)`) :
- engagement inscrit : fait `commitments` (`a` = 0 tenu, `b` = 1 pris) daté de l'inscription ; engagement tenu : fait séparé (`a` = 1, `b` = 0) daté du constat, rattaché à la politique et à la version d'agent **de l'inscription** (`rule-recouvrement-indicator-commitments`) ;
- engagement tenu avec remise : fait `discounts` (`a` = remise, `b` = montant négociable à l'inscription) daté du constat ;
- réclamation signalée : fait `complaints` (`a` = 1, `b` = 0) ; conversation ouverte : (`a` = 0, `b` = 1) ; ordre d'un lot qui devient `ready` : (`a` = 0, `b` = 1 par ordre, version d'agent nulle) ;
- relecture donnée : fait `errors` (`a` = 1 si désaccord, `b` = 1), politique de la décision relue, version d'agent nulle ;
- horizon atteint (évalué aux points d'évaluation) : fait `collected` (`a` = encaissé, `b` = dû à la première apparition) daté du jour d'horizon ; un dossier dont la première apparition n'avait aucune politique active n'a pas d'horizon (limite assumée de la règle amont).
`GET /indicators` : `GROUP BY` sur le triplet, filtres, période en jours civils Europe/Paris, tri `segment`, `versionDate` décroissante, `agentVersion` (nulls en dernier), pagination `rowFrom`/`rowSize`. Les projections ne contiennent ni identifiant client, ni SIREN, ni coordonnée, ni numéro de facture.

## Règles

Provenance reprise telle qu'écrite en amont. « Où » indique l'endroit d'application principal ; chaque identifiant est cité en commentaire à cet endroit et dans le test qui le couvre.

### Profils et accès (`profiles`, `audit`)
- `rule-recouvrement-profiles-assigned-by-admin` (user) : `PUT /user-profiles/:userId` réservée au rôle `admin` ; sans profil, aucune route de recouvrement n'est ouverte.
- `rule-recouvrement-profile-server-enforced` (user) : `RequireProfile`, lecture en base à chaque requête, avant validation.
- `rule-recouvrement-profile-single` (inferred, default Q-RECOUVREMENT-02) : clé primaire sur `user_id`, `PUT` remplace.
- `rule-recouvrement-admin-no-business-access` (inferred, default Q-RECOUVREMENT-01) : `RequireProfile` ne regarde pas `role`.
- `rule-recouvrement-agent-channel-required` (user) : validation du `PUT` + CHECK de base.
- `rule-recouvrement-agent-one-per-channel` (user) : index unique partiel.
- `rule-recouvrement-agent-user-role` (inferred) : service + déclencheurs de base.
- `rule-recouvrement-own-profile-locked` (inferred) : service de `PUT`.
- `rule-recouvrement-profile-no-delete` (inferred) : aucune route `DELETE` ; `profile: null`.
- `rule-recouvrement-journal-supervisor` (user) : garde « admin ou superviseur » sur les deux routes du journal (contestation à ouvrir : dossier `audit` gelé).
- `rule-recouvrement-journal-others-refused` (user) : même garde ; l'accès de l'administrateur est conservé.
- `rule-recouvrement-journal-agent-never` (user) : le compte agent n'est ni `admin` ni `supervisor` ; test dédié.

### Dossiers, états, négociation (`cases`, `brain`)
- `rule-recouvrement-cases-supervisor-only` (user) : garde `supervisor` sur les six routes.
- `rule-recouvrement-case-grouping` (user) : un dossier par `debtor_id` (UNIQUE).
- `rule-recouvrement-debtor-attributes` (user) : colonnes et CHECK de `cases` / `invoices`.
- `rule-recouvrement-negotiable-amount` (user) : `NegotiableService` (SQL partagé par la fiche, la liste, les agents et le lot).
- `rule-recouvrement-negotiable-credit-notes` (inferred, default Q-RECOUVREMENT-12) : seules les lignes `kind = invoice` entrent dans la somme.
- `rule-recouvrement-negotiable-outputs` (user) : déduction des lignes de sorties `approved`/`gap` ; `coveredByOutputsCents` par facture.
- `rule-recouvrement-invoice-dispute-frozen` (user) : lignes de `freezes` de portée facture ou dossier, exclusion du négociable.
- `rule-recouvrement-prescription` (user) : étape 1 de `brain.evaluate`.
- `rule-recouvrement-amount-threshold` (user) : étape 4 ; un seul élément ouvert par dossier et motif.
- `rule-recouvrement-case-state-referential` (user) : `CaseStateService` + table de transitions en constante testée contre le référentiel.
- `rule-recouvrement-state-transitions-logged` (user) : `case_state_history`, même transaction.
- `rule-recouvrement-family-transfer-never-executed` (user) : `DailyActionService` ne produit jamais `transferred` pour une famille ; test.
- `rule-recouvrement-decision-journal` (user) : `DecisionJournal.record(...)`, table append-only.
- `rule-recouvrement-internal-reason-private` (user) : `internalReason` rendu seulement par `GET /cases/:id/decisions` ; absent de toute projection agent.
- `rule-recouvrement-evaluation-points` (inferred) : appels à `brain.evaluate` aux cinq points ; aucun ordonnanceur.
- `rule-recouvrement-commitment-held` (user) : étape 2 : cumul des allocations affectées aux factures de l'engagement, datées à partir de la date de l'inscription (voir règle ajoutée ci-dessous), comparé au cumul dû à chaque échéance échue.
- `rule-recouvrement-commitment-broken` (user) : même étape : échéance échue et cumul insuffisant ; offres de l'engagement `revoked`, retour à `open`.
- `rule-recouvrement-commitment-covers-negotiable` (inferred) : `commitment_lines` fixées à l'inscription.
- `rule-recouvrement-case-state-queue-types` (inferred, default Q-RECOUVREMENT-20) : *ajoutée par ce plan* ; seuls les éléments de file ouverts qui arrêtent la négociation (`amount_over_threshold`, `ladder_exhausted`, `human_request`, `transfer_proposed`) placent le dossier en `supervisor_queue` ; les autres types (`contestation` : le dossier est déjà `frozen`, `prescription_*`, `accounting_gap`, `unassigned_payment`, `alert`) n'ont pas cet effet.

### Imports (`recovery-imports`)
- `rule-recouvrement-import-pivot-format` (user) : définitions des cinq types ; passage par aperçu, erreurs, confirmation.
- `rule-recouvrement-import-green-light` (user) : garde `supervisor` ; aucune écriture métier avant `confirm`.
- `rule-recouvrement-import-report` (user) : calcul à l'aperçu, `recovery_import_report_items`, comparaison au dernier import confirmé du même type.
- `rule-recouvrement-import-refuse-whole` (user) : arrêt à la première erreur pour `receivables` et `payments`.
- `rule-recouvrement-money-cents` (inferred) : analyseur de montants, schémas `integer` avec `minimum`/`maximum`.
- `rule-recouvrement-receivables-duplicate-number` (user) : clé `(entite_siren, numero)` dans l'analyse.
- `rule-recouvrement-receivables-control-total` (user) : partie `controlTotal`, erreur ligne 1 colonne `solde`.
- `rule-recouvrement-receivables-extraction-date` (inferred) : identique sur toutes les lignes ; `409 imports.stale_extraction` à la confirmation.
- `rule-recouvrement-debtor-siren` (user) : colonnes `debiteur_siren`, `entite_siren`.
- `rule-recouvrement-receivables-case-grouping` (inferred) : table de hachage par débiteur (nature, SIREN, segment).
- `rule-recouvrement-receivables-snapshot` (inferred) : `confirm` de `receivables`, atomique avec l'audit.
- `rule-recouvrement-debtor-attribute-change` (inferred, default Q-RECOUVREMENT-18) : *ajoutée par ce plan* ; un débiteur déjà connu dont la nature ou le segment change dans un cliché suivant est accepté : le dossier prend les nouvelles valeurs et ses offres `current` sont `revoked` (option B : erreur de fichier, fichier refusé en entier).
- `rule-recouvrement-payments-columns` (inferred) : définition `payments`, doublon de `reference` ignoré à la confirmation.
- `rule-recouvrement-statement-fresh` (user) : erreur de fichier à l'aperçu, `status.fresh`, refus d'offre et d'ordre.
- `rule-recouvrement-lettrage-after-extraction` (user) : `LettrageService`, date strictement postérieure à l'extraction.
- `rule-recouvrement-lettrage-order` (user) : référence (mot entier, sans casse), puis montant égal à un solde unique, puis non affecté.
- `rule-recouvrement-lettrage-excess` (user) : allocation d'origine `excess`.
- `rule-recouvrement-unassigned-payment-freeze` (user) : élément `unassigned_payment` + gels `unassigned_payment`.
- `rule-recouvrement-disputes-import-freeze` (user) : `saveBatch` de `disputes` crée litige et gel.
- `rule-recouvrement-disputes-import-additive` (inferred) : facture déjà en litige ouvert = `skipped`.
- `rule-recouvrement-contacts-columns` (inferred) : définition `contacts`, remplacement avec conservation des identifiants.
- `rule-recouvrement-contact-invalid-suspends-channel` (user) : `suspended_channels` calculé à l'import ; note `suspended_channels` du rapport.
- `rule-recouvrement-documents-columns` (inferred) : définition `documents`, remplacement de l'index.
- `rule-recouvrement-import-audited` (inferred) : `@Audited` sur `confirm`, résumé sans cellule.

### Politique (`policies`)
- `rule-recouvrement-policy-versioned` (user) : `policy_versions`, empreinte unique, auteurs.
- `rule-recouvrement-policy-immutable` (user) : déclencheur, index unique partiel, transaction d'activation.
- `rule-recouvrement-policy-format` (user) : schéma Zod strict du fichier + chargement du graphe par le moteur.
- `rule-recouvrement-policy-no-business-value-in-code` (user) : test de recherche de littéraux ; tout vient du document.
- `rule-recouvrement-policy-activation-checks` (user) : `policy-checks.ts`, six contrôles bloquants.
- `rule-recouvrement-policy-floor` (user) : contrôle `floor`.
- `rule-recouvrement-policy-concessions-decreasing` (user) : contrôle `decreasing_concessions`.
- `rule-recouvrement-concessions-equal-gaps` (inferred, default Q-RECOUVREMENT-10) : écart strictement décroissant.
- `rule-recouvrement-policy-counterparts` (user) : contrôle `counterparts`.
- `rule-recouvrement-policy-schedule-limits` (user) : contrôle `schedule_limits`.
- `rule-recouvrement-policy-segments-covered` (user) : contrôle `segments_covered`.
- `rule-recouvrement-policy-witnesses` (user) : contrôle `witnesses`.
- `rule-recouvrement-policy-supervisor-only` (user) : garde `supervisor` ; le compte agent n'a aucune route lisant `policy_*`.
- `rule-recouvrement-policy-json-not-spreadsheet` (inferred) : parcours propre à deux temps.
- `rule-recouvrement-policy-audited` (inferred) : `confirm` et `activate` tracées.
- `rule-recouvrement-policy-activation-date` (inferred, default Q-RECOUVREMENT-15) : *ajoutée par ce plan* ; une version dont `versionDate` est antérieure à celle de la version active peut être activée (option A) ; option B : `409 policies.not_activatable`.

### Outils des agents (`agent-tools`, `negotiation`)
- `rule-recouvrement-agent-tools-only` (user) : `/agent/*` et `/mcp` seulement ; `RequireProfile` des autres routes refuse le profil `agent`.
- `rule-recouvrement-agent-authentication` (inferred, default Q-RECOUVREMENT-03) : jeton de la connexion du socle (`returnToken: true`), vérifié par le socle ; aucun mécanisme de jeton nouveau.
- `rule-recouvrement-agent-case-channel-access` (inferred, default Q-RECOUVREMENT-08) : `AgentAccessService`.
- `rule-recouvrement-agent-context` (user) : `AgentContextGuard` et arguments MCP validés par le même schéma.
- `rule-recouvrement-agent-calls-logged` (user) : `agent_calls`, refus compris, hors lecture par l'API.
- `rule-recouvrement-agent-idempotency` (user) : `AgentCallRunner`, index unique, `AgentCallFilter`.
- `rule-recouvrement-agent-two-transports` (user) : services communs ; test de scénario identique sur REST et MCP.
- `rule-recouvrement-agent-ai-disclosure` (user) : ouverture exige `true` (`403 agent.ai_disclosure_required`, rien d'enregistré) ; tout autre outil exige une conversation ouverte.
- `rule-recouvrement-agent-read-case` (user) : projection `AgentCaseDto`, `allowedActions` calculé.
- `rule-recouvrement-agent-no-internal-reason` (user) : projections dédiées + test de propriété.
- `rule-recouvrement-offer-anchor` (user) : première offre = rang 1, sans contrepartie.
- `rule-recouvrement-offer-descend` (user) : rang suivant seulement, contrepartie obligatoire et conforme.
- `rule-recouvrement-offer-exhausted` (user) : réponse `exhausted`, un seul élément `ladder_exhausted`, état `supervisor_queue`.
- `rule-recouvrement-offer-computation` (inferred) : `OfferService`, entiers.
- `rule-recouvrement-offer-stale-statement` (user) : `409 offers.statement_stale`.
- `rule-recouvrement-offer-exposure-ceiling` (user) : `ExposureService`.
- `rule-recouvrement-exposure-ceiling` (user) : calcul de l'encours (restes à payer des engagements `pending` à échéancier), alerte unique par version d'agent et segment ; les lots ne proposent pas d'ancrage à échéancier.
- `rule-recouvrement-commitment-exact` (user) : comparaison exacte à une offre `current`.
- `rule-recouvrement-commitment-payment-method` (inferred) : liste `paymentMethods` de la politique active.
- `rule-recouvrement-commitment-effects` (inferred) : transaction unique (engagement, offres, état, décision, ordre de confirmation).
- `rule-recouvrement-commitment-figures` (user) : réponse = chiffres de l'engagement.
- `rule-recouvrement-contestation-stops-case` (user) : `DisputeService.openFromContestation` ; ensuite `409 negotiation.stopped`.
- `rule-recouvrement-contestation-without-invoices` (inferred, default Q-RECOUVREMENT-06) : `invoiceNumbers` min 1 dans le schéma.
- `rule-recouvrement-human-request` (user) : élément `human_request`, état `supervisor_queue`.
- `rule-recouvrement-human-request-companies` (inferred, default Q-RECOUVREMENT-05) : `409 agent.human_request_not_available` pour une entreprise.
- `rule-recouvrement-complaint` (user) : table `complaints`, fait d'indicateur, aucun changement d'état.
- `rule-recouvrement-message-check` (user) : `MessageChecker`.
- `rule-recouvrement-message-known-amounts` (inferred, default Q-RECOUVREMENT-11) : conditions débloquées seulement.
- `rule-recouvrement-message-parsing` (inferred) : analyseur de montants, dates et mots.
- `rule-recouvrement-agent-conversation-bound` (inferred) : conversation liée à (compte, canal, dossier, interlocuteur).
- `rule-recouvrement-agent-evaluation` (inferred) : `brain.evaluate` avant chaque réponse sur un dossier.
- `rule-recouvrement-negotiation-stopped` (inferred) : *ajoutée par ce plan* ; `409 negotiation.stopped` quand le dossier est `frozen`, ou porte un élément ouvert `contestation`, `amount_over_threshold`, `human_request` ou `transfer_proposed`, ou est final ; l'échelle épuisée n'est pas un arrêt : `next-offer` rejoué répond de nouveau `exhausted` (cohérent avec `rule-recouvrement-offer-exhausted`).
- `rule-recouvrement-next-offer-while-committed` (inferred, default Q-RECOUVREMENT-13) : *ajoutée par ce plan* ; tant qu'un engagement est `pending`, `next-offer` répond `409 negotiation.stopped` et `allowedActions` exclut `next_offer` (option B : l'outil reste ouvert).
- `rule-recouvrement-no-rule-segment` (inferred, default Q-RECOUVREMENT-14) : *ajoutée par ce plan* ; sans règle pour (segment, nature) dans la politique active, ou sans politique active, `next-offer` répond `409 offers.no_rule` et une alerte entre dans la file (option B ; option A : refus seul).
- `rule-recouvrement-conversation-reuse` (inferred, default Q-RECOUVREMENT-16) : *ajoutée par ce plan* ; rouvrir un `X-Conversation-Id` déjà ouvert pour le même compte, dossier et interlocuteur avec une autre clé rend la conversation existante (`201`, `openedAt` d'origine) ; pour un autre dossier ou interlocuteur `409 agent.conversation_exists` (option B : toujours `409`).
- `rule-recouvrement-replay-audit` (inferred, default Q-RECOUVREMENT-19) : *ajoutée par ce plan* ; un rejeu écrit l'entrée d'audit de la route (résumé « Appel d'agent rejoué ») mais aucun effet ni nouvelle ligne `agent_calls` (option B : aucune entrée, ce qui demande de sortir le rejeu de la transaction d'audit).
- `rule-recouvrement-mcp-405-after-auth` (inferred) : *ajoutée par ce plan* ; `GET /mcp` et `DELETE /mcp` passent par la garde `agent` (`401`/`403`) puis répondent `405`.

### Politique et négociation en cours (`policies`, `negotiation`)
- `rule-recouvrement-policy-change-midway` (inferred, default Q-RECOUVREMENT-17) : *ajoutée par ce plan* ; à l'activation d'une version, toutes les offres `current` deviennent `revoked` et la négociation reprend à l'ancrage de la nouvelle version ; un engagement `pending` est conservé tel quel (option A de la question ; option B : offres conservées).

### Lot du jour (`batches`)
- `rule-recouvrement-batch-prepared-by-supervisor` (user) : garde `supervisor`.
- `rule-recouvrement-batch-brain-decides` (user) : `DailyActionService` évalue la décision JDM pour chaque dossier non final.
- `rule-recouvrement-batch-orders-structured` (user) : `conditions` structurées, sans texte.
- `rule-recouvrement-batch-order-eligibility` (user) : éligibilité et `excluded`.
- `rule-recouvrement-batch-channel-order` (inferred) : ordre `voice`, `email_sms`, `mail` ; interlocuteur par rôle puis identifiant.
- `rule-recouvrement-documents-required-blocks-reminder` (user) : pièces exigées par (segment, nature) contre `invoice_documents`.
- `rule-recouvrement-batch-statement-fresh` (user) : contrôle `statement_fresh`.
- `rule-recouvrement-batch-witnesses-replayed` (user) : contrôle `witnesses_replayed`.
- `rule-recouvrement-witness-no-order` (user) : rejeu sans écriture.
- `rule-recouvrement-batch-release-when-checks-pass` (user) : statut final du lot.
- `rule-recouvrement-batch-release-mode` (inferred, default Q-RECOUVREMENT-04) : `ready` à la préparation si tout passe.
- `rule-recouvrement-batch-blocked-release-by-decision` (user) : `release` avec motif.
- `rule-recouvrement-batch-one-per-day` (inferred) : index unique partiel, remplacement d'un lot bloqué.
- `rule-recouvrement-batch-no-duplicate-order` (user) : index unique partiel sur `send_orders`.
- `rule-recouvrement-batch-auto-stop` (user) : contrôle `decision_share`.
- `rule-recouvrement-decision-share-sigma` (inferred, default Q-RECOUVREMENT-09) : écart-type de population ; comparaison faite sur les carrés (écart² > 9 × variance).
- `rule-recouvrement-company-transfer-proposed` (inferred, default Q-RECOUVREMENT-07) : élément `transfer_proposed` pour toute nature.
- `rule-recouvrement-commitment-confirmation-immediate` (user) : `OrderService.confirmation(...)` à l'inscription, mêmes contrôles unitaires que le lot.
- `rule-recouvrement-confirmation-blocked-alert` (inferred) : alerte par ordre refusé.
- `rule-recouvrement-batch-families-no-transfer` (user) : voir `rule-recouvrement-family-transfer-never-executed`.
- `rule-recouvrement-batch-prescription-flow` (user) : la préparation appelle l'étape 1 de l'évaluation pour tous les dossiers.

### Sorties comptables (`ledger`)
- `rule-recouvrement-ledger-output-creation` (user) : à l'engagement tenu avec remise et par `write-offs`, état `to_approve`.
- `rule-recouvrement-ledger-output-content` (user) : colonnes et séquence de `ledger_outputs`.
- `rule-recouvrement-ledger-output-per-creditor` (inferred) : une sortie par entité, prorata.
- `rule-recouvrement-ledger-states` (user) : déclencheur de transitions.
- `rule-recouvrement-ledger-approve-batch` (user) : `approvals`, 1 à 500, atomique.
- `rule-recouvrement-ledger-export` (user) : `GET /ledger-outputs/export`, lecture seule.
- `rule-recouvrement-ledger-recognition` (user) : `recognize` à la confirmation de Créances (avoir portant `reference_sortie`, ou réduction de solde : solde du cliché précédent moins paiements affectés depuis moins solde importé).
- `rule-recouvrement-ledger-gap` (user) : compteur d'imports, passage en écart, élément `accounting_gap` ; `maxImports` rendu pour affichage.
- `rule-recouvrement-ledger-not-negotiable` (user) : voir négociable.
- `rule-recouvrement-ledger-write-off-proposal` (inferred) : somme demandée plus déjà couvert <= solde ; dossier `settled` refusé.
- `rule-recouvrement-ledger-supervisor-only` (user) : garde `supervisor`.
- `rule-recouvrement-ledger-no-direct-accounting` (user) : aucun client HTTP sortant dans `ledger` (test de dépendances).
- `rule-recouvrement-ledger-audited` (inferred) : `approvals` et `write-offs` tracées.

### File de décisions (`decision-queue`)
- `rule-recouvrement-queue-contents` (user) : créateurs des dix types, un par source.
- `rule-recouvrement-queue-decision-motivated` (user) : motif 1 à 1 000, décision conservée, trace d'audit.
- `rule-recouvrement-queue-allowed-decisions` (inferred) : `queue-types.ts`, source unique.
- `rule-recouvrement-queue-decided-final` (inferred) : verrou + déclencheur.
- `rule-recouvrement-queue-single-open` (inferred) : index unique partiel.
- `rule-recouvrement-queue-effects` (inferred) : effets dans la transaction de la décision.
- `rule-recouvrement-queue-unassigned-until-assigned` (user) : le gel ne tombe qu'à `assign`.
- `rule-recouvrement-queue-auto-close` (inferred) : `accounting_gap` à la constatation tardive ; `unassigned_payment` quand un cliché inclut le paiement.
- `rule-recouvrement-queue-order` (inferred) : tri `createdAt`, `id` pour `open`.

### Litiges (`disputes`)
- `rule-recouvrement-disputes-litigation-only` (user) : garde `litigation` ; le superviseur est refusé.
- `rule-recouvrement-dispute-open-freezes` (user) : ouverture, gel, recalcul d'état (`dispute_opened`).
- `rule-recouvrement-dispute-close-unfreezes` (user) : clôture, dégel, levée du gel de dossier (`freeze_released`).
- `rule-recouvrement-dispute-one-open-per-invoice` (inferred) : index unique partiel ; une contestation sur facture déjà en litige s'y rattache.
- `rule-recouvrement-dispute-contestation-origin` (user) : litige d'origine `contestation` avec texte.
- `rule-recouvrement-dispute-no-delete` (inferred) : aucune route, déclencheur.
- `rule-recouvrement-dispute-text-plain` (inferred) : texte brut ; caractères nuls refusés par le socle.

### Relecture (`reviews`)
- `rule-recouvrement-review-weekly-sample` (user) : taille = `reviewSampleSize` de la politique active au tirage ; une semaine, un échantillon.
- `rule-recouvrement-review-manual-trigger` (inferred) : `POST /review-samples`.
- `rule-recouvrement-review-pool` (inferred) : décisions `daily_action` de la semaine ISO Europe/Paris, hors lots `replaced`.
- `rule-recouvrement-review-reproducible` (user) : fonction pure de tirage.
- `rule-recouvrement-review-blind` (user) : projection avant relecture.
- `rule-recouvrement-review-gap-feeds-indicator` (user) : fait `errors`.
- `rule-recouvrement-review-final` (inferred) : déclencheur et `409 reviews.already_reviewed`.
- `rule-recouvrement-review-supervisor-only` (user) : garde `supervisor`.

### Indicateurs (`indicators`)
- `rule-recouvrement-indicators-five` (user), `rule-recouvrement-indicators-dimensions` (user), `rule-recouvrement-indicators-no-score` (user) : schéma `IndicatorRowDto` sans ratio.
- `rule-recouvrement-indicators-aggregate-only` (user) : garde `supervisor` ou `indicators` seulement ; projections sans donnée nominative.
- `rule-recouvrement-indicator-collected` (inferred), `rule-recouvrement-indicator-commitments` (inferred), `rule-recouvrement-indicator-discounts` (inferred), `rule-recouvrement-indicator-complaints` (inferred), `rule-recouvrement-indicator-errors` (inferred), `rule-recouvrement-indicators-period` (inferred) : faits décrits dans « Points de conception », agrégation SQL.

### Règles d'implémentation ajoutées par ce plan (sans effet observable nouveau)
- `rule-recouvrement-commitment-payment-date` (inferred) : un paiement compte pour un engagement s'il est affecté à une facture couverte et daté du jour de l'inscription ou après.
- `rule-recouvrement-payment-on-frozen-invoice` (inferred) : le lettrage applique aussi les paiements aux factures gelées (le gel arrête la négociation, pas la comptabilité du solde).
- `rule-recouvrement-closed-case-only-invoices` (inferred) : un dossier est `settled` quand aucune facture (`kind = invoice`) n'a de solde positif.
- `rule-recouvrement-today-paris` (inferred) : toutes les règles datées utilisent `ClockService.today()` (Europe/Paris), jamais l'heure du serveur.

## Tests

Jest dans `api/src/features/<feature>/tests/`, contre l'API de test en marche, via `@recouvrement/api-client`, données semées en SQL (comptes dans `base.users` et `base.credentials`, profil dans `base.user_profiles`), `resetData()` en `beforeEach`. Le titre de chaque test cite la règle couverte. Les tests de l'API ne remplacent pas la recette `acceptance/` (propriété de QA).

Cas systématiques pour **chaque route** : nominal ; entrée invalide (chaque borne du contrat : limites, longueurs, énumérations, clés inconnues d'un corps strict) ; `401` sans jeton ; `403 security.access_denied` pour chacun des quatre autres profils, pour un `admin` sans profil et pour un `user` sans profil, **avant** toute validation (un corps invalide avec un mauvais profil donne `403`, pas `400`) ; ressource inconnue ; ressource d'autrui là où la demande en prévoit (aperçu d'un autre superviseur, conversation d'un autre compte agent, dossier d'un autre canal) avec la même réponse que pour l'inexistant.

| Fonctionnalité | Cas propres à ajouter |
|---|---|
| `profiles` | attribution des quatre profils ; remplacement (Q-02) ; canal obligatoire/interdit/pris ; `agent` refusé sur un `admin` et `admin` refusé pour un agent (déclencheur) ; auto-modification ; retrait ; effet à la requête suivante ; `GET /profiles/me` pour chaque cas |
| `cases` | filtres combinés, tri, pagination ; montant négociable avec gel de facture, gel de dossier, prescription, sortie approuvée, avoir (Q-12) ; historique de transitions ; `internalReason` absent des autres profils ; échappement de `search` |
| `recovery-imports` | par type : fichier valide, chaque erreur de ligne, chaque contrôle bloquant ; refus entier (une seule erreur, `409 imports.file_refused`) ; total de contrôle absent/illisible/différent ; date d'extraction ; doublon de fichier ; périmé (`stale_extraction`) ; rapport (nouveaux, soldés, modifiés, sans précédent) ; lettrage (référence, montant unique, ambigu, excédent, antérieur à l'extraction, rejeu, affectation conservée) ; interlocuteurs invalides (canal suspendu) ; litiges additifs ; relevé trop ancien ; `status.fresh` ; fichier piégé (comme le socle) ; rejeu de la confirmation concurrente |
| `policies` | fichier valide et chaque cause d'invalidité ; chacun des six contrôles en échec et en succès ; Q-10 (écarts égaux) ; témoins ; doublon d'empreinte ; activation, remplacement, une seule version active, immutabilité (tentative d'`UPDATE` SQL refusée) ; `PUT`/`PATCH`/`DELETE` en `404` ; sortie `no_rule` ; graphe refusé (nœud non autorisé) |
| `agent-tools` | **Même scénario complet joué sur REST et sur MCP** (ouverture, lecture, ancrage, descente, épuisement, engagement, contestation, intervention humaine, réclamation, vérification) et comparaison des réponses (hors identifiants) et des effets en base ; MCP par le client du SDK (`initialize`, `tools/list` = huit outils, `tools/call`) et en JSON-RPC brut ; en-têtes manquants ou mal formés un par un (`400`) ; `X-Channel` incohérent ; sans déclaration IA (rien d'enregistré) ; conversation d'un autre compte ou d'un autre dossier (`404`) ; idempotence : rejeu identique (même corps, en-tête `Idempotent-Replayed`), même clé autre requête (`409`), deux appels simultanés (un seul effet, comptage en base), rejeu d'un refus, lecture rejouée ; journal des appels (succès et refus < 500, absence de ligne pour `5xx`) ; Q-13, 14, 16, 19 ; relevé périmé ; plafond d'encours ; propriété « aucune clé interdite » (`floor`, `rule`, `policy`, `segment`, `rank`, `expectedValue`…) sur toutes les réponses des huit outils ; `GET`/`DELETE /mcp` en `405` ; fidélité du motif interne : présent au journal des décisions, absent des réponses |
| `negotiation` / `brain` | calcul d'offre (arrondi à la moitié supérieure, reliquat sur la dernière échéance, frais de délai, contreparties) ; engagement exact (chaque écart d'un chiffre : `offer_mismatch`), moyen de paiement hors liste, `already_committed`, offre expirée ; engagement tenu (versement unique, échéancier) et rompu (échéance manquée, offres révoquées, retour à l'ancrage) ; prescription proche/échue (un élément par facture, pas de doublon) ; seuil et `authorize` ; changement de politique en cours de négociation (Q-17) |
| `disputes` | ouverture (facture inconnue, doublon `already_open`), clôture, gel/dégel, gel de dossier d'une contestation levé à la clôture du dernier litige, rattachement à un litige existant, texte brut conservé |
| `decision-queue` | chaque type : décisions permises, décision refusée hors liste, motif vide/trop long, double décision simultanée, effets (`authorize`, `transfer`, `reject_transfer`, `resume`, `reapprove`, `assign` avec excédent), clôture automatique, unicité des éléments ouverts, ordre |
| `ledger` | création à l'engagement tenu (par entité, prorata, reliquat), approbation par lot (tout ou rien, `not_approvable`), export (en-tête seul, guillemets, montant exact), constat par avoir portant la référence et par réduction de solde, écart après `ledgerMaxImports` imports, constat tardif, `reapprove`, passage en perte (excès, dossier soldé), transitions illégales refusées par SQL direct |
| `batches` | lot sain (Q-04), lot bloqué par chacun des quatre contrôles, libération motivée, remplacement le même jour, `already_released`, sans politique (`no_active_policy`), exclusions par raison, pièces manquantes, arrêt statistique avec historique de dix lots (Q-09) et plafond fixe avant dix, aucun doublon d'ordre (insertion SQL directe refusée), témoins sans effet (comptages avant/après), famille jamais transférée, entreprise (Q-07), confirmation d'engagement immédiate puis bloquée |
| `reviews` | tirage reproductible (vecteurs indépendants), semaine future, déjà tirée, sans décisions, sans politique, relecture à l'aveugle (aucune clé de décision avant relecture), relecture finale, écart dans l'indicateur |
| `indicators` | chaque indicateur sur un jeu semé à la main ; filtres et période ; `indicators` autorisé, `litigation` et `agent` refusés ; aucune donnée nominative dans les lignes |
| `audit` | superviseur admis, `agent`/`litigation`/`indicators` refusés, `admin` conservé, ordre de la garde avant validation |

Tests transverses : (1) **Matrice des accès** : pour toutes les routes de `cuisine:routes`, chaque profil reçoit exactement la décision attendue ; (2) **Refus par défaut** : le démarrage échoue pour une route sans déclaration (déjà couvert par le socle ; vérifier les nouvelles routes) ; (3) **Contrat** : `cuisine:openapi` ne contient aucun `5xx` et chaque borne citée dans les demandes ; (4) **Atomicité** : échec injecté au milieu d'une confirmation d'import, d'une préparation de lot, d'une décision de file : rien n'est écrit, y compris l'audit ; (5) **Immuabilité en base** : `UPDATE`/`DELETE` SQL refusés sur `decisions`, `agent_calls`, `case_state_history`, `policy_versions` (hors transitions de statut), `queue_items` décidés, `disputes` clos, `review_items` relus ; (6) **Aucune valeur métier dans le code** : recherche des littéraux interdits dans `brain/`, `negotiation/`, `batches/` ; (7) **Cohérence de l'état** : après chaque scénario, la machine d'états n'a produit que des transitions du référentiel §2 ; (8) **Charge raisonnable** : import de 100 000 lignes de créances en temps et mémoire bornés (mesure consignée, pas de seuil de réussite arbitraire).

## Ordre de fabrication

1. `profiles` + garde `RequireProfile` + contestations (voir ci-dessous).
2. `cases` (tables, états, négociable) et `policies` (moteur, contrôles, activation).
3. `recovery-imports` (cinq types, lettrage, rapport) ; `disputes` ; `decision-queue`.
4. `brain` (évaluation, prescription, offres), `negotiation`, `ledger`.
5. `agent-tools` REST puis MCP.
6. `batches`, `reviews`, `indicators`.
7. Garde du journal (après arbitrage de la contestation `audit`), regénération du client, mise à jour de `docs/socle.md` pour la section des fonctionnalités ajoutées.

## Contestations à ouvrir par l'agent de fabrication (`DISPUTES.md` du dossier de plans)

Une ligne `OPEN:` chacune, à la première occurrence du besoin :
- `OPEN: contract data-contract: tables user_profiles, cases, invoices, freezes, case_state_history, receivable_snapshots, recovery_imports (+ _rows, _errors, _report_items), payments, statements, payment_allocations, contacts, invoice_documents, policy_versions, policy_previews, decisions, indicator_facts, unlocked_offers, commitments (+ _installments, _lines), agent_conversations, agent_calls, complaints, disputes, contestations, queue_items, ledger_outputs (+ _lines), daily_batches, send_orders, review_samples, review_items ajoutées pour le module recouvrement` (ajout seul ; déclencheurs sur `base.users` pour le profil agent).
- `OPEN: permissions GET /audit-logs: admettre le profil supervisor en plus du rôle admin` et `OPEN: permissions GET /audit-logs/filters: idem` (dossier `features/audit` gelé : la garde « admin ou superviseur » ne peut être posée que si la contestation est arbitrée en faveur d'une modification de ces deux contrôleurs).
- `OPEN: permissions <operation>` pour toute opération de ce plan absente de `specifications/permissions.yaml` au moment de la fabrication (lecture seule pour les agents de fabrication ; le tableau des routes ci-dessus donne action et accès attendus).
- `OPEN: contract agent tools: les paramètres d'en-tête requis (X-Agent-Version, X-Channel, X-Conversation-Id, Idempotency-Key) et l'en-tête de réponse Idempotent-Replayed ne sont pas déclarables par @ApiRoute (platform gelée)` : sans extension de la plateforme, le document OpenAPI ne les publie pas et le contrat de référence les attend ; le comportement est implémenté malgré tout.
- `OPEN: contract POST /mcp: la réponse MCP peut être un flux (text/event-stream) selon le client ; le module ne répond qu'en application/json` (mode « réponse JSON » du transport du SDK, sans état).
- `OPEN: acceptance resetData: les tables ajoutées par le module recouvrement doivent être tronquées par le helper` (seulement si le helper ne lit pas le catalogue).

## Risques et points relevés

- **R1, journal des appels et annulation d'audit.** Un refus annule la transaction d'audit, donc la ligne de journal d'un refus ne peut pas s'y trouver : d'où `AgentCallFilter` (écriture après annulation). Si le filtre de contrôleur ne reçoit pas les erreurs levées par l'intercepteur de validation (à vérifier tôt par un test), l'écriture se déplace dans un intercepteur enregistré avant le socle.
- **R2, rejeu et audit.** La plateforme écrit une entrée d'audit à toute réponse `2xx` d'une route tracée ; un rejeu en écrit donc une (Q-RECOUVREMENT-19).
- **R3, `Idempotency-Key` sur la lecture.** La demande soumet aussi `GET /agent/cases/:caseId` à la clé et rejoue « l'état enregistré » ; la ligne `agent_calls` d'une lecture conserve donc le corps rendu (taille bornée par la facture de 100 lignes au plus ; à mesurer).
- **R4, charge de l'import.** La cohérence entre lignes d'un même débiteur et la détection de numéro en double demandent une structure par débiteur/numéro ; avec un million de lignes, la table de hachage doit être mesurée (repli : table temporaire indexée en base).
- **R5, `@gorules/zen-engine` natif.** Le module est binaire (napi) : vérifier l'installation sur la machine de fabrication et de test, et fixer un délai d'évaluation par dossier.
- **R6, déclencheur sur `base.users`.** Le refus du passage à `admin` d'un compte agent est une exception SQL non prévue par `PATCH /users/:id` (gelé) : le comportement observable est une erreur du socle ; si la recette attend un code propre, elle doit être précisée (non demandé en amont, donc non construit).
- **R7, `GET /disputes/invoices` face à `GET /disputes/:id`** et les autres routes statiques : l'ordre de déclaration est une exigence de test.
- **R8, `inputs` des décisions.** Elles conservent des entrées complètes (montants, états) ; aucune coordonnée d'interlocuteur n'y est copiée.
