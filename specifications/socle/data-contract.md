# Contrat de données du socle

Extrait mécaniquement du schéma PostgreSQL (schéma `base`) par introspection (`information_schema`, `pg_indexes`). C'est une interface : les tests de recette lisent et écrivent ces tables directement. Noms de tables et de colonnes, types, nullabilité, clés et unicités doivent être respectés à l'identique ; la manière de les créer (ORM, migrations) est libre.

## Types énumérés

- `base.user_role` : `user`, `admin`.
- `base.credential_type` : `token`.

## Règles transverses

- Identifiants : `uuid` générés par la base (`gen_random_uuid()`), sauf mention contraire.
- Horodatages : `timestamp with time zone`, valeur par défaut `now()`.
- Mots de passe : une ligne de `credentials` par compte, `type = 'token'`, colonne `password` = empreinte bcrypt de coût 10 (préfixe `$2b$10$`). Les tests créent des comptes en écrivant ces deux tables.
- Les tables de démonstration propres aux tests unitaires de l'import ne font pas partie du contrat.

## `base.audit_logs`

| Colonne | Type | Nul | Défaut |
|---|---|---|---|
| `id` | uuid | non | `gen_random_uuid()` |
| `occurred_at` | timestamp with time zone | non | `date_trunc('milliseconds'::text, clock_timestamp())` |
| `actor_id` | uuid | non |  |
| `actor_email` | text | non |  |
| `action` | text | non |  |
| `object_type` | text | non |  |
| `object_id` | text | non |  |
| `scope_code` | text | oui |  |
| `summary` | text | non |  |

- Clé primaire : `id`

## `base.credentials`

| Colonne | Type | Nul | Défaut |
|---|---|---|---|
| `id` | uuid | non | `gen_random_uuid()` |
| `user_id` | uuid | non |  |
| `password` | text | non |  |
| `type` | enum `base.credential_type` (`token`) | non |  |
| `created_at` | timestamp with time zone | non | `now()` |
| `updated_at` | timestamp with time zone | non | `now()` |

- Clé étrangère : `user_id` vers `base.users(id)`, suppression : CASCADE
- Clé primaire : `id`

## `base.group_scopes`

| Colonne | Type | Nul | Défaut |
|---|---|---|---|
| `group_id` | uuid | non |  |
| `scope_id` | uuid | non |  |
| `created_at` | timestamp with time zone | non | `now()` |

- Clé étrangère : `group_id` vers `base.groups(id)`, suppression : CASCADE
- Clé étrangère : `scope_id` vers `base.scopes(id)`, suppression : RESTRICT
- Clé primaire : `group_id,scope_id`
- Index unique : `btree (group_id, scope_id)`

## `base.group_users`

| Colonne | Type | Nul | Défaut |
|---|---|---|---|
| `group_id` | uuid | non |  |
| `user_id` | uuid | non |  |
| `created_at` | timestamp with time zone | non | `now()` |

- Clé étrangère : `group_id` vers `base.groups(id)`, suppression : CASCADE
- Clé étrangère : `user_id` vers `base.users(id)`, suppression : CASCADE
- Clé primaire : `group_id,user_id`
- Index unique : `btree (group_id, user_id)`

## `base.groups`

| Colonne | Type | Nul | Défaut |
|---|---|---|---|
| `id` | uuid | non | `gen_random_uuid()` |
| `name` | text | non |  |
| `created_at` | timestamp with time zone | non | `now()` |
| `updated_at` | timestamp with time zone | non | `now()` |

- Clé primaire : `id`
- Index unique : `btree (lower(name))`

## `base.import_preview_errors`

| Colonne | Type | Nul | Défaut |
|---|---|---|---|
| `preview_id` | uuid | non |  |
| `seq` | bigint | non |  |
| `row_number` | integer | non |  |
| `column` | text | non |  |
| `reason` | text | non |  |

- Clé étrangère : `preview_id` vers `base.import_previews(id)`, suppression : CASCADE
- Clé primaire : `preview_id,seq`
- Index unique : `btree (preview_id, seq)`

## `base.import_preview_rows`

| Colonne | Type | Nul | Défaut |
|---|---|---|---|
| `preview_id` | uuid | non |  |
| `row_number` | integer | non |  |
| `dedupe_key` | text | oui |  |
| `data` | jsonb | oui |  |

- Clé étrangère : `preview_id` vers `base.import_previews(id)`, suppression : CASCADE
- Clé primaire : `preview_id,row_number`
- Index unique : `btree (preview_id, dedupe_key) WHERE (dedupe_key IS NOT NULL)`
- Index unique : `btree (preview_id, row_number)`

## `base.import_previews`

| Colonne | Type | Nul | Défaut |
|---|---|---|---|
| `id` | uuid | non | `gen_random_uuid()` |
| `feature` | text | non |  |
| `actor_id` | uuid | non |  |
| `file_name` | text | non |  |
| `file_hash` | text | non |  |
| `status` | text | non |  |
| `total_rows` | integer | non | `0` |
| `valid_rows` | integer | non | `0` |
| `error_rows` | integer | non | `0` |
| `error_entries` | integer | non | `0` |
| `created_count` | integer | oui |  |
| `skipped_count` | integer | oui |  |
| `created_at` | timestamp with time zone | non | `now()` |
| `expires_at` | timestamp with time zone | non |  |
| `confirmed_at` | timestamp with time zone | oui |  |

- Clé primaire : `id`
- Index unique : `btree (feature, file_hash) WHERE (status = 'confirmed'::text)`

## `base.scopes`

| Colonne | Type | Nul | Défaut |
|---|---|---|---|
| `id` | uuid | non | `gen_random_uuid()` |
| `code` | text | non |  |
| `name` | text | non |  |
| `created_at` | timestamp with time zone | non | `now()` |
| `updated_at` | timestamp with time zone | non | `now()` |

- Clé primaire : `id`
- Index unique : `btree (code)`

## `base.users`

| Colonne | Type | Nul | Défaut |
|---|---|---|---|
| `id` | uuid | non | `gen_random_uuid()` |
| `email` | text | non |  |
| `role` | enum `base.user_role` (`user`, `admin`) | non |  |
| `created_at` | timestamp with time zone | non | `now()` |
| `updated_at` | timestamp with time zone | non | `now()` |

- Clé primaire : `id`
- Index unique : `btree (email)`

