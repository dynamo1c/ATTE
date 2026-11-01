CREATE TABLE "attendance_edit_request" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "attendance_edit_request_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" integer NOT NULL,
	"requested_by" integer NOT NULL,
	"reason" text NOT NULL,
	"changes" jsonb NOT NULL,
	"base_version" integer NOT NULL,
	"status" "leave_status" DEFAULT 'PENDING' NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_edit_request_decided" CHECK ("attendance_edit_request"."status" = 'PENDING' OR ("attendance_edit_request"."decided_by" IS NOT NULL AND "attendance_edit_request"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "attendance_edit_request" ADD CONSTRAINT "attendance_edit_request_session_id_class_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_edit_request" ADD CONSTRAINT "attendance_edit_request_requested_by_staff_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_edit_request" ADD CONSTRAINT "attendance_edit_request_decided_by_staff_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_edit_request_status_idx" ON "attendance_edit_request" USING btree ("status","created_at");