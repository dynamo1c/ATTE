ALTER TABLE "staff_leave" DROP CONSTRAINT "staff_leave_decided";--> statement-breakpoint
ALTER TABLE "leave_notice" ADD COLUMN "counts_as" "leave_counts_as";--> statement-breakpoint
ALTER TABLE "leave_notice" ADD COLUMN "decision_note" text;--> statement-breakpoint
-- Notices approved before this change keep the effect their type had in the leave policy.
UPDATE "leave_notice" ln SET "counts_as" = COALESCE((SELECT lp."counts_as" FROM "leave_policy" lp WHERE lp."type" = ln."type"), 'ABSENT') WHERE ln."status" = 'APPROVED';--> statement-breakpoint
ALTER TABLE "leave_notice" ADD CONSTRAINT "leave_notice_counts_as" CHECK ("leave_notice"."status" <> 'APPROVED' OR "leave_notice"."counts_as" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_decided" CHECK (("staff_leave"."status" <> 'PENDING' OR "staff_leave"."decided_by" IS NULL)
       AND ("staff_leave"."status" <> 'REJECTED' OR "staff_leave"."decided_by" IS NOT NULL)
       AND (("staff_leave"."decided_by" IS NULL) = ("staff_leave"."decided_at" IS NULL)));