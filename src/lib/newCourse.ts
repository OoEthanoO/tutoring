import { normalizeGradeLevel } from "@/lib/serviceHours";
import { MAX_PAID_FEE, MIN_PAID_FEE, normalizePaidFee } from "@/lib/paidCourses";

/**
 * Management creating a course directly, without a course request
 * (Teaching → Course requests → Create course). Pure checks of what the form
 * sends; the route adds the database checks (the tutors exist and are
 * executives, and the paid-course rules in PAID_COURSES.md).
 */

export const MAX_COURSE_TITLE_LENGTH = 120;
export const MAX_COURSE_DESCRIPTION_LENGTH = 10000;
export const MAX_NEW_COURSE_CLASSES = 60;
export const MAX_COURSE_STUDENTS = 100;
export const MAX_DONATION_FEE = 10000;
export const MIN_CLASS_MINUTES = 15;
export const MAX_CLASS_MINUTES = 6 * 60;

export type NewCourseClass = { startsAt: string; durationHours: number; tutorId: string };

export type NewCourse = {
  title: string;
  description: string | null;
  ownerId: string;
  coTutorId: string | null;
  isPaid: boolean;
  paidFee: number | null;
  donationFee: number | null;
  maxStudents: number | null;
  gradeLevel: number | null;
  recordingsEnabled: boolean;
  /** In time order; the route titles them Class 1, Class 2… */
  classes: NewCourseClass[];
};

export type ParsedNewCourse = { ok: true; course: NewCourse } | { ok: false; error: string };

const text = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "");
const id = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const optionalWhole = (value: unknown, min: number, max: number): number | null | "invalid" => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : "invalid";
};

export const parseNewCourse = (body: unknown): ParsedNewCourse => {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const title = text(input.title);
  if (!title) return { ok: false, error: "Give the course a title." };
  if (title.length > MAX_COURSE_TITLE_LENGTH) {
    return { ok: false, error: `Keep the title to ${MAX_COURSE_TITLE_LENGTH} characters.` };
  }
  const description = text(input.description);
  if (description.length > MAX_COURSE_DESCRIPTION_LENGTH) {
    return { ok: false, error: `Keep the description to ${MAX_COURSE_DESCRIPTION_LENGTH} characters.` };
  }

  const ownerId = id(input.ownerId);
  if (!ownerId) return { ok: false, error: "Choose the tutor who teaches the course." };
  const coTutorId = id(input.coTutorId) || null;
  if (coTutorId === ownerId) return { ok: false, error: "The co-tutor must be a different tutor." };

  const isPaid = input.isPaid === true;
  let paidFee: number | null = null;
  let donationFee: number | null = null;
  if (isPaid) {
    paidFee = normalizePaidFee(input.paidFee);
    if (paidFee === null) {
      return { ok: false, error: `Enter the course fee: a dollar amount from $${MIN_PAID_FEE} to $${MAX_PAID_FEE}.` };
    }
  } else {
    const donation = optionalWhole(input.donationFee, 0, MAX_DONATION_FEE);
    if (donation === "invalid") {
      return { ok: false, error: `The donation is a whole number of dollars from 0 to ${MAX_DONATION_FEE}.` };
    }
    donationFee = donation;
  }

  const maxStudents = optionalWhole(input.maxStudents, 1, MAX_COURSE_STUDENTS);
  if (maxStudents === "invalid") {
    return { ok: false, error: `Max students is a whole number from 1 to ${MAX_COURSE_STUDENTS}, or blank for no limit.` };
  }

  const rawGrade = input.gradeLevel;
  const gradeLevel = rawGrade === null || rawGrade === undefined || rawGrade === "" ? null : normalizeGradeLevel(rawGrade);
  if (rawGrade !== null && rawGrade !== undefined && rawGrade !== "" && gradeLevel === null) {
    return { ok: false, error: "Choose a grade level from the list." };
  }

  const rawClasses = Array.isArray(input.classes) ? input.classes : [];
  if (rawClasses.length > MAX_NEW_COURSE_CLASSES) {
    return { ok: false, error: `A course can start with at most ${MAX_NEW_COURSE_CLASSES} classes.` };
  }
  const classes: NewCourseClass[] = [];
  for (const raw of rawClasses) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const startsMs = typeof item.startsAt === "string" ? Date.parse(item.startsAt) : Number.NaN;
    if (!Number.isFinite(startsMs)) return { ok: false, error: "Every class needs a date and time." };
    const minutes = Math.round((typeof item.durationHours === "number" ? item.durationHours : Number.NaN) * 60);
    if (!Number.isFinite(minutes) || minutes < MIN_CLASS_MINUTES || minutes > MAX_CLASS_MINUTES) {
      return { ok: false, error: `Each class lasts from ${MIN_CLASS_MINUTES} minutes to ${MAX_CLASS_MINUTES / 60} hours.` };
    }
    const tutorId = id(item.tutorId) || ownerId;
    if (tutorId !== ownerId && tutorId !== coTutorId) {
      return { ok: false, error: "Each class is taught by the course's tutor or its co-tutor." };
    }
    classes.push({ startsAt: new Date(startsMs).toISOString(), durationHours: minutes / 60, tutorId });
  }
  classes.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const starts = new Set(classes.map((item) => item.startsAt));
  if (starts.size !== classes.length) return { ok: false, error: "Two classes start at the same time." };

  return {
    ok: true,
    course: {
      title,
      description: description || null,
      ownerId,
      coTutorId,
      isPaid,
      paidFee,
      donationFee,
      maxStudents,
      gradeLevel,
      recordingsEnabled: input.recordingsEnabled !== false,
      classes,
    },
  };
};
