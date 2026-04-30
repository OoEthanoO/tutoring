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
export const sendEmail = async (to: string, subject: string, html: string): Promise<boolean> => {
  if (!resendApiKey || !resendFrom || !to) {
    console.warn("Skipping email send: Missing configuration or recipient.", { to, subject });
    return false;
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
        return true;
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
  
  return false;
};

/**
 * Notifies all founder emails sequentially.
 * Waits for each email to succeed before moving to the next.
 */
export const notifyFounders = async (subject: string, html: string) => {
  if (!founderEmails || founderEmails.length === 0) {
    return;
  }

  for (const email of founderEmails) {
    let success = false;
    let notifyAttempts = 0;
    
    // Keep retrying until success to guarantee sequential delivery
    // after each subsequent email requests have been made successfully
    while (!success && notifyAttempts < 5) {
      notifyAttempts++;
      success = await sendEmail(email, subject, html);
      
      if (!success) {
        // Wait longer on failure before retrying to prevent rate limiting
        await sleep(2000); 
      }
    }
    
    if (!success) {
      console.error(`Failed to notify founder ${email} after all retries.`);
    }

    // Sequential delay to ensure delivery and avoid throttling (2 req/sec rate limit)
    await sleep(1000);
  }
};
