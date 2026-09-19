export const MAX_ENROLLMENT_REJECTION_REASON_LENGTH = 2000;

export const enrollmentBlocksApplication = (status?: string | null) =>
  status === "enrolled" || status === "approved" || status === "pending";

export const parseEnrollmentRejectionReason = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason && reason.length <= MAX_ENROLLMENT_REJECTION_REASON_LENGTH ? reason : null;
};

export const escapeEnrollmentEmailHtml = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const enrollmentRejectionEmail = (courseTitle: string, reason: string) =>
  `<p>Your enrollment request for <strong>${escapeEnrollmentEmailHtml(courseTitle)}</strong> has been rejected.</p>
   <p><strong>Reason:</strong></p>
   <p style="white-space: pre-wrap;">${escapeEnrollmentEmailHtml(reason).replace(/\r?\n/g, "<br>")}</p>
   <p>You can update your application and submit a new enrollment request for this course on
   <a href="https://learn.ethanyanxu.com/?menu=all_courses">YanLearn</a>, while enrollment is open and places are available.</p>`;
