CREATE TABLE "parent_otp" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "parent_otp_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"challenge_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"phone" text NOT NULL,
	"reg_no" text NOT NULL,
	"parent_contact_id" integer,
	"tries" smallint DEFAULT 0 NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "parent_otp_challenge_hash_unique" UNIQUE("challenge_hash"),
	CONSTRAINT "parent_otp_phone_format" CHECK ("parent_otp"."phone" ~ '^\+91[6-9][0-9]{9}$'),
	CONSTRAINT "parent_otp_tries_range" CHECK ("parent_otp"."tries" BETWEEN 0 AND 20)
);
--> statement-breakpoint
CREATE TABLE "parent_session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" text
);
--> statement-breakpoint
ALTER TABLE "parent_otp" ADD CONSTRAINT "parent_otp_parent_contact_id_parent_contact_id_fk" FOREIGN KEY ("parent_contact_id") REFERENCES "public"."parent_contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parent_otp_phone_created_idx" ON "parent_otp" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "parent_otp_ip_created_idx" ON "parent_otp" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "parent_session_phone_idx" ON "parent_session" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "parent_session_expires_idx" ON "parent_session" USING btree ("expires_at");