CREATE TABLE "mark_submission" (
	"client_op_id" uuid PRIMARY KEY NOT NULL,
	"assessment_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "status_note" text;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "mark_submission" ADD CONSTRAINT "mark_submission_assessment_id_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark_submission" ADD CONSTRAINT "mark_submission_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;