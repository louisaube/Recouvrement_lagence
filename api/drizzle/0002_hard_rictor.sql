CREATE TABLE "base"."user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"profile" text NOT NULL,
	"channel" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_profile_check" CHECK ("base"."user_profiles"."profile" in ('supervisor', 'agent', 'litigation', 'indicators')),
	CONSTRAINT "user_profiles_channel_check" CHECK ("base"."user_profiles"."channel" is null or "base"."user_profiles"."channel" in ('voice', 'email_sms', 'mail')),
	CONSTRAINT "user_profiles_agent_channel_check" CHECK (("base"."user_profiles"."profile" = 'agent') = ("base"."user_profiles"."channel" is not null))
);
--> statement-breakpoint
ALTER TABLE "base"."user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "base"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_agent_channel_unique" ON "base"."user_profiles" USING btree ("channel") WHERE "base"."user_profiles"."profile" = 'agent';