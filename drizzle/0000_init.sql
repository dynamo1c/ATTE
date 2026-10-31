CREATE TYPE "public"."assessment_status" AS ENUM('DRAFT', 'SUBMITTED', 'PUBLISHED');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('PRESENT', 'ABSENT', 'LATE');--> statement-breakpoint
CREATE TYPE "public"."batch" AS ENUM('B1', 'B2');--> statement-breakpoint
CREATE TYPE "public"."batch_scope" AS ENUM('ALL', 'B1', 'B2');--> statement-breakpoint
CREATE TYPE "public"."component" AS ENUM('THEORY', 'PRACTICAL');--> statement-breakpoint
CREATE TYPE "public"."course_kind" AS ENUM('INTEGRATED', 'THEORY_ONLY', 'PRACTICAL_ONLY', 'SPECIALIZATION');--> statement-breakpoint
CREATE TYPE "public"."day_type" AS ENUM('WORKING', 'HOLIDAY', 'EXAM', 'EVENT');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('MALE', 'FEMALE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."leave_counts_as" AS ENUM('PRESENT', 'EXCUSED', 'ABSENT');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('MEDICAL', 'ON_DUTY', 'PERSONAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."mark_flag" AS ENUM('AB', 'MP');--> statement-breakpoint
CREATE TYPE "public"."message_language" AS ENUM('EN', 'KN', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('WHATSAPP', 'SMS');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."notification_trigger" AS ENUM('WEEKLY_SUMMARY', 'ATTENDANCE_WARNING', 'ATTENDANCE_SHORTAGE', 'CONSECUTIVE_ABSENCE', 'DAY_ABSENCE', 'MARKS_PUBLISHED', 'LOW_MARKS', 'EXAM_SCHEDULE', 'BROADCAST', 'LEAVE_RECORDED', 'ELIGIBILITY_WARNING', 'LOGIN_OTP');--> statement-breakpoint
CREATE TYPE "public"."relation" AS ENUM('FATHER', 'MOTHER', 'GUARDIAN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."role_kind" AS ENUM('ADMIN', 'PRINCIPAL', 'HOD', 'FACULTY', 'CLASS_TEACHER');--> statement-breakpoint
CREATE TYPE "public"."session_source" AS ENUM('TIMETABLE', 'EXTRA');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('SCHEDULED', 'HELD', 'NOT_HELD', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."slot_kind" AS ENUM('CLASS', 'ACTIVITY');--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('ACTIVE', 'DETAINED', 'DROPPED', 'ALUMNI');--> statement-breakpoint
CREATE TYPE "public"."term_kind" AS ENUM('ODD', 'EVEN');--> statement-breakpoint
CREATE TABLE "academic_year" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "academic_year_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"label" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	CONSTRAINT "academic_year_label_unique" UNIQUE("label"),
	CONSTRAINT "academic_year_label_format" CHECK ("academic_year"."label" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "academic_year_date_order" CHECK ("academic_year"."ends_on" > "academic_year"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "assessment" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "assessment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"offering_id" integer NOT NULL,
	"scheme_component_id" integer NOT NULL,
	"max_marks" numeric(6, 2) NOT NULL,
	"held_on" date,
	"status" "assessment_status" DEFAULT 'DRAFT' NOT NULL,
	"published_by" integer,
	"published_at" timestamp with time zone,
	CONSTRAINT "assessment_offering_component" UNIQUE("offering_id","scheme_component_id"),
	CONSTRAINT "assessment_id_max" UNIQUE("id","max_marks"),
	CONSTRAINT "assessment_max_positive" CHECK ("assessment"."max_marks" > 0),
	CONSTRAINT "assessment_published" CHECK ("assessment"."status" <> 'PUBLISHED' OR ("assessment"."published_by" IS NOT NULL AND "assessment"."published_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "assessment_scheme" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "assessment_scheme_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"formula" jsonb,
	"note" text,
	CONSTRAINT "assessment_scheme_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "attendance_record" (
	"session_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"status" "attendance_status" NOT NULL,
	"marked_by" integer NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_record_pk" PRIMARY KEY("session_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_submission" (
	"client_op_id" uuid PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_staff_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "batch_assignment" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "batch_assignment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"membership_id" integer NOT NULL,
	"batch" "batch" NOT NULL,
	"effective_from" date NOT NULL,
	CONSTRAINT "batch_assignment_membership_from" UNIQUE("membership_id","effective_from")
);
--> statement-breakpoint
CREATE TABLE "calendar_day" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "calendar_day_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"date" date NOT NULL,
	"type" "day_type" NOT NULL,
	"follows_weekday" smallint,
	"department_id" integer,
	"class_group_id" integer,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_day_scope" UNIQUE NULLS NOT DISTINCT("date","department_id","class_group_id"),
	CONSTRAINT "calendar_day_follows_range" CHECK ("calendar_day"."follows_weekday" IS NULL OR "calendar_day"."follows_weekday" BETWEEN 1 AND 6),
	CONSTRAINT "calendar_day_single_scope" CHECK ("calendar_day"."department_id" IS NULL OR "calendar_day"."class_group_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "class_group" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "class_group_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"department_id" integer NOT NULL,
	"term_id" integer NOT NULL,
	"semester" smallint NOT NULL,
	CONSTRAINT "class_group_dept_term_sem" UNIQUE("department_id","term_id","semester"),
	CONSTRAINT "class_group_id_term" UNIQUE("id","term_id"),
	CONSTRAINT "class_group_semester_range" CHECK ("class_group"."semester" BETWEEN 1 AND 6)
);
--> statement-breakpoint
CREATE TABLE "class_membership" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "class_membership_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"student_id" integer NOT NULL,
	"class_group_id" integer NOT NULL,
	"term_id" integer NOT NULL,
	"joined_on" date NOT NULL,
	"left_on" date,
	CONSTRAINT "class_membership_student_term" UNIQUE("student_id","term_id"),
	CONSTRAINT "class_membership_date_order" CHECK ("class_membership"."left_on" IS NULL OR "class_membership"."left_on" >= "class_membership"."joined_on")
);
--> statement-breakpoint
CREATE TABLE "class_session" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "class_session_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"offering_id" integer NOT NULL,
	"component" "component" NOT NULL,
	"batch_scope" "batch_scope" NOT NULL,
	"date" date NOT NULL,
	"start_period" smallint NOT NULL,
	"end_period" smallint NOT NULL,
	"source" "session_source" NOT NULL,
	"slot_id" integer,
	"status" "session_status" DEFAULT 'SCHEDULED' NOT NULL,
	"status_reason" text,
	"marked_by" integer,
	"marked_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_session_slot_date" UNIQUE("slot_id","date"),
	CONSTRAINT "class_session_period_order" CHECK ("class_session"."end_period" >= "class_session"."start_period"),
	CONSTRAINT "class_session_source_slot" CHECK (("class_session"."source" = 'TIMETABLE') = ("class_session"."slot_id" IS NOT NULL)),
	CONSTRAINT "class_session_marked" CHECK ("class_session"."status" <> 'HELD' OR ("class_session"."marked_by" IS NOT NULL AND "class_session"."marked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "college_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"college_code" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"attendance_min_pct" numeric(5, 2) DEFAULT 60 NOT NULL,
	"attendance_warn_pct" numeric(5, 2) DEFAULT 70 NOT NULL,
	"attendance_lock_days" smallint DEFAULT 3 NOT NULL,
	"consecutive_absence_days" smallint DEFAULT 3 NOT NULL,
	"low_marks_pct" numeric(5, 2) DEFAULT 40 NOT NULL,
	"track_activity_periods" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "college_settings_singleton" CHECK ("college_settings"."id" = 1),
	CONSTRAINT "college_settings_code_format" CHECK ("college_settings"."college_code" ~ '^[0-9]{3}$'),
	CONSTRAINT "college_settings_pct_range" CHECK ("college_settings"."attendance_min_pct" BETWEEN 0 AND 100 AND "college_settings"."attendance_warn_pct" BETWEEN 0 AND 100 AND "college_settings"."low_marks_pct" BETWEEN 0 AND 100),
	CONSTRAINT "college_settings_warn_above_min" CHECK ("college_settings"."attendance_warn_pct" >= "college_settings"."attendance_min_pct"),
	CONSTRAINT "college_settings_lock_days" CHECK ("college_settings"."attendance_lock_days" BETWEEN 0 AND 60)
);
--> statement-breakpoint
CREATE TABLE "course" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "course_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"department_id" integer NOT NULL,
	"semester" smallint NOT NULL,
	"code" text NOT NULL,
	"short_name" text NOT NULL,
	"name" text NOT NULL,
	"kind" "course_kind" NOT NULL,
	"scheme_id" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "course_code_unique" UNIQUE("code"),
	CONSTRAINT "course_dept_sem_short" UNIQUE("department_id","semester","short_name"),
	CONSTRAINT "course_semester_range" CHECK ("course"."semester" BETWEEN 1 AND 6)
);
--> statement-breakpoint
CREATE TABLE "course_offering" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "course_offering_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"course_id" integer NOT NULL,
	"class_group_id" integer NOT NULL,
	CONSTRAINT "course_offering_course_class" UNIQUE("course_id","class_group_id")
);
--> statement-breakpoint
CREATE TABLE "department" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "department_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "department_code_unique" UNIQUE("code"),
	CONSTRAINT "department_code_format" CHECK ("department"."code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "leave_notice" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leave_notice_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"student_id" integer NOT NULL,
	"type" "leave_type" NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text,
	"status" "leave_status" DEFAULT 'PENDING' NOT NULL,
	"created_by" integer NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_notice_date_order" CHECK ("leave_notice"."to_date" >= "leave_notice"."from_date"),
	CONSTRAINT "leave_notice_approval" CHECK ("leave_notice"."status" = 'PENDING' OR ("leave_notice"."approved_by" IS NOT NULL AND "leave_notice"."approved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "leave_policy" (
	"type" "leave_type" PRIMARY KEY NOT NULL,
	"counts_as" "leave_counts_as" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mark" (
	"assessment_id" integer NOT NULL,
	"max_marks" numeric(6, 2) NOT NULL,
	"student_id" integer NOT NULL,
	"value" numeric(6, 2),
	"flag" "mark_flag",
	"entered_by" integer NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mark_pk" PRIMARY KEY("assessment_id","student_id"),
	CONSTRAINT "mark_value_xor_flag" CHECK (("mark"."value" IS NULL) <> ("mark"."flag" IS NULL)),
	CONSTRAINT "mark_value_range" CHECK ("mark"."value" IS NULL OR ("mark"."value" >= 0 AND "mark"."value" <= "mark"."max_marks"))
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dedupe_key" text NOT NULL,
	"trigger" "notification_trigger" NOT NULL,
	"student_id" integer,
	"parent_contact_id" integer,
	"phone" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"template" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "notification_status" DEFAULT 'QUEUED' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "notification_phone_format" CHECK ("notification"."phone" ~ '^\+91[6-9][0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "parent_contact" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "parent_contact_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"student_id" integer NOT NULL,
	"name" text,
	"relation" "relation" NOT NULL,
	"phone" text NOT NULL,
	"language" "message_language" DEFAULT 'BOTH' NOT NULL,
	"whatsapp_ok" boolean DEFAULT true NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_method" text,
	"opted_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_contact_student_phone" UNIQUE("student_id","phone"),
	CONSTRAINT "parent_contact_phone_format" CHECK ("parent_contact"."phone" ~ '^\+91[6-9][0-9]{9}$'),
	CONSTRAINT "parent_contact_consent_method" CHECK ("parent_contact"."consent_at" IS NULL OR "parent_contact"."consent_method" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "period" (
	"ordinal" smallint PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	CONSTRAINT "period_ordinal_positive" CHECK ("period"."ordinal" > 0),
	CONSTRAINT "period_time_order" CHECK ("period"."ends_at" > "period"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "role_grant" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "role_grant_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"staff_id" integer NOT NULL,
	"role" "role_kind" NOT NULL,
	"department_id" integer,
	"class_group_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_grant_unique" UNIQUE NULLS NOT DISTINCT("staff_id","role","department_id","class_group_id"),
	CONSTRAINT "role_grant_scope" CHECK (("role_grant"."role" IN ('ADMIN','PRINCIPAL') AND "role_grant"."department_id" IS NULL AND "role_grant"."class_group_id" IS NULL)
       OR ("role_grant"."role" = 'HOD' AND "role_grant"."department_id" IS NOT NULL AND "role_grant"."class_group_id" IS NULL)
       OR ("role_grant"."role" = 'CLASS_TEACHER' AND "role_grant"."class_group_id" IS NOT NULL AND "role_grant"."department_id" IS NULL)
       OR ("role_grant"."role" = 'FACULTY' AND "role_grant"."class_group_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "scheme_component" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scheme_component_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scheme_id" integer NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"component" "component" NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"max_marks" numeric(6, 2) NOT NULL,
	"ordinal" smallint NOT NULL,
	CONSTRAINT "scheme_component_code" UNIQUE("scheme_id","code"),
	CONSTRAINT "scheme_component_ordinal" UNIQUE("scheme_id","ordinal"),
	CONSTRAINT "scheme_component_max_positive" CHECK ("scheme_component"."max_marks" > 0)
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"department_id" integer,
	"designation" text,
	"password_hash" text,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_phone_unique" UNIQUE("phone"),
	CONSTRAINT "staff_phone_format" CHECK ("staff"."phone" ~ '^\+91[6-9][0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "student" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "student_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reg_no" text NOT NULL,
	"name" text NOT NULL,
	"gender" "gender",
	"date_of_birth" date,
	"department_id" integer NOT NULL,
	"admission_year" smallint NOT NULL,
	"lateral_entry" boolean DEFAULT false NOT NULL,
	"status" "student_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_reg_no_unique" UNIQUE("reg_no"),
	CONSTRAINT "student_reg_no_format" CHECK ("student"."reg_no" ~ '^[0-9]{3}[A-Z]{2}[0-9]{5}$'),
	CONSTRAINT "student_admission_year_range" CHECK ("student"."admission_year" BETWEEN 2000 AND 2100)
);
--> statement-breakpoint
CREATE TABLE "teaching_assignment" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "teaching_assignment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"offering_id" integer NOT NULL,
	"component" "component" NOT NULL,
	"batch_scope" "batch_scope" NOT NULL,
	"staff_id" integer NOT NULL,
	CONSTRAINT "teaching_assignment_unique" UNIQUE("offering_id","component","batch_scope","staff_id")
);
--> statement-breakpoint
CREATE TABLE "term" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "term_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"academic_year_id" integer NOT NULL,
	"kind" "term_kind" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	CONSTRAINT "term_year_kind" UNIQUE("academic_year_id","kind"),
	CONSTRAINT "term_date_order" CHECK ("term"."ends_on" > "term"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "timetable_slot" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "timetable_slot_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"version_id" integer NOT NULL,
	"weekday" smallint NOT NULL,
	"start_period" smallint NOT NULL,
	"end_period" smallint NOT NULL,
	"kind" "slot_kind" DEFAULT 'CLASS' NOT NULL,
	"offering_id" integer,
	"component" "component",
	"batch_scope" "batch_scope" DEFAULT 'ALL' NOT NULL,
	"room" text,
	CONSTRAINT "timetable_slot_weekday" CHECK ("timetable_slot"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "timetable_slot_period_order" CHECK ("timetable_slot"."end_period" >= "timetable_slot"."start_period"),
	CONSTRAINT "timetable_slot_kind_fields" CHECK (("timetable_slot"."kind" = 'CLASS' AND "timetable_slot"."offering_id" IS NOT NULL AND "timetable_slot"."component" IS NOT NULL)
       OR ("timetable_slot"."kind" = 'ACTIVITY' AND "timetable_slot"."offering_id" IS NULL AND "timetable_slot"."component" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "timetable_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "timetable_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"class_group_id" integer NOT NULL,
	"effective_from" date NOT NULL,
	"approved_by" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timetable_version_class_from" UNIQUE("class_group_id","effective_from")
);
--> statement-breakpoint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offering"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_scheme_component_id_scheme_component_id_fk" FOREIGN KEY ("scheme_component_id") REFERENCES "public"."scheme_component"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_published_by_staff_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_session_id_class_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_marked_by_staff_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_submission" ADD CONSTRAINT "attendance_submission_session_id_class_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_submission" ADD CONSTRAINT "attendance_submission_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_staff_id_staff_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_assignment" ADD CONSTRAINT "batch_assignment_membership_id_class_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."class_membership"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_day" ADD CONSTRAINT "calendar_day_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_day" ADD CONSTRAINT "calendar_day_class_group_id_class_group_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_day" ADD CONSTRAINT "calendar_day_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_term_id_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_membership" ADD CONSTRAINT "class_membership_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_membership" ADD CONSTRAINT "class_membership_class_term_fk" FOREIGN KEY ("class_group_id","term_id") REFERENCES "public"."class_group"("id","term_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offering"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_start_period_period_ordinal_fk" FOREIGN KEY ("start_period") REFERENCES "public"."period"("ordinal") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_end_period_period_ordinal_fk" FOREIGN KEY ("end_period") REFERENCES "public"."period"("ordinal") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_slot_id_timetable_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."timetable_slot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_marked_by_staff_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_scheme_id_assessment_scheme_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."assessment_scheme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offering" ADD CONSTRAINT "course_offering_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offering" ADD CONSTRAINT "course_offering_class_group_id_class_group_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_notice" ADD CONSTRAINT "leave_notice_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_notice" ADD CONSTRAINT "leave_notice_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_notice" ADD CONSTRAINT "leave_notice_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark" ADD CONSTRAINT "mark_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark" ADD CONSTRAINT "mark_entered_by_staff_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark" ADD CONSTRAINT "mark_assessment_max_fk" FOREIGN KEY ("assessment_id","max_marks") REFERENCES "public"."assessment"("id","max_marks") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_parent_contact_id_parent_contact_id_fk" FOREIGN KEY ("parent_contact_id") REFERENCES "public"."parent_contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_contact" ADD CONSTRAINT "parent_contact_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_class_group_id_class_group_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_component" ADD CONSTRAINT "scheme_component_scheme_id_assessment_scheme_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."assessment_scheme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offering"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignment" ADD CONSTRAINT "teaching_assignment_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term" ADD CONSTRAINT "term_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slot" ADD CONSTRAINT "timetable_slot_version_id_timetable_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."timetable_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slot" ADD CONSTRAINT "timetable_slot_start_period_period_ordinal_fk" FOREIGN KEY ("start_period") REFERENCES "public"."period"("ordinal") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slot" ADD CONSTRAINT "timetable_slot_end_period_period_ordinal_fk" FOREIGN KEY ("end_period") REFERENCES "public"."period"("ordinal") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slot" ADD CONSTRAINT "timetable_slot_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offering"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_version" ADD CONSTRAINT "timetable_version_class_group_id_class_group_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_version" ADD CONSTRAINT "timetable_version_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_record_student_idx" ON "attendance_record" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "calendar_day_date_idx" ON "calendar_day" USING btree ("date");--> statement-breakpoint
CREATE INDEX "class_membership_class_idx" ON "class_membership" USING btree ("class_group_id");--> statement-breakpoint
CREATE INDEX "class_session_offering_date_idx" ON "class_session" USING btree ("offering_id","date");--> statement-breakpoint
CREATE INDEX "class_session_date_idx" ON "class_session" USING btree ("date");--> statement-breakpoint
CREATE INDEX "course_offering_class_idx" ON "course_offering" USING btree ("class_group_id");--> statement-breakpoint
CREATE INDEX "leave_notice_student_idx" ON "leave_notice" USING btree ("student_id","from_date");--> statement-breakpoint
CREATE INDEX "mark_student_idx" ON "mark" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "notification_status_scheduled_idx" ON "notification" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "notification_student_idx" ON "notification" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "parent_contact_phone_idx" ON "parent_contact" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "role_grant_staff_idx" ON "role_grant" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "teaching_assignment_staff_idx" ON "teaching_assignment" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "timetable_slot_version_idx" ON "timetable_slot" USING btree ("version_id");