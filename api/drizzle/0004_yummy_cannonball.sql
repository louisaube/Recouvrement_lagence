CREATE TABLE "base"."decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"rule_id" text,
	"policy_version_id" uuid,
	"probability" numeric(5, 4) DEFAULT '1' NOT NULL,
	"inputs" jsonb NOT NULL,
	"internal_reason" jsonb NOT NULL,
	"batch_id" uuid,
	"segment" text NOT NULL,
	"agent_version" text,
	CONSTRAINT "decisions_kind_check" CHECK ("base"."decisions"."kind" in ('daily_action', 'offer', 'commitment_check', 'threshold', 'prescription', 'exposure_ceiling')),
	CONSTRAINT "decisions_outcome_check" CHECK (char_length("base"."decisions"."outcome") between 1 and 100),
	CONSTRAINT "decisions_probability_check" CHECK ("base"."decisions"."probability" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "base"."case_state_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"cause" text NOT NULL,
	"actor" text NOT NULL,
	"reference" text,
	CONSTRAINT "case_state_history_states_check" CHECK ("base"."case_state_history"."to_state" in ('open', 'negotiating', 'committed', 'frozen', 'supervisor_queue', 'transferred', 'settled')
        and ("base"."case_state_history"."from_state" is null or "base"."case_state_history"."from_state" in ('open', 'negotiating', 'committed', 'frozen', 'supervisor_queue', 'transferred', 'settled'))),
	CONSTRAINT "case_state_history_actor_check" CHECK (char_length("base"."case_state_history"."actor") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "base"."cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"debtor_id" text NOT NULL,
	"nature" text NOT NULL,
	"debtor_siren" text,
	"segment" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"state_since" timestamp with time zone DEFAULT now() NOT NULL,
	"transferred_at" timestamp with time zone,
	"transfer_kind" text,
	"authorized_cents" bigint,
	"first_seen_on" date NOT NULL,
	"first_seen_due_cents" bigint NOT NULL,
	"first_policy_version_id" uuid,
	"rejected_transfer_rule" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_debtor_id_unique" UNIQUE("debtor_id"),
	CONSTRAINT "cases_debtor_id_check" CHECK (char_length("base"."cases"."debtor_id") between 1 and 50),
	CONSTRAINT "cases_nature_check" CHECK ("base"."cases"."nature" in ('family', 'company')),
	CONSTRAINT "cases_debtor_siren_check" CHECK (("base"."cases"."nature" = 'company') = coalesce("base"."cases"."debtor_siren" ~ '^[0-9]{9}$', false)),
	CONSTRAINT "cases_segment_check" CHECK ("base"."cases"."segment" ~ '^[a-z0-9][a-z0-9_-]{0,49}$'),
	CONSTRAINT "cases_state_check" CHECK ("base"."cases"."state" in ('open', 'negotiating', 'committed', 'frozen', 'supervisor_queue', 'transferred', 'settled')),
	CONSTRAINT "cases_transfer_kind_check" CHECK ("base"."cases"."transfer_kind" is null or "base"."cases"."transfer_kind" in ('external_collector', 'litigation', 'assignment'))
);
--> statement-breakpoint
CREATE TABLE "base"."freezes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"code" text NOT NULL,
	"scope" text NOT NULL,
	"invoice_id" uuid,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "freezes_code_check" CHECK ("base"."freezes"."code" in ('dispute', 'contestation', 'unassigned_payment')),
	CONSTRAINT "freezes_scope_check" CHECK ("base"."freezes"."scope" in ('invoice', 'case')),
	CONSTRAINT "freezes_invoice_scope_check" CHECK (("base"."freezes"."scope" = 'invoice') = ("base"."freezes"."invoice_id" is not null)),
	CONSTRAINT "freezes_reference_check" CHECK (char_length("base"."freezes"."reference") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "base"."invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"creditor_siren" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"imported_balance_cents" bigint NOT NULL,
	"balance_cents" bigint NOT NULL,
	"payer" text,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"channels" text[] NOT NULL,
	"closed_at" timestamp with time zone,
	"first_seen_on" date NOT NULL,
	"first_seen_balance_cents" bigint NOT NULL,
	"last_extraction_date" date NOT NULL,
	"output_reference" text,
	CONSTRAINT "invoices_kind_check" CHECK ("base"."invoices"."kind" in ('invoice', 'credit_note')),
	CONSTRAINT "invoices_number_check" CHECK (char_length("base"."invoices"."number") between 1 and 50),
	CONSTRAINT "invoices_creditor_siren_check" CHECK ("base"."invoices"."creditor_siren" ~ '^[0-9]{9}$'),
	CONSTRAINT "invoices_sign_check" CHECK (("base"."invoices"."kind" = 'invoice' and "base"."invoices"."amount_cents" > 0 and "base"."invoices"."balance_cents" between 0 and "base"."invoices"."amount_cents")
        or ("base"."invoices"."kind" = 'credit_note' and "base"."invoices"."amount_cents" < 0 and "base"."invoices"."balance_cents" between "base"."invoices"."amount_cents" and 0)),
	CONSTRAINT "invoices_bounds_check" CHECK (abs("base"."invoices"."amount_cents") <= 10000000000 and abs("base"."invoices"."imported_balance_cents") <= 10000000000 and abs("base"."invoices"."balance_cents") <= 10000000000 and abs("base"."invoices"."first_seen_balance_cents") <= 10000000000),
	CONSTRAINT "invoices_channels_check" CHECK ("base"."invoices"."channels" <@ array['voice', 'email_sms', 'mail']::text[])
);
--> statement-breakpoint
CREATE TABLE "base"."receivable_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"extraction_date" date NOT NULL,
	"control_total_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"case_id" uuid,
	"object_key" text NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decision_code" text,
	"decision_reason" text,
	"decided_by" uuid,
	CONSTRAINT "queue_items_type_check" CHECK ("base"."queue_items"."type" in ('contestation', 'amount_over_threshold', 'ladder_exhausted', 'unassigned_payment', 'accounting_gap', 'prescription_near', 'prescription_expired', 'alert', 'human_request', 'transfer_proposed')),
	CONSTRAINT "queue_items_status_check" CHECK ("base"."queue_items"."status" in ('open', 'decided')),
	CONSTRAINT "queue_items_object_key_check" CHECK (char_length("base"."queue_items"."object_key") between 1 and 100),
	CONSTRAINT "queue_items_summary_check" CHECK (char_length("base"."queue_items"."summary") between 1 and 300),
	CONSTRAINT "queue_items_decision_reason_check" CHECK ("base"."queue_items"."decision_reason" is null or char_length("base"."queue_items"."decision_reason") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "base"."disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"reason" text NOT NULL,
	"owner" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"close_note" text,
	"contestation_id" uuid,
	CONSTRAINT "disputes_origin_check" CHECK ("base"."disputes"."origin" in ('import', 'contestation', 'service')),
	CONSTRAINT "disputes_reason_check" CHECK (char_length("base"."disputes"."reason") between 1 and 500),
	CONSTRAINT "disputes_owner_check" CHECK (char_length("base"."disputes"."owner") between 1 and 100),
	CONSTRAINT "disputes_close_note_check" CHECK (("base"."disputes"."closed_at" is null) = ("base"."disputes"."close_note" is null) and ("base"."disputes"."closed_at" is null) = ("base"."disputes"."closed_by" is null)),
	CONSTRAINT "disputes_close_note_length_check" CHECK ("base"."disputes"."close_note" is null or char_length("base"."disputes"."close_note") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "base"."policy_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" char(64) NOT NULL,
	"document" jsonb,
	"valid" boolean NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "policy_previews_file_name_check" CHECK (char_length("base"."policy_previews"."file_name") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "base"."policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"version_date" date NOT NULL,
	"status" text NOT NULL,
	"file_hash" char(64) NOT NULL,
	"document" jsonb NOT NULL,
	"imported_by" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_by" uuid,
	"activated_at" timestamp with time zone,
	"checks_passed" boolean,
	CONSTRAINT "policy_versions_file_hash_unique" UNIQUE("file_hash"),
	CONSTRAINT "policy_versions_label_check" CHECK (char_length("base"."policy_versions"."label") between 1 and 100),
	CONSTRAINT "policy_versions_status_check" CHECK ("base"."policy_versions"."status" in ('imported', 'active', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "base"."contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"role" text NOT NULL,
	"email" text,
	"phone" text,
	"postal_address" text,
	"suspended_channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_import_id" uuid,
	CONSTRAINT "contacts_role_check" CHECK ("base"."contacts"."role" in ('accounts_payable', 'buyer', 'approver', 'payer')),
	CONSTRAINT "contacts_coordinate_check" CHECK ("base"."contacts"."email" is not null or "base"."contacts"."phone" is not null or "base"."contacts"."postal_address" is not null),
	CONSTRAINT "contacts_suspended_check" CHECK ("base"."contacts"."suspended_channels" <@ array['voice', 'email_sms', 'mail']::text[])
);
--> statement-breakpoint
CREATE TABLE "base"."invoice_documents" (
	"invoice_id" uuid NOT NULL,
	"type" text NOT NULL,
	"reference" text,
	"last_import_id" uuid,
	CONSTRAINT "invoice_documents_invoice_id_type_pk" PRIMARY KEY("invoice_id","type"),
	CONSTRAINT "invoice_documents_type_check" CHECK ("base"."invoice_documents"."type" in ('contract', 'order', 'delivery_proof')),
	CONSTRAINT "invoice_documents_reference_check" CHECK ("base"."invoice_documents"."reference" is null or char_length("base"."invoice_documents"."reference") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "base"."payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid,
	"amount_cents" bigint NOT NULL,
	"origin" text NOT NULL,
	"parent_allocation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone,
	CONSTRAINT "payment_allocations_amount_check" CHECK ("base"."payment_allocations"."amount_cents" > 0),
	CONSTRAINT "payment_allocations_origin_check" CHECK ("base"."payment_allocations"."origin" in ('reference', 'amount', 'excess', 'unassigned', 'supervisor'))
);
--> statement-breakpoint
CREATE TABLE "base"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"payment_date" date NOT NULL,
	"statement_date" date NOT NULL,
	"import_id" uuid NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "payments_reference_unique" UNIQUE("reference"),
	CONSTRAINT "payments_reference_check" CHECK (char_length("base"."payments"."reference") between 1 and 100),
	CONSTRAINT "payments_amount_check" CHECK ("base"."payments"."amount_cents" > 0 and "base"."payments"."amount_cents" <= 10000000000),
	CONSTRAINT "payments_status_check" CHECK ("base"."payments"."status" in ('already_in_balances', 'applied'))
);
--> statement-breakpoint
CREATE TABLE "base"."recovery_import_details" (
	"import_id" uuid PRIMARY KEY NOT NULL,
	"accepted" boolean DEFAULT true NOT NULL,
	"extraction_date" date,
	"control_total_cents" bigint,
	"computed_total_cents" bigint,
	"previous_import_id" uuid,
	"effects" jsonb
);
--> statement-breakpoint
CREATE TABLE "base"."recovery_import_report_categories" (
	"import_id" uuid NOT NULL,
	"category" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"case_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "recovery_import_report_categories_import_id_category_pk" PRIMARY KEY("import_id","category"),
	CONSTRAINT "recovery_import_report_categories_category_check" CHECK ("base"."recovery_import_report_categories"."category" in ('new', 'settled', 'modified', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "base"."recovery_import_report_items" (
	"import_id" uuid NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"debtor_id" text,
	"detail" text NOT NULL,
	CONSTRAINT "recovery_import_report_items_import_id_category_key_pk" PRIMARY KEY("import_id","category","key"),
	CONSTRAINT "recovery_import_report_items_category_check" CHECK ("base"."recovery_import_report_items"."category" in ('new', 'settled', 'modified', 'removed')),
	CONSTRAINT "recovery_import_report_items_key_check" CHECK (char_length("base"."recovery_import_report_items"."key") between 1 and 200),
	CONSTRAINT "recovery_import_report_items_detail_check" CHECK (char_length("base"."recovery_import_report_items"."detail") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "base"."recovery_import_report_notes" (
	"import_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "recovery_import_report_notes_import_id_code_pk" PRIMARY KEY("import_id","code")
);
--> statement-breakpoint
CREATE TABLE "base"."statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_date" date NOT NULL,
	"import_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "base"."decisions" ADD CONSTRAINT "decisions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "base"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."decisions" ADD CONSTRAINT "decisions_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "base"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."case_state_history" ADD CONSTRAINT "case_state_history_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "base"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."cases" ADD CONSTRAINT "cases_first_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("first_policy_version_id") REFERENCES "base"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."freezes" ADD CONSTRAINT "freezes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "base"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."freezes" ADD CONSTRAINT "freezes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "base"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."invoices" ADD CONSTRAINT "invoices_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "base"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."receivable_snapshots" ADD CONSTRAINT "receivable_snapshots_import_id_import_previews_id_fk" FOREIGN KEY ("import_id") REFERENCES "base"."import_previews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."queue_items" ADD CONSTRAINT "queue_items_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "base"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."disputes" ADD CONSTRAINT "disputes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "base"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."disputes" ADD CONSTRAINT "disputes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "base"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."contacts" ADD CONSTRAINT "contacts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "base"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."contacts" ADD CONSTRAINT "contacts_last_import_id_import_previews_id_fk" FOREIGN KEY ("last_import_id") REFERENCES "base"."import_previews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."invoice_documents" ADD CONSTRAINT "invoice_documents_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "base"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."invoice_documents" ADD CONSTRAINT "invoice_documents_last_import_id_import_previews_id_fk" FOREIGN KEY ("last_import_id") REFERENCES "base"."import_previews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "base"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "base"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."payments" ADD CONSTRAINT "payments_import_id_import_previews_id_fk" FOREIGN KEY ("import_id") REFERENCES "base"."import_previews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."recovery_import_details" ADD CONSTRAINT "recovery_import_details_import_id_import_previews_id_fk" FOREIGN KEY ("import_id") REFERENCES "base"."import_previews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."recovery_import_report_categories" ADD CONSTRAINT "recovery_import_report_categories_import_id_import_previews_id_fk" FOREIGN KEY ("import_id") REFERENCES "base"."import_previews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."recovery_import_report_items" ADD CONSTRAINT "recovery_import_report_items_import_id_import_previews_id_fk" FOREIGN KEY ("import_id") REFERENCES "base"."import_previews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."recovery_import_report_notes" ADD CONSTRAINT "recovery_import_report_notes_import_id_import_previews_id_fk" FOREIGN KEY ("import_id") REFERENCES "base"."import_previews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."statements" ADD CONSTRAINT "statements_import_id_import_previews_id_fk" FOREIGN KEY ("import_id") REFERENCES "base"."import_previews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_case_idx" ON "base"."decisions" USING btree ("case_id","decided_at");--> statement-breakpoint
CREATE INDEX "case_state_history_case_idx" ON "base"."case_state_history" USING btree ("case_id","id");--> statement-breakpoint
CREATE INDEX "cases_state_idx" ON "base"."cases" USING btree ("state");--> statement-breakpoint
CREATE INDEX "cases_segment_idx" ON "base"."cases" USING btree ("segment");--> statement-breakpoint
CREATE UNIQUE INDEX "freezes_active_unique" ON "base"."freezes" USING btree ("case_id","code","source_type","source_id") WHERE "base"."freezes"."released_at" is null;--> statement-breakpoint
CREATE INDEX "freezes_case_idx" ON "base"."freezes" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_creditor_number_unique" ON "base"."invoices" USING btree ("creditor_siren","number");--> statement-breakpoint
CREATE INDEX "invoices_case_idx" ON "base"."invoices" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "invoices_number_prefix_idx" ON "base"."invoices" USING btree (lower("number") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "receivable_snapshots_extraction_idx" ON "base"."receivable_snapshots" USING btree ("extraction_date","confirmed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "queue_items_single_open" ON "base"."queue_items" USING btree ("type","object_key") WHERE "base"."queue_items"."status" = 'open';--> statement-breakpoint
CREATE INDEX "queue_items_case_idx" ON "base"."queue_items" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "queue_items_status_created_idx" ON "base"."queue_items" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_one_open_per_invoice" ON "base"."disputes" USING btree ("invoice_id") WHERE "base"."disputes"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "disputes_case_idx" ON "base"."disputes" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "disputes_opened_idx" ON "base"."disputes" USING btree ("opened_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_one_active" ON "base"."policy_versions" USING btree ("status") WHERE "base"."policy_versions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_natural_key" ON "base"."contacts" USING btree ("case_id","role",coalesce("email", ''),coalesce("phone", ''),coalesce("postal_address", ''));--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_idx" ON "base"."payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_payment_idx" ON "base"."payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payments_payment_date_idx" ON "base"."payments" USING btree ("payment_date");