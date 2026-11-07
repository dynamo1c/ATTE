/**
 * Database schema — single source of truth for every table.
 *
 * Design rules (see docs/PLAN.md §4, §11):
 * - Correctness is enforced by the database: FKs, UNIQUE, CHECK. App code is a second line of defence.
 * - History is never rewritten: timetables are versioned, students/staff are deactivated, not deleted.
 * - Attendance stores what the teacher marked (P/A/L). Leave/OD is overlaid at calculation time,
 *   so a leave notice added later never edits attendance rows.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const termKind = pgEnum("term_kind", ["ODD", "EVEN"]);
export const roleKind = pgEnum("role_kind", ["ADMIN", "PRINCIPAL", "HOD", "FACULTY", "CLASS_TEACHER", "OFFICE"]);
export const studentStatus = pgEnum("student_status", ["ACTIVE", "DETAINED", "DROPPED", "ALUMNI"]);
export const gender = pgEnum("gender", ["MALE", "FEMALE", "OTHER"]);
export const batch = pgEnum("batch", ["B1", "B2"]);
/** Which part of a class a slot/session is for. */
export const batchScope = pgEnum("batch_scope", ["ALL", "B1", "B2"]);
export const relation = pgEnum("relation", ["FATHER", "MOTHER", "GUARDIAN", "OTHER"]);
export const messageLanguage = pgEnum("message_language", ["EN", "KN", "BOTH"]);
export const courseKind = pgEnum("course_kind", ["INTEGRATED", "THEORY_ONLY", "PRACTICAL_ONLY", "SPECIALIZATION"]);
export const component = pgEnum("component", ["THEORY", "PRACTICAL"]);
export const slotKind = pgEnum("slot_kind", ["CLASS", "ACTIVITY"]);
export const dayType = pgEnum("day_type", ["WORKING", "HOLIDAY", "EXAM", "EVENT"]);
export const sessionSource = pgEnum("session_source", ["TIMETABLE", "EXTRA"]);
export const sessionStatus = pgEnum("session_status", ["SCHEDULED", "HELD", "NOT_HELD", "CANCELLED"]);
export const attendanceStatus = pgEnum("attendance_status", ["PRESENT", "ABSENT", "LATE"]);
export const leaveType = pgEnum("leave_type", ["MEDICAL", "ON_DUTY", "PERSONAL", "OTHER"]);
export const leaveStatus = pgEnum("leave_status", ["PENDING", "APPROVED", "REJECTED"]);
export const leaveCountsAs = pgEnum("leave_counts_as", ["PRESENT", "EXCUSED", "ABSENT"]);
export const assessmentStatus = pgEnum("assessment_status", ["DRAFT", "SUBMITTED", "PUBLISHED"]);
export const markFlag = pgEnum("mark_flag", ["AB", "MP"]);
export const staffLeaveType = pgEnum("staff_leave_type", ["CASUAL", "MEDICAL", "EARNED", "ON_DUTY", "OTHER"]);
export const staffLeaveStatus = pgEnum("staff_leave_status", ["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);
/** Whole day, forenoon (morning periods) or afternoon. */
export const dayPart = pgEnum("day_part", ["FULL", "FN", "AN"]);
export const notificationTrigger = pgEnum("notification_trigger", [
  "WEEKLY_SUMMARY",
  "ATTENDANCE_WARNING",
  "ATTENDANCE_SHORTAGE",
  "CONSECUTIVE_ABSENCE",
  "DAY_ABSENCE",
  "MARKS_PUBLISHED",
  "LOW_MARKS",
  "EXAM_SCHEDULE",
  "BROADCAST",
  "LEAVE_RECORDED",
  "ELIGIBILITY_WARNING",
  "LOGIN_OTP",
]);
export const notificationChannel = pgEnum("notification_channel", ["WHATSAPP", "SMS"]);
export const notificationStatus = pgEnum("notification_status", [
  "QUEUED",
  "SENDING",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "SKIPPED",
]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const id = () => integer("id").primaryKey().generatedAlwaysAsIdentity();

// ---------------------------------------------------------------------------
// College configuration
// ---------------------------------------------------------------------------

/** Exactly one row (id = 1). Every tunable rule lives here, not in code. */
export const collegeSettings = pgTable(
  "college_settings",
  {
    id: smallint("id").primaryKey().default(1),
    collegeCode: text("college_code").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    /** Minimum attendance % for exam eligibility. */
    attendanceMinPct: numeric("attendance_min_pct", { precision: 5, scale: 2, mode: "number" }).notNull().default(60),
    /** "At risk" warning band. */
    attendanceWarnPct: numeric("attendance_warn_pct", { precision: 5, scale: 2, mode: "number" }).notNull().default(70),
    /** Days after a session during which the teacher may edit without HOD approval. */
    attendanceLockDays: smallint("attendance_lock_days").notNull().default(3),
    /** Alert when a student is absent this many working days in a row. 0 = off. */
    consecutiveAbsenceDays: smallint("consecutive_absence_days").notNull().default(3),
    /** Low-marks alert below this % of max marks. */
    lowMarksPct: numeric("low_marks_pct", { precision: 5, scale: 2, mode: "number" }).notNull().default(40),
    /** Whether activity periods generate attendance sessions. */
    trackActivityPeriods: boolean("track_activity_periods").notNull().default(false),
    /** Set by the dummy-data seed. Real messages to every parent are refused while it is true. */
    demoData: boolean("demo_data").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("college_settings_singleton", sql`${t.id} = 1`),
    check("college_settings_code_format", sql`${t.collegeCode} ~ '^[0-9]{3}$'`),
    check("college_settings_pct_range", sql`${t.attendanceMinPct} BETWEEN 0 AND 100 AND ${t.attendanceWarnPct} BETWEEN 0 AND 100 AND ${t.lowMarksPct} BETWEEN 0 AND 100`),
    check("college_settings_warn_above_min", sql`${t.attendanceWarnPct} >= ${t.attendanceMinPct}`),
    check("college_settings_lock_days", sql`${t.attendanceLockDays} BETWEEN 0 AND 60`),
  ],
);

/** The daily period grid (9:00–10:00 = period 1, ...). Lunch is simply not a period. */
export const period = pgTable(
  "period",
  {
    ordinal: smallint("ordinal").primaryKey(),
    label: text("label").notNull(),
    startsAt: time("starts_at").notNull(),
    endsAt: time("ends_at").notNull(),
  },
  (t) => [
    check("period_ordinal_positive", sql`${t.ordinal} > 0`),
    check("period_time_order", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/** How each leave type affects attendance %. Editable by admin. */
export const leavePolicy = pgTable("leave_policy", {
  type: leaveType("type").primaryKey(),
  countsAs: leaveCountsAs("counts_as").notNull(),
});

export const academicYear = pgTable(
  "academic_year",
  {
    id: id(),
    label: text("label").notNull().unique(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
  },
  (t) => [
    check("academic_year_label_format", sql`${t.label} ~ '^[0-9]{4}-[0-9]{2}$'`),
    check("academic_year_date_order", sql`${t.endsOn} > ${t.startsOn}`),
  ],
);

export const term = pgTable(
  "term",
  {
    id: id(),
    academicYearId: integer("academic_year_id").notNull().references(() => academicYear.id),
    kind: termKind("kind").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
  },
  (t) => [
    unique("term_year_kind").on(t.academicYearId, t.kind),
    check("term_date_order", sql`${t.endsOn} > ${t.startsOn}`),
  ],
);

export const department = pgTable(
  "department",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [check("department_code_format", sql`${t.code} ~ '^[A-Z]{2}$'`)],
);

/** One class = one department + semester in one term (1 section per dept per year). */
export const classGroup = pgTable(
  "class_group",
  {
    id: id(),
    departmentId: integer("department_id").notNull().references(() => department.id),
    termId: integer("term_id").notNull().references(() => term.id),
    semester: smallint("semester").notNull(),
  },
  (t) => [
    unique("class_group_dept_term_sem").on(t.departmentId, t.termId, t.semester),
    // Target for composite FKs that must agree on the term.
    unique("class_group_id_term").on(t.id, t.termId),
    check("class_group_semester_range", sql`${t.semester} BETWEEN 1 AND 6`),
  ],
);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const staff = pgTable(
  "staff",
  {
    id: id(),
    name: text("name").notNull(),
    /** E.164, +91 followed by 10 digits. Used for login. */
    phone: text("phone").notNull().unique(),
    email: text("email"),
    departmentId: integer("department_id").references(() => department.id),
    designation: text("designation"),
    passwordHash: text("password_hash"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [check("staff_phone_format", sql`${t.phone} ~ '^\\+91[6-9][0-9]{9}$'`)],
);

/**
 * Scoped role grants. One person can hold several (faculty + class teacher + HOD).
 * ADMIN/PRINCIPAL/OFFICE: college-wide. HOD: one department. CLASS_TEACHER: one class.
 * FACULTY: department optional; what they teach comes from teaching_assignment.
 */
export const roleGrant = pgTable(
  "role_grant",
  {
    id: id(),
    staffId: integer("staff_id").notNull().references(() => staff.id),
    role: roleKind("role").notNull(),
    departmentId: integer("department_id").references(() => department.id),
    classGroupId: integer("class_group_id").references(() => classGroup.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("role_grant_unique").on(t.staffId, t.role, t.departmentId, t.classGroupId).nullsNotDistinct(),
    check(
      "role_grant_scope",
      sql`(${t.role}::text IN ('ADMIN','PRINCIPAL','OFFICE') AND ${t.departmentId} IS NULL AND ${t.classGroupId} IS NULL)
       OR (${t.role} = 'HOD' AND ${t.departmentId} IS NOT NULL AND ${t.classGroupId} IS NULL)
       OR (${t.role} = 'CLASS_TEACHER' AND ${t.classGroupId} IS NOT NULL AND ${t.departmentId} IS NULL)
       OR (${t.role} = 'FACULTY' AND ${t.classGroupId} IS NULL)`,
    ),
    index("role_grant_staff_idx").on(t.staffId),
  ],
);

export const student = pgTable(
  "student",
  {
    id: id(),
    /** Permanent ID, e.g. 204CS25012. Never changes, even if detained or lateral entry. */
    regNo: text("reg_no").notNull().unique(),
    name: text("name").notNull(),
    gender: gender("gender"),
    dateOfBirth: date("date_of_birth"),
    /** Home department (from register number at admission). */
    departmentId: integer("department_id").notNull().references(() => department.id),
    admissionYear: smallint("admission_year").notNull(),
    lateralEntry: boolean("lateral_entry").notNull().default(false),
    status: studentStatus("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
  },
  (t) => [
    check("student_reg_no_format", sql`${t.regNo} ~ '^[0-9]{3}[A-Z]{2}[0-9]{5}$'`),
    check("student_admission_year_range", sql`${t.admissionYear} BETWEEN 2000 AND 2100`),
  ],
);

/**
 * Where a student sits in a term. Separate from the register number on purpose:
 * detained and lateral-entry students sit in a class whose year differs from their reg no.
 */
export const classMembership = pgTable(
  "class_membership",
  {
    id: id(),
    studentId: integer("student_id").notNull().references(() => student.id),
    classGroupId: integer("class_group_id").notNull(),
    /** Denormalised so the DB can enforce one class per student per term. */
    termId: integer("term_id").notNull(),
    joinedOn: date("joined_on").notNull(),
    leftOn: date("left_on"),
  },
  (t) => [
    foreignKey({
      name: "class_membership_class_term_fk",
      columns: [t.classGroupId, t.termId],
      foreignColumns: [classGroup.id, classGroup.termId],
    }),
    unique("class_membership_student_term").on(t.studentId, t.termId),
    check("class_membership_date_order", sql`${t.leftOn} IS NULL OR ${t.leftOn} >= ${t.joinedOn}`),
    index("class_membership_class_idx").on(t.classGroupId),
  ],
);

/** Batch history inside a membership. Batch on date D = row with latest effective_from <= D. */
export const batchAssignment = pgTable(
  "batch_assignment",
  {
    id: id(),
    membershipId: integer("membership_id").notNull().references(() => classMembership.id, { onDelete: "cascade" }),
    batch: batch("batch").notNull(),
    effectiveFrom: date("effective_from").notNull(),
  },
  (t) => [unique("batch_assignment_membership_from").on(t.membershipId, t.effectiveFrom)],
);

export const parentContact = pgTable(
  "parent_contact",
  {
    id: id(),
    studentId: integer("student_id").notNull().references(() => student.id),
    name: text("name"),
    relation: relation("relation").notNull(),
    phone: text("phone").notNull(),
    language: messageLanguage("language").notNull().default("BOTH"),
    whatsappOk: boolean("whatsapp_ok").notNull().default(true),
    /** DPDP Act: no messages without recorded consent. */
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentMethod: text("consent_method"),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("parent_contact_student_phone").on(t.studentId, t.phone),
    check("parent_contact_phone_format", sql`${t.phone} ~ '^\\+91[6-9][0-9]{9}$'`),
    check("parent_contact_consent_method", sql`${t.consentAt} IS NULL OR ${t.consentMethod} IS NOT NULL`),
    index("parent_contact_phone_idx").on(t.phone),
  ],
);

// ---------------------------------------------------------------------------
// Curriculum
// ---------------------------------------------------------------------------

/** Marks scheme: list of assessments + formula. Formula is [OPEN] — stored as data so it plugs in later. */
export const assessmentScheme = pgTable("assessment_scheme", {
  id: id(),
  name: text("name").notNull().unique(),
  /** Internal total formula. Null until the college confirms it. */
  formula: jsonb("formula"),
  note: text("note"),
});

export const schemeComponent = pgTable(
  "scheme_component",
  {
    id: id(),
    schemeId: integer("scheme_id").notNull().references(() => assessmentScheme.id),
    /** e.g. CIE_T1, CIE_P2, SEE_T */
    code: text("code").notNull(),
    label: text("label").notNull(),
    component: component("component").notNull(),
    isFinal: boolean("is_final").notNull().default(false),
    maxMarks: numeric("max_marks", { precision: 6, scale: 2, mode: "number" }).notNull(),
    ordinal: smallint("ordinal").notNull(),
  },
  (t) => [
    unique("scheme_component_code").on(t.schemeId, t.code),
    unique("scheme_component_ordinal").on(t.schemeId, t.ordinal),
    check("scheme_component_max_positive", sql`${t.maxMarks} > 0`),
  ],
);

export const course = pgTable(
  "course",
  {
    id: id(),
    departmentId: integer("department_id").notNull().references(() => department.id),
    semester: smallint("semester").notNull(),
    /** Official code, e.g. 25CS31I. Shared subjects (Maths 25SC11I) have the same code in every department. */
    code: text("code").notNull(),
    shortName: text("short_name").notNull(),
    name: text("name").notNull(),
    kind: courseKind("kind").notNull(),
    schemeId: integer("scheme_id").notNull().references(() => assessmentScheme.id),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    unique("course_dept_code").on(t.departmentId, t.code),
    unique("course_dept_sem_short").on(t.departmentId, t.semester, t.shortName),
    check("course_semester_range", sql`${t.semester} BETWEEN 1 AND 6`),
  ],
);

/** A course running for a class in a term. */
export const courseOffering = pgTable(
  "course_offering",
  {
    id: id(),
    courseId: integer("course_id").notNull().references(() => course.id),
    classGroupId: integer("class_group_id").notNull().references(() => classGroup.id),
  },
  (t) => [unique("course_offering_course_class").on(t.courseId, t.classGroupId), index("course_offering_class_idx").on(t.classGroupId)],
);

export const teachingAssignment = pgTable(
  "teaching_assignment",
  {
    id: id(),
    offeringId: integer("offering_id").notNull().references(() => courseOffering.id),
    component: component("component").notNull(),
    batchScope: batchScope("batch_scope").notNull(),
    staffId: integer("staff_id").notNull().references(() => staff.id),
  },
  (t) => [
    unique("teaching_assignment_unique").on(t.offeringId, t.component, t.batchScope, t.staffId),
    index("teaching_assignment_staff_idx").on(t.staffId),
  ],
);

// ---------------------------------------------------------------------------
// Timetable & calendar
// ---------------------------------------------------------------------------

/** Timetables are versioned: a change mid-term adds a version from a date; past sessions stay untouched. */
export const timetableVersion = pgTable(
  "timetable_version",
  {
    id: id(),
    classGroupId: integer("class_group_id").notNull().references(() => classGroup.id),
    effectiveFrom: date("effective_from").notNull(),
    approvedBy: integer("approved_by").references(() => staff.id),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [unique("timetable_version_class_from").on(t.classGroupId, t.effectiveFrom)],
);

export const timetableSlot = pgTable(
  "timetable_slot",
  {
    id: id(),
    versionId: integer("version_id").notNull().references(() => timetableVersion.id, { onDelete: "cascade" }),
    /** ISO weekday: 1 = Monday ... 7 = Sunday. */
    weekday: smallint("weekday").notNull(),
    startPeriod: smallint("start_period").notNull().references(() => period.ordinal),
    endPeriod: smallint("end_period").notNull().references(() => period.ordinal),
    kind: slotKind("kind").notNull().default("CLASS"),
    offeringId: integer("offering_id").references(() => courseOffering.id),
    component: component("component"),
    batchScope: batchScope("batch_scope").notNull().default("ALL"),
    room: text("room"),
  },
  (t) => [
    check("timetable_slot_weekday", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("timetable_slot_period_order", sql`${t.endPeriod} >= ${t.startPeriod}`),
    check(
      "timetable_slot_kind_fields",
      sql`(${t.kind} = 'CLASS' AND ${t.offeringId} IS NOT NULL AND ${t.component} IS NOT NULL)
       OR (${t.kind} = 'ACTIVITY' AND ${t.offeringId} IS NULL AND ${t.component} IS NULL)`,
    ),
    index("timetable_slot_version_idx").on(t.versionId),
  ],
);

/**
 * Calendar overrides. Days without a row use the default: Mon–Sat working, Sunday holiday.
 * Scope: college-wide (both null), one department, or one class. Most specific wins.
 */
export const calendarDay = pgTable(
  "calendar_day",
  {
    id: id(),
    date: date("date").notNull(),
    type: dayType("type").notNull(),
    /** "Saturday follows Monday timetable" → 1. */
    followsWeekday: smallint("follows_weekday"),
    departmentId: integer("department_id").references(() => department.id),
    classGroupId: integer("class_group_id").references(() => classGroup.id),
    note: text("note"),
    createdBy: integer("created_by").references(() => staff.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("calendar_day_scope").on(t.date, t.departmentId, t.classGroupId).nullsNotDistinct(),
    check("calendar_day_follows_range", sql`${t.followsWeekday} IS NULL OR ${t.followsWeekday} BETWEEN 1 AND 6`),
    check("calendar_day_single_scope", sql`${t.departmentId} IS NULL OR ${t.classGroupId} IS NULL`),
    index("calendar_day_date_idx").on(t.date),
  ],
);

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const classSession = pgTable(
  "class_session",
  {
    id: id(),
    offeringId: integer("offering_id").notNull().references(() => courseOffering.id),
    component: component("component").notNull(),
    batchScope: batchScope("batch_scope").notNull(),
    date: date("date").notNull(),
    startPeriod: smallint("start_period").notNull().references(() => period.ordinal),
    endPeriod: smallint("end_period").notNull().references(() => period.ordinal),
    source: sessionSource("source").notNull(),
    /** Set for timetable sessions; makes generation idempotent. */
    slotId: integer("slot_id").references(() => timetableSlot.id),
    status: sessionStatus("status").notNull().default("SCHEDULED"),
    statusReason: text("status_reason"),
    markedBy: integer("marked_by").references(() => staff.id),
    markedAt: timestamp("marked_at", { withTimezone: true }),
    /** Optimistic lock: every save must send the version it read. */
    version: integer("version").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("class_session_slot_date").on(t.slotId, t.date),
    check("class_session_period_order", sql`${t.endPeriod} >= ${t.startPeriod}`),
    check("class_session_source_slot", sql`(${t.source} = 'TIMETABLE') = (${t.slotId} IS NOT NULL)`),
    check("class_session_marked", sql`${t.status} <> 'HELD' OR (${t.markedBy} IS NOT NULL AND ${t.markedAt} IS NOT NULL)`),
    index("class_session_offering_date_idx").on(t.offeringId, t.date),
    index("class_session_date_idx").on(t.date),
  ],
);

/** What the teacher marked. One row per student per session — enforced by the primary key. */
export const attendanceRecord = pgTable(
  "attendance_record",
  {
    sessionId: integer("session_id").notNull().references(() => classSession.id),
    studentId: integer("student_id").notNull().references(() => student.id),
    status: attendanceStatus("status").notNull(),
    markedBy: integer("marked_by").notNull().references(() => staff.id),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "attendance_record_pk", columns: [t.sessionId, t.studentId] }), index("attendance_record_student_idx").on(t.studentId)],
);

/** Idempotency: a client retry with the same op id is a no-op. */
export const attendanceSubmission = pgTable("attendance_submission", {
  clientOpId: uuid("client_op_id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => classSession.id),
  staffId: integer("staff_id").notNull().references(() => staff.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A change to attendance after the edit window closed. The teacher proposes it with a reason;
 * the HOD (or admin) approves, and only then is it applied.
 */
export const attendanceEditRequest = pgTable(
  "attendance_edit_request",
  {
    id: id(),
    sessionId: integer("session_id").notNull().references(() => classSession.id),
    requestedBy: integer("requested_by").notNull().references(() => staff.id),
    reason: text("reason").notNull(),
    /** [{ studentId, from, to }] — only the students whose mark changes. */
    changes: jsonb("changes").notNull(),
    /** Session version when requested; approval fails if attendance changed since. */
    baseVersion: integer("base_version").notNull(),
    status: leaveStatus("status").notNull().default("PENDING"),
    decidedBy: integer("decided_by").references(() => staff.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [
    check("attendance_edit_request_decided", sql`${t.status} = 'PENDING' OR (${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`),
    index("attendance_edit_request_status_idx").on(t.status, t.createdAt),
  ],
);

export const leaveNotice = pgTable(
  "leave_notice",
  {
    id: id(),
    studentId: integer("student_id").notNull().references(() => student.id),
    type: leaveType("type").notNull(),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    reason: text("reason"),
    status: leaveStatus("status").notNull().default("PENDING"),
    createdBy: integer("created_by").notNull().references(() => staff.id),
    approvedBy: integer("approved_by").references(() => staff.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("leave_notice_date_order", sql`${t.toDate} >= ${t.fromDate}`),
    check("leave_notice_approval", sql`${t.status} = 'PENDING' OR (${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL)`),
    index("leave_notice_student_idx").on(t.studentId, t.fromDate),
  ],
);

/**
 * A staff member's own leave. Teachers' leave is decided by their HOD; an HOD's (and anyone without a
 * department) by the principal; the admin can decide any. Nobody decides their own.
 * Overlapping open leave for one person is refused by an exclusion constraint (migration 0008).
 */
export const staffLeave = pgTable(
  "staff_leave",
  {
    id: id(),
    staffId: integer("staff_id").notNull().references(() => staff.id),
    type: staffLeaveType("type").notNull(),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    /** Half days only for a single date. */
    part: dayPart("part").notNull().default("FULL"),
    reason: text("reason").notNull(),
    status: staffLeaveStatus("status").notNull().default("PENDING"),
    decidedBy: integer("decided_by").references(() => staff.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [
    check("staff_leave_date_order", sql`${t.toDate} >= ${t.fromDate}`),
    check("staff_leave_half_day", sql`${t.part} = 'FULL' OR ${t.fromDate} = ${t.toDate}`),
    check("staff_leave_reason", sql`length(trim(${t.reason})) > 0`),
    check(
      "staff_leave_decided",
      sql`(${t.status} <> 'PENDING' OR ${t.decidedBy} IS NULL)
       AND (${t.status} NOT IN ('APPROVED', 'REJECTED') OR ${t.decidedBy} IS NOT NULL)
       AND ((${t.decidedBy} IS NULL) = (${t.decidedAt} IS NULL))`,
    ),
    check("staff_leave_not_own", sql`${t.decidedBy} IS NULL OR ${t.decidedBy} <> ${t.staffId}`),
    index("staff_leave_staff_idx").on(t.staffId, t.fromDate),
    index("staff_leave_status_idx").on(t.status, t.fromDate),
  ],
);

/**
 * College updates (notices) published by the office / principal / admin. Shown on the parent portal's
 * Updates page for the audience, and sent on WhatsApp through the outbox when `sendWhatsApp` is set.
 * Audience: whole college (both null), one department, or one class.
 */
export const collegeUpdate = pgTable(
  "college_update",
  {
    id: id(),
    title: text("title").notNull(),
    bodyEn: text("body_en").notNull(),
    /** Optional; Kannada-only parents get the English text when missing. */
    bodyKn: text("body_kn"),
    departmentId: integer("department_id").references(() => department.id),
    classGroupId: integer("class_group_id").references(() => classGroup.id),
    sendWhatsApp: boolean("send_whatsapp").notNull().default(true),
    /** How many parent messages were queued. */
    messages: integer("messages").notNull().default(0),
    publishedBy: integer("published_by").notNull().references(() => staff.id),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    /** Withdrawn updates disappear from the portal (messages already sent can't be recalled). */
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnBy: integer("withdrawn_by").references(() => staff.id),
  },
  (t) => [
    check("college_update_single_scope", sql`${t.departmentId} IS NULL OR ${t.classGroupId} IS NULL`),
    check("college_update_text", sql`length(trim(${t.title})) > 0 AND length(trim(${t.bodyEn})) > 0`),
    check("college_update_withdrawn", sql`(${t.withdrawnAt} IS NULL) = (${t.withdrawnBy} IS NULL)`),
    index("college_update_published_idx").on(t.publishedAt),
  ],
);

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

export const assessment = pgTable(
  "assessment",
  {
    id: id(),
    offeringId: integer("offering_id").notNull().references(() => courseOffering.id),
    schemeComponentId: integer("scheme_component_id").notNull().references(() => schemeComponent.id),
    maxMarks: numeric("max_marks", { precision: 6, scale: 2, mode: "number" }).notNull(),
    heldOn: date("held_on"),
    status: assessmentStatus("status").notNull().default("DRAFT"),
    publishedBy: integer("published_by").references(() => staff.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Why it was sent back / reopened (shown to the teacher). */
    statusNote: text("status_note"),
    /** Optimistic lock: every save must send the version it read. */
    version: integer("version").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("assessment_offering_component").on(t.offeringId, t.schemeComponentId),
    unique("assessment_id_max").on(t.id, t.maxMarks),
    check("assessment_max_positive", sql`${t.maxMarks} > 0`),
    check("assessment_published", sql`${t.status} <> 'PUBLISHED' OR (${t.publishedBy} IS NOT NULL AND ${t.publishedAt} IS NOT NULL)`),
  ],
);

/** Idempotency for mark saves: a client retry with the same op id is a no-op. */
export const markSubmission = pgTable("mark_submission", {
  clientOpId: uuid("client_op_id").primaryKey(),
  assessmentId: integer("assessment_id").notNull().references(() => assessment.id),
  staffId: integer("staff_id").notNull().references(() => staff.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mark = pgTable(
  "mark",
  {
    assessmentId: integer("assessment_id").notNull(),
    /** Copied from assessment via composite FK so the DB can check value <= max. */
    maxMarks: numeric("max_marks", { precision: 6, scale: 2, mode: "number" }).notNull(),
    studentId: integer("student_id").notNull().references(() => student.id),
    value: numeric("value", { precision: 6, scale: 2, mode: "number" }),
    flag: markFlag("flag"),
    enteredBy: integer("entered_by").notNull().references(() => staff.id),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "mark_pk", columns: [t.assessmentId, t.studentId] }),
    foreignKey({
      name: "mark_assessment_max_fk",
      columns: [t.assessmentId, t.maxMarks],
      foreignColumns: [assessment.id, assessment.maxMarks],
    }).onUpdate("cascade"),
    check("mark_value_xor_flag", sql`(${t.value} IS NULL) <> (${t.flag} IS NULL)`),
    check("mark_value_range", sql`${t.value} IS NULL OR (${t.value} >= 0 AND ${t.value} <= ${t.maxMarks})`),
    index("mark_student_idx").on(t.studentId),
  ],
);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Staff login sessions. The cookie holds a random token; only its SHA-256 hash is stored. */
export const staffSession = pgTable(
  "staff_session",
  {
    tokenHash: text("token_hash").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => staff.id),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => [index("staff_session_staff_idx").on(t.staffId), index("staff_session_expires_idx").on(t.expiresAt)],
);

/** Every login attempt, for rate limiting and the security log. */
export const loginAttempt = pgTable(
  "login_attempt",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    phone: text("phone").notNull(),
    ip: text("ip"),
    success: boolean("success").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempt_phone_at_idx").on(t.phone, t.at), index("login_attempt_ip_at_idx").on(t.ip, t.at)],
);

/**
 * Parent login codes (src/lib/auth/otp.ts). One row per request, matched or not, so the rate limits
 * count everything and a wrong register number looks the same as a right one.
 */
export const parentOtp = pgTable(
  "parent_otp",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    /** sha256 of the random challenge kept in the parent's cookie. */
    challengeHash: text("challenge_hash").notNull().unique(),
    /** sha256(challenge + code); the code itself is never stored. */
    codeHash: text("code_hash").notNull(),
    phone: text("phone").notNull(),
    regNo: text("reg_no").notNull(),
    /** The contact the phone matched; null = no match (every code is wrong). */
    parentContactId: integer("parent_contact_id").references(() => parentContact.id, { onDelete: "set null" }),
    tries: smallint("tries").notNull().default(0),
    ip: text("ip"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    check("parent_otp_phone_format", sql`${t.phone} ~ '^\\+91[6-9][0-9]{9}$'`),
    check("parent_otp_tries_range", sql`${t.tries} BETWEEN 0 AND 20`),
    index("parent_otp_phone_created_idx").on(t.phone, t.createdAt),
    index("parent_otp_ip_created_idx").on(t.ip, t.createdAt),
  ],
);

/** Parent portal sessions: keyed by phone, so siblings come with it and removing a number ends access. */
export const parentSession = pgTable(
  "parent_session",
  {
    tokenHash: text("token_hash").primaryKey(),
    phone: text("phone").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => [index("parent_session_phone_idx").on(t.phone), index("parent_session_expires_idx").on(t.expiresAt)],
);

// ---------------------------------------------------------------------------
// Notifications (outbox) & audit
// ---------------------------------------------------------------------------

/**
 * Outbox: rows are written in the same transaction as the event that causes them.
 * A worker sends them; dedupe_key guarantees the same alert never goes out twice.
 */
export const notification = pgTable(
  "notification",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    trigger: notificationTrigger("trigger").notNull(),
    studentId: integer("student_id").references(() => student.id),
    parentContactId: integer("parent_contact_id").references(() => parentContact.id),
    phone: text("phone").notNull(),
    channel: notificationChannel("channel").notNull(),
    template: text("template").notNull(),
    payload: jsonb("payload").notNull(),
    status: notificationStatus("status").notNull().default("QUEUED"),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    /** Which provider sent it (mock / whatsapp_cloud / sms provider). */
    provider: text("provider"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** SMS fallback rows point at the WhatsApp message they replace. */
    fallbackOf: bigint("fallback_of", { mode: "number" }),
    /** Staff who caused it (broadcast, leave approval); null for automatic alerts. */
    createdBy: integer("created_by").references(() => staff.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("notification_phone_format", sql`${t.phone} ~ '^\\+91[6-9][0-9]{9}$'`),
    check("notification_attempts_range", sql`${t.attempts} BETWEEN 0 AND 20`),
    index("notification_status_scheduled_idx").on(t.status, t.scheduledFor),
    index("notification_student_idx").on(t.studentId),
    index("notification_provider_msg_idx").on(t.providerMessageId),
    index("notification_created_idx").on(t.createdAt),
  ],
);

/** Which automatic parent messages are switched on (docs/PLAN.md §8.1). Missing row = the default in code. */
export const notificationSetting = pgTable("notification_setting", {
  trigger: notificationTrigger("trigger").primaryKey(),
  enabled: boolean("enabled").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Last attendance standing a student's parents were told about, per term. Alerts fire only when the
 * standing gets worse than this; recovering resets it, so a later drop alerts again ("once, on crossing").
 */
export const studentAlertState = pgTable(
  "student_alert_state",
  {
    studentId: integer("student_id").notNull().references(() => student.id),
    termId: integer("term_id").notNull().references(() => term.id),
    standing: text("standing").notNull(),
    changedOn: date("changed_on").notNull(),
  },
  (t) => [
    primaryKey({ name: "student_alert_state_pk", columns: [t.studentId, t.termId] }),
    check("student_alert_state_standing", sql`${t.standing} IN ('OK', 'AT_RISK', 'SHORTAGE')`),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorStaffId: integer("actor_staff_id").references(() => staff.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId), index("audit_log_at_idx").on(t.at), index("audit_log_actor_idx").on(t.actorStaffId, t.id)],
);
