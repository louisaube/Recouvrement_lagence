CREATE TABLE "base"."daily_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_date" date NOT NULL,
	"status" text NOT NULL,
	"prepared_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"replaced_by" uuid,
	"policy_version_id" uuid,
	"case_count" integer NOT NULL,
	"checks" jsonb NOT NULL,
	"shares" jsonb NOT NULL,
	"excluded" jsonb NOT NULL,
	CONSTRAINT "daily_batches_status_check" CHECK ("base"."daily_batches"."status" in ('blocked', 'ready', 'replaced')),
	CONSTRAINT "daily_batches_case_count_check" CHECK ("base"."daily_batches"."case_count" >= 0),
	CONSTRAINT "daily_batches_release_reason_check" CHECK ("base"."daily_batches"."release_reason" is null or char_length("base"."daily_batches"."release_reason") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "base"."send_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"case_id" uuid NOT NULL,
	"interlocutor_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"block_reason" text,
	"order_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "send_orders_kind_check" CHECK ("base"."send_orders"."kind" in ('reminder', 'proposal', 'commitment_confirmation')),
	CONSTRAINT "send_orders_status_check" CHECK ("base"."send_orders"."status" in ('planned', 'blocked', 'cancelled')),
	CONSTRAINT "send_orders_channel_check" CHECK ("base"."send_orders"."channel" in ('voice', 'email_sms', 'mail')),
	CONSTRAINT "send_orders_block_reason_check" CHECK ("base"."send_orders"."block_reason" is null or char_length("base"."send_orders"."block_reason") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "base"."daily_batches" ADD CONSTRAINT "daily_batches_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "base"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."send_orders" ADD CONSTRAINT "send_orders_batch_id_daily_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "base"."daily_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."send_orders" ADD CONSTRAINT "send_orders_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "base"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."send_orders" ADD CONSTRAINT "send_orders_interlocutor_id_contacts_id_fk" FOREIGN KEY ("interlocutor_id") REFERENCES "base"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_batches_one_per_day" ON "base"."daily_batches" USING btree ("batch_date") WHERE "base"."daily_batches"."status" <> 'replaced';--> statement-breakpoint
CREATE INDEX "daily_batches_date_idx" ON "base"."daily_batches" USING btree ("batch_date","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "send_orders_one_active" ON "base"."send_orders" USING btree ("case_id","kind","order_date") WHERE "base"."send_orders"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "send_orders_batch_idx" ON "base"."send_orders" USING btree ("batch_id");