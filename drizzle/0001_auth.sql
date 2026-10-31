CREATE TABLE "login_attempt" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_attempt_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"phone" text NOT NULL,
	"ip" text,
	"success" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_session" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" text
);
--> statement-breakpoint
ALTER TABLE "staff_session" ADD CONSTRAINT "staff_session_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_attempt_phone_at_idx" ON "login_attempt" USING btree ("phone","at");--> statement-breakpoint
CREATE INDEX "login_attempt_ip_at_idx" ON "login_attempt" USING btree ("ip","at");--> statement-breakpoint
CREATE INDEX "staff_session_staff_idx" ON "staff_session" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "staff_session_expires_idx" ON "staff_session" USING btree ("expires_at");