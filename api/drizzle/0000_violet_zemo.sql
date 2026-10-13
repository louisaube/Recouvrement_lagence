CREATE SCHEMA IF NOT EXISTS "base";--> statement-breakpoint
CREATE TYPE "base"."credential_type" AS ENUM('token');--> statement-breakpoint
CREATE TYPE "base"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "base"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT date_trunc('milliseconds'::text, clock_timestamp()) NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"scope_code" text,
	"summary" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."group_scopes" (
	"group_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_scopes_group_id_scope_id_pk" PRIMARY KEY("group_id","scope_id")
);
--> statement-breakpoint
CREATE TABLE "base"."group_users" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_users_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "base"."groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."import_preview_errors" (
	"preview_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"row_number" integer NOT NULL,
	"column" text NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "import_preview_errors_preview_id_seq_pk" PRIMARY KEY("preview_id","seq")
);
--> statement-breakpoint
CREATE TABLE "base"."import_preview_rows" (
	"preview_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"dedupe_key" text,
	"data" jsonb,
	CONSTRAINT "import_preview_rows_preview_id_row_number_pk" PRIMARY KEY("preview_id","row_number")
);
--> statement-breakpoint
CREATE TABLE "base"."import_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"status" text NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"error_entries" integer DEFAULT 0 NOT NULL,
	"created_count" integer,
	"skipped_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "base"."scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"password" text NOT NULL,
	"type" "base"."credential_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "base"."user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "base"."group_scopes" ADD CONSTRAINT "group_scopes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "base"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."group_scopes" ADD CONSTRAINT "group_scopes_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "base"."scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."group_users" ADD CONSTRAINT "group_users_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "base"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."group_users" ADD CONSTRAINT "group_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "base"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."import_preview_errors" ADD CONSTRAINT "import_preview_errors_preview_id_import_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "base"."import_previews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."import_preview_rows" ADD CONSTRAINT "import_preview_rows_preview_id_import_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "base"."import_previews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "base"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_scopes_group_id_scope_id_unique" ON "base"."group_scopes" USING btree ("group_id","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_users_group_id_user_id_unique" ON "base"."group_users" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_name_lower_unique" ON "base"."groups" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "import_preview_errors_preview_id_seq_unique" ON "base"."import_preview_errors" USING btree ("preview_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "import_preview_rows_preview_id_row_number_unique" ON "base"."import_preview_rows" USING btree ("preview_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "import_preview_rows_preview_id_dedupe_key_unique" ON "base"."import_preview_rows" USING btree ("preview_id","dedupe_key") WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "import_previews_feature_file_hash_confirmed_unique" ON "base"."import_previews" USING btree ("feature","file_hash") WHERE status = 'confirmed'::text;--> statement-breakpoint
CREATE UNIQUE INDEX "scopes_code_unique" ON "base"."scopes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "base"."users" USING btree ("email");