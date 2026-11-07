CREATE TYPE "public"."day_part" AS ENUM('FULL', 'FN', 'AN');--> statement-breakpoint
CREATE TYPE "public"."staff_leave_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."staff_leave_type" AS ENUM('CASUAL', 'MEDICAL', 'EARNED', 'ON_DUTY', 'OTHER');--> statement-breakpoint
ALTER TYPE "public"."role_kind" ADD VALUE 'OFFICE';--> statement-breakpoint
CREATE TABLE "college_update" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "college_update_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"body_en" text NOT NULL,
	"body_kn" text,
	"department_id" integer,
	"class_group_id" integer,
	"send_whatsapp" boolean DEFAULT true NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"published_by" integer NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" integer,
	CONSTRAINT "college_update_single_scope" CHECK ("college_update"."department_id" IS NULL OR "college_update"."class_group_id" IS NULL),
	CONSTRAINT "college_update_text" CHECK (length(trim("college_update"."title")) > 0 AND length(trim("college_update"."body_en")) > 0),
	CONSTRAINT "college_update_withdrawn" CHECK (("college_update"."withdrawn_at" IS NULL) = ("college_update"."withdrawn_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "staff_leave" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_leave_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"staff_id" integer NOT NULL,
	"type" "staff_leave_type" NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"part" "day_part" DEFAULT 'FULL' NOT NULL,
	"reason" text NOT NULL,
	"status" "staff_leave_status" DEFAULT 'PENDING' NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_leave_date_order" CHECK ("staff_leave"."to_date" >= "staff_leave"."from_date"),
	CONSTRAINT "staff_leave_half_day" CHECK ("staff_leave"."part" = 'FULL' OR "staff_leave"."from_date" = "staff_leave"."to_date"),
	CONSTRAINT "staff_leave_reason" CHECK (length(trim("staff_leave"."reason")) > 0),
	CONSTRAINT "staff_leave_decided" CHECK (("staff_leave"."status" <> 'PENDING' OR "staff_leave"."decided_by" IS NULL)
       AND ("staff_leave"."status" NOT IN ('APPROVED', 'REJECTED') OR "staff_leave"."decided_by" IS NOT NULL)
       AND (("staff_leave"."decided_by" IS NULL) = ("staff_leave"."decided_at" IS NULL))),
	CONSTRAINT "staff_leave_not_own" CHECK ("staff_leave"."decided_by" IS NULL OR "staff_leave"."decided_by" <> "staff_leave"."staff_id")
);
--> statement-breakpoint
ALTER TABLE "course" DROP CONSTRAINT "course_code_unique";--> statement-breakpoint
ALTER TABLE "role_grant" DROP CONSTRAINT "role_grant_scope";--> statement-breakpoint
ALTER TABLE "college_settings" ADD COLUMN "demo_data" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "college_update" ADD CONSTRAINT "college_update_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "college_update" ADD CONSTRAINT "college_update_class_group_id_class_group_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "college_update" ADD CONSTRAINT "college_update_published_by_staff_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "college_update" ADD CONSTRAINT "college_update_withdrawn_by_staff_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_decided_by_staff_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "college_update_published_idx" ON "college_update" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "staff_leave_staff_idx" ON "staff_leave" USING btree ("staff_id","from_date");--> statement-breakpoint
CREATE INDEX "staff_leave_status_idx" ON "staff_leave" USING btree ("status","from_date");--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_dept_code" UNIQUE("department_id","code");--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_scope" CHECK (("role_grant"."role"::text IN ('ADMIN','PRINCIPAL','OFFICE') AND "role_grant"."department_id" IS NULL AND "role_grant"."class_group_id" IS NULL)
       OR ("role_grant"."role" = 'HOD' AND "role_grant"."department_id" IS NOT NULL AND "role_grant"."class_group_id" IS NULL)
       OR ("role_grant"."role" = 'CLASS_TEACHER' AND "role_grant"."class_group_id" IS NOT NULL AND "role_grant"."department_id" IS NULL)
       OR ("role_grant"."role" = 'FACULTY' AND "role_grant"."class_group_id" IS NULL));--> statement-breakpoint
-- Hand-written: one person can't have two open leaves that overlap (half days: FN and AN of the same date may both exist).
-- half_days counts half-days from 2000-01-01, so a range compare covers full and half days alike.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "staff_leave" ADD COLUMN "half_days" int4range GENERATED ALWAYS AS (int4range(
  ("from_date" - DATE '2000-01-01') * 2 + CASE WHEN "part" = 'AN' THEN 1 ELSE 0 END,
  ("to_date" - DATE '2000-01-01') * 2 + CASE WHEN "part" = 'FN' THEN 1 ELSE 2 END
)) STORED;--> statement-breakpoint
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_no_overlap" EXCLUDE USING gist ("staff_id" WITH =, "half_days" WITH &&) WHERE ("status" IN ('PENDING', 'APPROVED'));
