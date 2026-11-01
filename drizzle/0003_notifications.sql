CREATE TABLE "notification_setting" (
	"trigger" "notification_trigger" PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_alert_state" (
	"student_id" integer NOT NULL,
	"term_id" integer NOT NULL,
	"standing" text NOT NULL,
	"changed_on" date NOT NULL,
	CONSTRAINT "student_alert_state_pk" PRIMARY KEY("student_id","term_id"),
	CONSTRAINT "student_alert_state_standing" CHECK ("student_alert_state"."standing" IN ('OK', 'AT_RISK', 'SHORTAGE'))
);
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "fallback_of" bigint;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "student_alert_state" ADD CONSTRAINT "student_alert_state_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_alert_state" ADD CONSTRAINT "student_alert_state_term_id_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_provider_msg_idx" ON "notification" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "notification_created_idx" ON "notification" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_attempts_range" CHECK ("notification"."attempts" BETWEEN 0 AND 20);