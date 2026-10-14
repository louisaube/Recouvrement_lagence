# Coverage - version `v1-cerveau-recouvrement`

Acceptance files (black box, HTTP + SQL), all new, none of a previous version touched:
`acceptance-v1-profils`, `acceptance-v1-politiques`, `acceptance-v1-imports`, `acceptance-v1-dossiers`, `acceptance-v1-agents` (REST), `acceptance-v1-mcp`, `acceptance-v1-engagements`, `acceptance-v1-lot-du-jour`, `acceptance-v1-file-decisions`, `acceptance-v1-sorties-comptables`, `acceptance-v1-litiges`, `acceptance-v1-relecture`, `acceptance-v1-indicateurs` (all `.test.ts`), with the shared library `acceptance/recouvrement-helpers.ts` (accounts and profiles by SQL, import runner, policy builder, world set-up, REST and MCP agent clients, normaliser for the two-transport comparison, forbidden-key scanner, time-shift SQL helpers).

**Variants.** No `acceptance/variants.yaml` is needed: every scenario runs in the default variant. Everything the rules make variable (ladders, thresholds, payment methods, ceilings, sample size, caps, horizon, required documents) lives in the policy file imported through the API, so the tests change it by importing another version, not by starting the API differently.

**Method.** The acceptance agent could not run the suite (no shell): the tests were written against the requests and the plan only, and have never been executed. They are the first thing to run; the points that rest on a guess are listed under « Assumptions ». Time is not injectable: dates are relative to the day of the run (Europe/Paris), and the passage of time is simulated by SQL on `base.commitment_installments.due_date`, `base.invoices.due_date`, `base.send_orders.order_date` and `base.daily_batches.batch_date` (helpers `shiftCommitmentDates`, `setDueDate`, `moveBatchBack`). The history of the statistical auto-stop is built by preparing real batches and moving each one back in time.

`specifications/permissions.yaml` : 58 operations added (every route of the requests, `GET`/`POST`/`DELETE /mcp` included, profile-guarded routes as `allow: []`, `GET /profiles/me` as `[user, admin]`, `/user-profiles` as `[admin]`); `GET /audit-logs` and `GET /audit-logs/filters` changed from `[admin]` to `[]` (admin OR supervisor by a custom guard). `ownership: own` with `cross_owner_tests` (exact titles): the import preview routes (errors, report, report/items, confirm), `POST /policy-versions/previews/:previewId/confirm`, and the agent conversation routes (`/agent/cases/:caseId*`, `/agent/messages/check`, `POST /mcp`).

## Decisions of the owner and defaults (one test each, `[rule-…][D-xxxx]`)

| Decision | Chosen option | Test (file) |
|---|---|---|
| D-0002 (Q-06) | A: invoice numbers mandatory | `agents`: « a contestation without invoice numbers (absent or empty) is refused 400 … nothing is frozen » |
| D-0003 (Q-07) | B: transfer always proposed | `lot-du-jour`: « the transfer of a company is proposed to the supervisor like the one of a family … » |
| D-0004 (Q-08) | A: open to a channel without a ready batch | `agents`: « a case with no ready batch is open to the voice channel … » |
| D-0005 (Q-09) | A: population standard deviation | `lot-du-jour`: « with ten previous batches at 40 % and 60 % … a batch at 81 % is blocked » |
| D-0006 (Q-10) | A: strictly decreasing gaps | `politiques`: « [concessions-equal-gaps][D-0006] » |
| D-0007 (Q-11) | A: unlocked conditions only | `agents`: « the balance of an invoice is not an unlocked amount … » |
| D-0008 (Q-12) | A: credit notes not deducted | `dossiers`: « the negotiable amount is the sum of the invoices only … » |
| D-0009 (Q-13) | A: no next offer while committed | `agents`: « while a commitment is pending the next offer is refused 409 negotiation.stopped … » |
| D-0010 (Q-14) | B: refusal and alert | `agents`: « a case whose segment has no rule … 409 offers.no_rule and an alert … » (and the no-policy variant) |
| D-0011 (Q-15) | A: older version activatable | `politiques`: « [policy-activation-date][D-0011] » |
| D-0012 (Q-16) | A: conversation reuse | `agents`: « opening again with the same identifier, case and interlocutor … » |
| D-0013 (Q-17) | A: offers revoked at activation | `agents`: « after the activation of another version the unlocked offers are revoked … » |
| D-0014 (Q-18) | A: attribute change accepted | `imports`: « [debtor-attribute-change][D-0014] » (two tests) |
| D-0015 (Q-19) | A: replay audited | `agents`: « the replay of a commitment writes a second audit entry … » |
| D-0016 (Q-20) | A: only stopping items queue the case | `dossiers`: « a near prescription item does not put the case in the supervisor queue … » |
| D-0017 (Q-01) | A: admin without profile refused | `profils`: « [admin-no-business-access][D-0017] » |
| D-0018 (Q-02) | A: single profile, replaced | `profils`: « [profile-single][D-0018] » |
| D-0019 (Q-03) | A: login with `returnToken` | `agents`: « the agent logs in with the socle login (returnToken: true) … » |
| D-0020 (Q-04) | A: ready at preparation | `lot-du-jour`: « when all the checks pass the batch is ready from the preparation, with no releaser … » |
| D-0021 (Q-05) | A: no human request for a company | `agents`: « for a company the tool is refused 409 agent.human_request_not_available … » |

## Rules

Test files are given without the `acceptance-v1-` prefix. « several » means more than three tests carry the id.

### Profiles, journal, access
| Rule id | Coverage |
|---|---|
| `rule-recouvrement-profiles-assigned-by-admin` | `profils`: assignment of the four profiles by an admin, listing sorted by e-mail, 400/404, 403 for non-admins, effect on the next request |
| `rule-recouvrement-profile-server-enforced` | `profils` (probe of every route group with each profile, profile removed between two requests with the same token, guard before validation), `dossiers` |
| `rule-recouvrement-profile-single` [D-0018], `rule-recouvrement-admin-no-business-access` [D-0017], `rule-recouvrement-agent-channel-required`, `-one-per-channel`, `-user-role`, `rule-recouvrement-own-profile-locked`, `rule-recouvrement-profile-no-delete` | `profils` |
| `rule-recouvrement-journal-supervisor`, `-others-refused`, `-agent-never` | `profils`; audit entries of every new action are read by the supervisor in the other files |
| `rule-recouvrement-cases-supervisor-only`, `-policy-supervisor-only`, `-ledger-supervisor-only`, `-review-supervisor-only`, `-batch-prepared-by-supervisor`, `-disputes-litigation-only`, `-indicators-aggregate-only`, `-agent-tools-only` | `profils` (access matrix), then in the file of each feature (401, 403 for every other profile, plain user, profile-less admin) |
| `rule-recouvrement-mcp-405-after-auth` | `profils`, `mcp` |

### Cases, negotiable amount, states
| Rule id | Coverage |
|---|---|
| `rule-recouvrement-cases-supervisor-only`, `-case-grouping`, `-debtor-attributes`, `-debtor-siren` | `dossiers` (summary, detail, filters, sort, pagination, `search` with `%` and `_` literal), `imports` |
| `rule-recouvrement-negotiable-amount`, `-negotiable-credit-notes` [D-0008], `-negotiable-outputs`, `-invoice-dispute-frozen` | `dossiers`, `sorties-comptables`, `litiges` |
| `rule-recouvrement-prescription`, `-batch-prescription-flow` | `dossiers` (expired the day of the limit, near from the alert delay, one item per invoice, no duplicate on the second preparation) |
| `rule-recouvrement-amount-threshold`, `-negotiation-stopped` | `dossiers`, `agents`, `file-decisions` (authorize) |
| `rule-recouvrement-case-state-referential`, `-state-transitions-logged`, `-case-state-queue-types` [D-0016] | `dossiers` (every history read is checked against the referential table copied from §2), `file-decisions`, `litiges`, `imports` |
| `rule-recouvrement-closed-case-only-invoices` | `imports` |
| `rule-recouvrement-decision-journal`, `-internal-reason-private` | `dossiers` (inputs, rule, probability 1, policy version, newest first, append-only in SQL, 403 for the other profiles), `agents` (no internal key in any agent response) |
| `rule-recouvrement-evaluation-points`, `-commitment-held`, `-commitment-broken`, `-commitment-covers-negotiable` | `engagements` (evaluation by import, by batch, by agent read) |
| `rule-recouvrement-family-transfer-never-executed` | `lot-du-jour`, `file-decisions` |

### Imports
| Rule id | Coverage |
|---|---|
| `rule-recouvrement-import-pivot-format`, `-import-green-light`, `-import-report`, `-import-refuse-whole`, `-import-no-double`, `-import-audited`, `-money-cents`, `-receivables-*` (duplicate-number, control-total, extraction-date, case-grouping, snapshot), `-debtor-attribute-change` [D-0014], `-payments-columns`, `-statement-fresh`, `-lettrage-*` (after-extraction, order, excess), `-unassigned-payment-freeze`, `-payment-on-frozen-invoice`, `-disputes-import-*`, `-contacts-columns`, `-contact-invalid-suspends-channel`, `-documents-columns` | `imports` (several tests each) |
| `rule-recouvrement-queue-unassigned-until-assigned`, `-queue-auto-close` | `imports`, `file-decisions`, `sorties-comptables` |

### Policy
| Rule id | Coverage |
|---|---|
| `rule-recouvrement-policy-versioned`, `-immutable`, `-format`, `-json-not-spreadsheet`, `-audited`, `-supervisor-only`, `-activation-checks`, `-floor`, `-concessions-decreasing`, `-counterparts`, `-schedule-limits`, `-segments-covered`, `-witnesses`, `-activation-date` [D-0011], `rule-recouvrement-concessions-equal-gaps` [D-0006] | `politiques` (each of the six checks failing and passing, immutability by SQL, PUT/PATCH/DELETE 404, file traps) |
| `rule-recouvrement-policy-change-midway` [D-0013] | `agents` |
| `rule-recouvrement-policy-no-business-value-in-code` | `agents` (a custom ladder, payment methods, ceilings, thresholds, caps, horizon and sample size change the answers, so no value is hard-coded). The source scan itself is not observable. |

### Agent tools (REST and MCP)
| Rule id | Coverage |
|---|---|
| `rule-recouvrement-agent-authentication` [D-0019], `-agent-context`, `-agent-ai-disclosure`, `-agent-case-channel-access` [D-0004], `-agent-conversation-bound`, `-conversation-reuse` [D-0012] | `agents`, `mcp` |
| `rule-recouvrement-agent-read-case`, `-agent-no-internal-reason` | `agents` (channel coordinates only, frozen invoices left out, current offer, allowed actions; forbidden-key scan on the whole scenario) |
| `rule-recouvrement-offer-anchor`, `-offer-descend`, `-offer-exhausted`, `-offer-computation`, `-offer-stale-statement`, `-offer-exposure-ceiling`, `-exposure-ceiling` | `agents`, `lot-du-jour` (half-up rounding, cents left on the last installment, company delay fee, first-payment amount, firm date) |
| `rule-recouvrement-commitment-exact`, `-commitment-payment-method`, `-commitment-effects`, `-commitment-figures`, `-next-offer-while-committed` [D-0009] | `agents` |
| `rule-recouvrement-contestation-stops-case`, `-contestation-without-invoices` [D-0002], `-human-request`, `-human-request-companies` [D-0021], `-complaint` | `agents`, `litiges`, `file-decisions` |
| `rule-recouvrement-message-check`, `-message-known-amounts` [D-0007], `-message-parsing` | `agents` (five date forms, amount forms, internal terms, whole word, 50 violations at most) |
| `rule-recouvrement-agent-idempotency`, `-agent-calls-logged`, `-replay-audit` [D-0015] | `agents`, `mcp` (replay, conflict, refusal replayed, simultaneous calls, read replayed, per-account keys, rows of the calls table by SQL, audit summaries without free text) |
| `rule-recouvrement-agent-two-transports`, `-agent-evaluation`, `-no-rule-segment` [D-0010] | `mcp` (same scenario on REST then MCP, same responses once identifiers are normalised, same effects), `agents`, `engagements` |

### Daily batch
| Rule id | Coverage |
|---|---|
| `rule-recouvrement-batch-prepared-by-supervisor`, `-batch-brain-decides`, `-batch-orders-structured`, `-batch-order-eligibility`, `-batch-channel-order`, `-documents-required-blocks-reminder`, `-batch-statement-fresh`, `-batch-witnesses-replayed`, `-witness-no-order`, `-batch-release-when-checks-pass`, `-batch-release-mode` [D-0020], `-batch-blocked-release-by-decision`, `-batch-one-per-day`, `-batch-no-duplicate-order`, `-batch-auto-stop`, `-decision-share-sigma` [D-0005], `-company-transfer-proposed` [D-0003], `-batch-families-no-transfer`, `-commitment-confirmation-immediate`, `-exposure-ceiling` | `lot-du-jour` |

### Decision queue, ledger, disputes, review, indicators
| Rule id | Coverage |
|---|---|
| `rule-recouvrement-queue-contents`, `-queue-decision-motivated`, `-queue-allowed-decisions`, `-queue-decided-final`, `-queue-single-open`, `-queue-effects`, `-queue-order` | `file-decisions` (reading, motivated decisions, reject_transfer, assign with excess, concurrent decisions) and `agents` (block « décisions de la file de décisions » : allowed decisions per type, effects of authorize, transfer, approve_transfer, resume, keep, acknowledge, which go through the agent tools) |
| `rule-recouvrement-ledger-output-creation`, `-output-content`, `-output-per-creditor`, `-ledger-states`, `-approve-batch`, `-export`, `-recognition`, `-gap`, `-not-negotiable`, `-write-off-proposal`, `-ledger-supervisor-only`, `-ledger-no-direct-accounting`, `-ledger-audited` | `sorties-comptables`, `engagements` (discount per creditor, pro rata, remainder on the greatest balance) |
| `rule-recouvrement-disputes-litigation-only`, `-dispute-open-freezes`, `-dispute-close-unfreezes`, `-dispute-one-open-per-invoice`, `-dispute-contestation-origin`, `-dispute-no-delete`, `-dispute-text-plain` | `litiges` |
| `rule-recouvrement-review-weekly-sample`, `-review-manual-trigger`, `-review-pool`, `-review-reproducible` (the expected draw is recomputed in the test from the published algorithm), `-review-blind`, `-review-gap-feeds-indicator`, `-review-final`, `-review-supervisor-only` | `relecture` |
| `rule-recouvrement-indicators-five`, `-indicators-dimensions`, `-indicators-no-score`, `-indicators-aggregate-only`, `-indicators-period`, `-indicator-commitments`, `-indicator-discounts`, `-indicator-complaints`, `-indicator-errors`, `-indicator-collected` | `indicateurs`, `relecture` |

## Not observable through the API (or only in part)

| Rule or check | Reason |
|---|---|
| `rule-recouvrement-today-paris` | No clock can be injected; the tests only use dates relative to the day of the run. Midnight Europe/Paris cases are left to the unit tests of the API. |
| `rule-recouvrement-indicator-collected` (the amounts) | The horizon is « first appearance + `horizonDays` »; the first-appearance date has no column in the data contract that the tests may shift. Only the shape, the integer type and « nothing before the horizon » are asserted. |
| `rule-recouvrement-confirmation-blocked-alert` | A unit check can refuse a confirmation only when the statement is stale, the channel unreachable or a duplicate exists, which the commitment tool itself prevents before registering. Not reachable deterministically; the `planned` case is covered. |
| `rule-recouvrement-batch-witnesses-replayed` (failure) | The witnesses are checked at activation with the same engine; a deviation at batch time would need the stored witnesses to be edited, which the immutable trigger forbids. Only the passing check and « no side effect » are asserted. |
| `rule-recouvrement-batch-order-eligibility` (`channel_suspended`, `covered_by_outputs` counts) | The exact conditions that suspend a channel are in the import specification of the contacts (covered there); the batch exclusion count by this reason is asserted loosely (`no_contact` or `channel_not_authorized`). |
| `rule-recouvrement-batch-no-duplicate-order` (direct SQL insertion of a duplicate) | The `send_orders` column list is not in the data contract; the tests assert one active order per case, type and day through the API, not the unique index. |
| `rule-recouvrement-policy-no-business-value-in-code` (source scan), module cycles, no outgoing HTTP / SMTP / model SDK, 100 000-row load, atomicity by fault injection, rule coverage by title in `api/` tests, the OpenAPI contract robustness test | These are code, unit-test or tooling checks of the API (plan « Tests transverses »), not black-box behaviours. The generic robustness test of the socle contract covers `POST /mcp` once the contract is published. |
| Official MCP SDK client | The suite speaks raw JSON-RPC over HTTP (`initialize`, `tools/list`, `tools/call`), which any MCP client sends; the SDK client is not a dependency of `acceptance/`. |

## Assumptions (to check first when the suite runs)

- Table names read by SQL: `base.agent_calls`, `base.agent_conversations`, `base.complaints`, `base.send_orders` (`kind`, `status`, `batch_id`, `order_date`), `base.decisions` (`kind`, `outcome`), `base.case_state_history`, `base.queue_items`, `base.ledger_outputs`, `base.policy_versions` (`status`), `base.daily_batches` (`status`, `batch_date`), `base.cases` (`state`, `debtor_id`), `base.invoices` (`number`, `due_date`), `base.commitment_installments` (`due_date`). They come from the module plan; the data contract is extended by the owner. If one differs the helper or the test is a one-line fix.
- Invoice numbers `FA-…` appear in payment references as whole words (`VIR FA-001`), the lettrage matching « reference, whole word, case-insensitive ».
- A default policy built by the helpers satisfies the six checks (ladder 100/90/85/82 % gaps 1000-500-300, counterparts firm date, first payment 30 %, direct debit, three installments of 30 days, family without fee, company with 200 bp fee), and its witnesses.
- In `GET /cases/:id`, `freezes` items expose `code` (or `scope`/`type`) containing `contestation`/`dispute`; `unlockedOffers[].status` and `commitments[]` are present. The tests accept the freeze label under any of the three keys.
- Reading an agent case on a channel gives only the coordinate useful to the channel (voice: phone only; mail: postal address only; `email_sms`: e-mail and/or phone).
- The export separator for the invoice numbers is « ; » with or without a space.
- The ledger recognition formula compares the previous snapshot balance minus payments applied since with the imported balance (the previous snapshot is the one preceding the import).
- An unassigned payment is produced by two open invoices of equal balance (the amount rule then finds no unique balance); the payment « VIR INCONNU » has no invoice reference.
- A review draw of the current ISO week is accepted (only a future week is refused).
- The statistical auto-stop test uses 100 cases and ten history batches moved back by 1 to 10 days, so it runs close to a minute; its timeout is 600 s. `jest` runs in band.
