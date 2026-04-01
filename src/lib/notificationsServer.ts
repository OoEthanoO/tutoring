import { founderEmails } from "./roles";

const resendApiKey = process.env.RESEND_API_KEY ?? "";
const resendFrom = process.env.RESEND_FROM ?? "";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Sends an email using the Resend API.
 * This is a server-side only utility.
 */
export const sendEmail = async (to: string, subject: string, html: string) => {
  if (!resendApiKey || !resendFrom || !to) {
    console.warn("Skipping email send: Missing configuration or recipient.", { to, subject });
    return;
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom,
          to,
          subject,
          html,
        }),
      });

      if (response.ok) {
        return;
      }

      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`Failed to send email to ${to} (Attempt ${attempt}):`, errorText);

      if (response.status !== 429 && response.status < 500) {
        // Non-retriable error
        break;
      }
    } catch (error) {
      console.error(`Error sending email to ${to} (Attempt ${attempt}):`, error);
    }

    if (attempt < maxAttempts) {
      await sleep(1000 * Math.pow(2, attempt - 1)); // Exponential backoff
    }
  }
};

/**
 * Notifies all founder emails sequentially with a small delay.
 */
export const notifyFounders = async (subject: string, html: string) => {
  if (!founderEmails || founderEmails.length === 0) {
    return;
  }

  for (const email of founderEmails) {
    await sendEmail(email, subject, html);
    // Sequential delay to ensure delivery and avoid throttling
    await sleep(200);
  }
};
