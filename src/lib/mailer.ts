import nodemailer, { type Transporter } from "nodemailer";
import { getAdminClient } from "@/lib/authServer";

/**
 * Every email YanLearn sends goes through deliverEmail: SMTP, by default
 * Gmail's (smtp.gmail.com, port 587 with STARTTLS) signed in as the
 * organization's account with a Google app password. It replaced the Resend
 * API in November 2026 (see EMAIL.md). Server-side only.
 *
 * Settings (secrets/production.json on the server, .env.local locally):
 *   SMTP_USER      the account that sends, e.g. the organization's Gmail address
 *   SMTP_PASSWORD  its app password (Google shows it in groups of four; spaces are ignored)
 *   EMAIL_FROM     optional, defaults to "YanLearn <SMTP_USER>"; Gmail only keeps
 *                  another address here if it is a verified "Send mail as" alias
 *   SMTP_HOST, SMTP_PORT  optional, default smtp.gmail.com and 587
 *
 * Each send is recorded in public.email_log, which Admin -> Emails reads.
 */

/** Content is base64, as the callers already build it. */
export type EmailAttachment = { filename: string; content: string };

export type OutgoingEmail = {
  to: string | string[];
  bcc?: string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
};

export type SendOutcome = { ok: boolean; error: string; messageId: string | null };

/**
 * Recipients (To + Bcc) per message. Gmail refuses more than 100 per message
 * sent over SMTP; staying at 50 keeps each group email well inside that.
 */
export const MAX_RECIPIENTS_PER_EMAIL = 50;

export const MISSING_EMAIL_CONFIG = "Missing SMTP_USER or SMTP_PASSWORD.";

const MAX_ATTEMPTS = 3;

type SmtpConfig = { host: string; port: number; user: string; password: string; from: string };

export const smtpConfig = (): SmtpConfig | null => {
  const user = (process.env.SMTP_USER ?? "").trim();
  const host = (process.env.SMTP_HOST ?? "").trim() || "smtp.gmail.com";
  const rawPassword = process.env.SMTP_PASSWORD ?? "";
  // Google app passwords have no spaces; Google only displays them in groups.
  const password = host === "smtp.gmail.com" ? rawPassword.replace(/\s+/g, "") : rawPassword;
  if (!user || !password) {
    return null;
  }
  const port = Number.parseInt(process.env.SMTP_PORT ?? "", 10) || 587;
  const from = (process.env.EMAIL_FROM ?? "").trim() || `YanLearn <${user}>`;
  return { host, port, user, password, from };
};

export const isEmailConfigured = () => smtpConfig() !== null;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

let cachedTransport: { config: SmtpConfig; transporter: Transporter } | null = null;

const transporterFor = (config: SmtpConfig) => {
  const current = cachedTransport?.config;
  if (
    cachedTransport &&
    current?.host === config.host &&
    current.port === config.port &&
    current.user === config.user &&
    current.password === config.password
  ) {
    return cachedTransport.transporter;
  }
  cachedTransport?.transporter.close();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.password },
    // One reused connection: Gmail limits how often an account may sign in.
    pool: true,
    maxConnections: 1,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  cachedTransport = { config, transporter };
  return transporter;
};

const toList = (value: string | string[] | undefined) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [value ?? ""])
        .map((address) => address.trim())
        .filter(Boolean)
    )
  );

const describeError = (error: unknown) => {
  if (error && typeof error === "object") {
    const { response, message } = error as { response?: unknown; message?: unknown };
    if (typeof response === "string" && response.trim()) {
      return response.trim();
    }
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return "Unknown email failure.";
};

/**
 * Worth another try: a 4xx SMTP reply (temporary) or a dropped connection.
 * A 5xx reply (bad credentials, the daily sending limit, a refused address)
 * fails at once.
 */
export const isRetriableEmailError = (error: unknown) => {
  const { responseCode, code } = (error ?? {}) as { responseCode?: unknown; code?: unknown };
  if (typeof responseCode === "number") {
    return responseCode >= 400 && responseCode < 500;
  }
  return ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET"].includes(String(code ?? ""));
};

type EmailLogRow = {
  from_address: string;
  to_addresses: string[];
  bcc_addresses: string[];
  subject: string;
  html: string;
  attachment_names: string[];
  status: "sent" | "failed";
  error: string | null;
  message_id: string | null;
};

/** A failed log write never fails the send. */
const recordEmail = async (row: EmailLogRow) => {
  try {
    const { error } = await getAdminClient().from("email_log").insert(row);
    if (error) {
      console.error("Failed to record email in email_log:", error.message);
    }
  } catch (error) {
    console.error("Failed to record email in email_log:", error);
  }
};

export const deliverEmail = async (email: OutgoingEmail): Promise<SendOutcome> => {
  const config = smtpConfig();
  if (!config) {
    console.warn("Skipping email send: Missing configuration.", { subject: email.subject });
    return { ok: false, error: MISSING_EMAIL_CONFIG, messageId: null };
  }

  const to = toList(email.to);
  const bcc = toList(email.bcc).filter((address) => !to.includes(address));
  if (to.length === 0 && bcc.length === 0) {
    console.warn("Skipping email send: Missing recipient.", { subject: email.subject });
    return { ok: false, error: "Missing recipient.", messageId: null };
  }

  const attachments = email.attachments ?? [];
  const logBase = {
    from_address: config.from,
    to_addresses: to,
    bcc_addresses: bcc,
    subject: email.subject,
    html: email.html,
    attachment_names: attachments.map((attachment) => attachment.filename),
  };

  let lastError = "Unknown email failure.";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const info = await transporterFor(config).sendMail({
        from: config.from,
        to,
        ...(bcc.length > 0 ? { bcc } : {}),
        subject: email.subject,
        html: email.html,
        ...(attachments.length > 0
          ? {
              attachments: attachments.map((attachment) => ({
                filename: attachment.filename,
                content: attachment.content,
                encoding: "base64",
              })),
            }
          : {}),
      });
      // Plain strings from SMTP; an { address } object from some other transports.
      const rejected = ((info.rejected ?? []) as unknown[]).map((entry) =>
        typeof entry === "string" ? entry : String((entry as { address?: unknown })?.address ?? "")
      );
      const messageId = info.messageId ?? null;
      await recordEmail({
        ...logBase,
        status: "sent",
        error: rejected.length > 0 ? `Refused by the mail server: ${rejected.join(", ")}` : null,
        message_id: messageId,
      });
      return { ok: true, error: "", messageId };
    } catch (error) {
      lastError = describeError(error);
      console.error(`Failed to send email (attempt ${attempt}):`, lastError);
      if (!isRetriableEmailError(error) || attempt === MAX_ATTEMPTS) {
        break;
      }
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }

  await recordEmail({ ...logBase, status: "failed", error: lastError, message_id: null });
  return { ok: false, error: lastError, messageId: null };
};
