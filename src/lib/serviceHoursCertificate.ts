import { promises as fs } from "fs";
import path from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";

// Static organization values re-asserted on every generation. The committed
// template's Address field was accidentally blanked by a Preview.app edit, so
// we never trust the template's current org values.
const ORG = {
  sponsor: "   YanLearn Youth Education",
  address: "   5 Shallot Crt, Richmond Hill, ON L4S 0C1",
  telephone: "   647-962-2195",
  contactName: "   Jing Qu",
  duties: "  Served as a small-group tutor at yanlearn",
};

const GRADE_BOXES = ["Gr9", "Gr10", "Gr11", "Gr12"] as const;

export class CertificateFieldError extends Error {}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// Mirrors the org's manual naming convention, e.g. "Alicia Yu 15.pdf"
// (the number is the withdrawn hours).
export function certificateFileName(legalName: string, hours: number): string {
  const safe = legalName.replace(/[\\/:*?"<>|]/g, "").trim() || "Tutor";
  return `${safe} ${Number(hours)}.pdf`;
}

export async function generateServiceHoursCertificate(input: {
  legalName: string;
  grade: string | null;
  hours: number;
  startDate: string;
  endDate: string;
}): Promise<Uint8Array> {
  const templateBytes = await fs.readFile(
    path.join(process.cwd(), "assets", "service-hours-form-template.pdf")
  );
  const doc = await PDFDocument.load(templateBytes);
  const form = doc.getForm();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);

  const setText = (name: string, value: string) => {
    const field = form.getTextField(name);
    // The template's rewritten fields carry a malformed default appearance
    // ("//Helvetica 11 Tf 0 g"); normalize before pdf-lib regenerates appearances.
    field.acroField.setDefaultAppearance("/Helv 11 Tf 0 g");
    try {
      field.setText(value);
    } catch (error) {
      throw new CertificateFieldError(
        `Value for "${name}" contains characters the form font cannot render.` +
          (error instanceof Error ? ` (${error.message})` : "")
      );
    }
  };

  setText("Name of Student", input.legalName);
  // Spacing mirrors the sample's filled value so the line reads naturally.
  setText(
    "Duties Performed 2",
    `           between   ${formatDate(input.startDate)}     and   ${formatDate(input.endDate)}`
  );
  setText("Number of Hours", ` ${Number(input.hours)} hrs`);

  setText("Organization/Sponsor", ORG.sponsor);
  setText("Address", ORG.address);
  setText("Telephone", ORG.telephone);
  setText("Contact Name", ORG.contactName);
  setText("Duties Performed", ORG.duties);

  // Grade checkboxes: clear all, then check the tutor's grade when parseable.
  // Missing/unparseable grade deliberately does not block generation — the
  // school can tick the box by hand.
  for (const box of GRADE_BOXES) {
    form.getCheckBox(box).uncheck();
  }
  const gradeMatch = String(input.grade ?? "").match(/\b(9|10|11|12)\b/);
  if (gradeMatch) {
    form.getCheckBox(`Gr${gradeMatch[1]}`).check();
  }

  form.updateFieldAppearances(helvetica);
  // Full re-serialization: drops the template's stale incremental revisions so
  // no residual sample values survive in the output.
  return doc.save();
}
