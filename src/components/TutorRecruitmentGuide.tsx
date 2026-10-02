import Link from "next/link";
import type { ReactNode } from "react";

const linkStyle = "font-medium underline decoration-[var(--border)] underline-offset-4 hover:decoration-[var(--foreground)]";
const listStyle = "list-decimal space-y-2 pl-5 text-sm leading-6";

type Step = {
  id: string;
  label: string;
  title: string;
  tutor: ReactNode;
  check: ReactNode;
  note: ReactNode;
};

const steps: Step[] = [
  {
    id: "account", label: "Account", title: "Create an account, then promote them",
    tutor: <ol className={listStyle}>
      <li>Open <Link href="/login" className={linkStyle}>YanLearn → Sign in → Sign up</Link>. If they already have an account, sign in to that account instead.</li>
      <li>Use their own personal email and name. Open the verification email, follow its link, and sign in.</li>
      <li>Tell you the exact email they used so you can find the correct account.</li>
    </ol>,
    check: <p>In <strong>Admin → Manage accounts</strong>, search by their email. Confirm their name and email, check that the account appears with the <strong>Verified</strong> filter, then click <strong>Make executive</strong> and confirm. Check that their website role now says <strong>executive</strong>.</p>,
    note: <p>Ask for a <strong>personal email, not a school email</strong>—for example, Gmail, Outlook, or iCloud. School filters can block verification and notification emails. The tutor should create and control their own account; you do not need their password or verification code.</p>,
  },
  {
    id: "onboarding", label: "Onboarding", title: "Refresh and complete tutor onboarding",
    tutor: <ol className={listStyle}>
      <li>Refresh YanLearn after you promote them. If it still shows their old role, sign out and sign back in to the same account.</li>
      <li>Click <strong>Complete Onboarding</strong> in the onboarding banner. This opens the <strong>YanLearn Executive Tutor Onboarding Form</strong>.</li>
      <li>Complete the required name, contact, grade, and parent contact fields, add relevant subject or teaching experience, read the agreement, and submit their own consent signature.</li>
    </ol>,
    check: <p>Refresh <strong>Manage accounts</strong> and find the same email. Look for <strong>Onboarded &amp; Verified</strong>, not <strong>Pending Onboarding</strong>. This badge confirms the form was saved; it is separate from email verification and course approval.</p>,
    note: <p>The first-login <strong>Add your full name</strong> screen is only a profile update; it does not replace tutor onboarding. Have the tutor fill out and sign the form themselves. Contact details and consent belong in the form, not a public Discord chat.</p>,
  },
  {
    id: "discord", label: "Discord", title: "Connect Discord and confirm Pending",
    tutor: <ol className={listStyle}>
      <li>While signed in to YanLearn, open their <strong>Profile Card</strong> at the upper right and choose <strong>Connect Discord</strong>.</li>
      <li>Check the Discord account shown on the authorization screen before authorizing. It should be the account they will use for teaching.</li>
      <li>Accept the server invite. If they do not reach the server, return to their Profile Card and choose <strong>Join Discord Server</strong>.</li>
    </ol>,
    check: <p>Refresh <strong>Manage accounts</strong>. Confirm the Discord username is theirs and the status says <strong>Connected and joined</strong>. Also find them in the YanLearn Discord server&apos;s member list, open their profile, and check for the <strong>Pending</strong> role. Confirm that they can see the server&apos;s channels.</p>,
    note: <p><strong>Connected</strong> alone does not confirm server membership. A new tutor with no uploaded course normally has <strong>Pending in Discord</strong> while remaining <strong>Executive on the website</strong>. Allow the next Discord sync to update roles, then check again. Do not use an approved extra Discord account as a substitute for connecting their own account.</p>,
  },
  {
    id: "readme", label: "Readme", title: "Have them read the Readme",
    tutor: <ol className={listStyle}>
      <li>On YanLearn, open <Link href="/?menu=readme" className={linkStyle}>Teaching → Readme</Link>.</li>
      <li>Read the whole page and ask you about anything unclear.</li>
      <li>Confirm that they have read it and know where to find it again.</li>
    </ol>,
    check: <p>Ask them to confirm they can open <strong>Teaching → Readme</strong> and have finished reading it. Resolve their questions before calling onboarding complete. Sending a link alone is not a completion check.</p>,
    note: <p>Use the current Readme when explaining expectations; an old screenshot, the old Discord #readme channel, or a remembered rule may be out of date. If they cannot find it, check that their website role is Executive and have them refresh or sign in again.</p>,
  },
  {
    id: "course-request", label: "Course request", title: "Show them how to propose a course",
    tutor: <ol className={listStyle}>
      <li>Open <strong>Teaching → Course requests</strong>. Check <strong>Courses we need</strong>, when shown, for subjects YanLearn is recruiting tutors to teach.</li>
      <li>Click <strong>Submit course request</strong>. Provide a clear title such as “Grade 6 French,” a description of what students will learn, availability, class frequency, total classes, and earliest start date. Include any relevant co-tutor details.</li>
      <li>Review the class recording choice and submit. Check that the request appears as <strong>In Review</strong>, and return to Course requests for its status or feedback.</li>
    </ol>,
    check: <p>Tell them explicitly: <strong>“You can submit a course request any time you are ready.”</strong> Make sure they can find the page. They do not need to submit a course immediately to finish recruitment, and submitting a request does not mean the course is approved or scheduled.</p>,
    note: <p>Class recordings are selected by default. Explain that a recorded course uses YanLearn Recorder; they can choose not to request recordings, and the form explains that choice. A tutor normally moves from Pending to Executive in Discord once a course they own or co-teach has been created. A request by itself does not change that role.</p>,
  },
];

const problems = [
  {
    title: "I cannot find their account in Manage accounts.",
    answer: "Search by the exact sign-up email, not just their name. Clear the role, onboarding, Discord, and course filters, and change the verification filter to All. If the account only appears under Unverified, have them verify their email first. Check for an older account before suggesting another sign-up.",
  },
  {
    title: "The verification email did not arrive, or they used a school email.",
    answer: "Check the email spelling and spam/junk folder, then use Resend verification email on the sign-in page. Use the most recent link. If school email filtering is the problem, ask management to help them move to a personal email while keeping their account, promotion, and Discord connection together. Do not create duplicate accounts as a quick fix.",
  },
  {
    title: "They cannot sign in to an existing account.",
    answer: "Use Forgot password? on the sign-in page and check the inbox for that account. If they cannot access the email address, involve management. Do not ask them to send you their password or reset link.",
  },
  {
    title: "They still see student access or no onboarding banner after promotion.",
    answer: "First confirm their website role is executive on the correct account. Ask them to refresh, then sign out and sign back in if needed. A saved onboarding form also makes the banner disappear, so check Manage accounts for Onboarded & Verified. If it still says Pending Onboarding, collect the error or what they see and ask management to investigate.",
  },
  {
    title: "The onboarding form will not submit, or its fields do not fit their circumstances.",
    answer: "Read the displayed error and check every required field, including parent contact and the consent signature. The current form supports Grades 9–12. If their grade, contact situation, or an agreement term does not fit, ask management before proceeding; do not invent answers or tell them to sign something they do not understand.",
  },
  {
    title: "They say they submitted, but Manage accounts still says Pending Onboarding.",
    answer: "Refresh Manage accounts and confirm both of you are looking at the same email account. Have them check whether the form showed a submission error; closing it or completing only the full-name profile screen does not save tutor onboarding. If a successful submission is still missing, send management the account email and error details privately.",
  },
  {
    title: "Discord says Connected but not joined—or the join button is unavailable.",
    answer: "Connect Discord through the tutor's own Profile Card first, then use Join Discord Server and accept the invite with that same Discord account. Refresh Manage accounts and confirm membership in Discord itself. If they are being asked to enroll in a course to connect, recheck their website executive role and have them sign in again after promotion.",
  },
  {
    title: "They connected the wrong Discord account, or the connection failed.",
    answer: "Compare the username in Manage accounts with the account they actually use in Discord. For a wrong account, have them use Disconnect Discord in their own Profile Card, sign in to the correct Discord account in the browser, and reconnect. For an expired connection attempt, start Connect Discord again from YanLearn. If the account is reserved as a tutor's approved extra account or belongs to another website login, ask management to resolve the ownership first.",
  },
  {
    title: "Their Pending role is missing, or they have both Pending and Executive.",
    answer: "Confirm the website promotion, linked Discord username, and server membership, then wait for the next sync and recheck. A tutor who already owns or co-teaches a course, or has an approved Executive without a course exception, may correctly have Executive instead. A brand-new tutor without either should have Pending, never both. If incorrect roles persist, management can inspect Admin → Manage accounts → Admin Tools → Discord sync status. Avoid manually assigning roles as a fix; the sync manages them.",
  },
  {
    title: "They cannot see the Readme or the expected Discord channels.",
    answer: "The Readme is under Teaching on the website and needs the Executive website role, so confirm the promotion and have them refresh or sign in again. For Discord channels, make sure they opened the YanLearn server with the connected Discord account and check its member profile for Pending. Look through collapsed channel categories as well. If access is still missing after a sync, ask management to check channel access. Do not add them as someone else's approved Discord account to get around the problem.",
  },
  {
    title: "They cannot find Course requests, or think their request already created a course.",
    answer: "Have them refresh YanLearn after promotion and look under Teaching → Course requests. Confirm their website role and onboarding completion if it is missing. In Review means management still needs to review it. If a request is rejected, read its feedback on the same page, update it, and resubmit when ready; do not promise a class date before approval and scheduling.",
  },
];

export default function TutorRecruitmentGuide() {
  return (
    <section aria-labelledby="recruitment-title" className="space-y-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-[var(--foreground)] sm:p-8">
      <header className="max-w-3xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Leadership handbook</p>
        <h1 id="recruitment-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">Tutor recruitment</h1>
        <p className="text-sm leading-6 text-[var(--muted)]">Take an incoming tutor from their first account to being ready to request a course. Work through these five steps with them and verify each checkpoint before moving on.</p>
        <div className="flex flex-wrap gap-3 pt-1 text-sm">
          <Link href="/?menu=founder_tools" className={linkStyle}>Manage accounts</Link>
          <Link href="/?menu=manage_course_requests" className={linkStyle}>Course requests</Link>
          <Link href="/?menu=help" className={linkStyle}>Help</Link>
        </div>
      </header>

      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 text-sm leading-6">
        <h2 className="font-semibold">Before you begin</h2>
        <p>Ask what subjects and grade levels they feel prepared to teach, and what time they can commit. Have them keep YanLearn, their personal email inbox, and Discord available as you walk through setup.</p>
        <p className="text-[var(--muted)]">Recruitment is handled by the <strong className="text-[var(--foreground)]">Founder, CEO, COO, CEO Shadow, or COO Shadow</strong>. The CEO Shadow currently has a particular focus on this work. Use your own leadership account to make the account changes and complete the checks below.</p>
      </div>

      <nav aria-label="Recruitment steps" className="flex flex-wrap gap-2">
        {steps.map((step, i) => <a key={step.id} href={`#recruitment-${step.id}`} className="rounded-full border border-[var(--border)] px-3 py-2 text-xs font-medium transition hover:bg-[var(--border)]">{i + 1}. {step.label}</a>)}
        <a href="#recruitment-problems" className="rounded-full border border-[var(--border)] px-3 py-2 text-xs font-medium transition hover:bg-[var(--border)]">Common problems</a>
        <a href="#recruitment-checklist" className="rounded-full border border-[var(--border)] px-3 py-2 text-xs font-medium transition hover:bg-[var(--border)]">Final checklist</a>
      </nav>

      <ol className="space-y-6">
        {steps.map((step, i) => <li key={step.id} id={`recruitment-${step.id}`} className="scroll-mt-24 rounded-xl border border-[var(--border)] p-5 sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--foreground)] text-sm font-semibold text-[var(--background)]">{i + 1}</span>
            <h2 className="pt-1 text-base font-semibold">{step.title}</h2>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-2"><h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Ask the incoming tutor</h3>{step.tutor}</div>
            <div className="space-y-4">
              <div className="space-y-2 text-sm leading-6"><h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Your checkpoint</h3>{step.check}</div>
              <aside className="space-y-1 rounded-lg bg-[var(--background)] p-4 text-sm leading-6"><h3 className="font-semibold">Side note</h3><div className="text-[var(--muted)]">{step.note}</div></aside>
            </div>
          </div>
        </li>)}
      </ol>

      <section aria-labelledby="recruitment-statuses" className="space-y-3">
        <h2 id="recruitment-statuses" className="text-lg font-semibold">What “ready” looks like</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Website role", "Executive", "They have tutor access on YanLearn."],
            ["Onboarding badge", "Onboarded & Verified", "Their tutor form has been submitted."],
            ["Discord role", "Pending", "They are on the team and have not uploaded a course they teach yet."],
          ].map(([label, value, explanation]) => <div key={label} className="space-y-2 rounded-xl border border-[var(--border)] p-4">
            <p className="text-xs text-[var(--muted)]">{label}</p><p className="font-semibold">{value}</p><p className="text-sm leading-6 text-[var(--muted)]">{explanation}</p>
          </div>)}
        </div>
        <p className="text-sm leading-6 text-[var(--muted)]">Pending in Discord is expected for a new tutor without a course. It is different from <strong>Pending Onboarding</strong>, which means their tutor form is still missing. Do not tick <strong>Executive without a course (skip Pending)</strong> simply to finish recruitment; that setting is for a management-approved exception.</p>
      </section>

      <section id="recruitment-problems" aria-labelledby="recruitment-problems-title" className="scroll-mt-24 space-y-3">
        <h2 id="recruitment-problems-title" className="text-lg font-semibold">Common problems</h2>
        <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] px-4 sm:px-5">
          {problems.map(problem => <details key={problem.title} className="py-4">
            <summary className="cursor-pointer text-sm font-semibold leading-6">{problem.title}</summary>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">{problem.answer}</p>
          </details>)}
        </div>
        <p className="text-sm leading-6 text-[var(--muted)]">Still stuck? Tell management which step failed, the tutor&apos;s account email and Discord username, and the exact error or missing status. Share account details privately and avoid including passwords, verification links, or completed consent forms in screenshots.</p>
      </section>

      <section id="recruitment-checklist" aria-labelledby="recruitment-checklist-title" className="scroll-mt-24 space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 sm:p-6">
        <h2 id="recruitment-checklist-title" className="text-lg font-semibold">Before you finish the handoff</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
          <li>One verified YanLearn account, with a personal email the tutor can access.</li>
          <li>Website role is Executive; tutor onboarding shows Onboarded &amp; Verified.</li>
          <li>Their own Discord account is connected and joined; you have seen their Pending role or confirmed that they have a course or an approved exception.</li>
          <li>They have read the Readme and had a chance to ask questions.</li>
          <li>They know where Course requests is and that they can submit any time they are ready.</li>
        </ul>
        <div className="border-t border-[var(--border)] pt-4">
          <h3 className="mb-2 text-sm font-semibold">Suggested closing message</h3>
          <blockquote className="border-l-2 border-[var(--border)] pl-4 text-sm leading-6 text-[var(--muted)]">You&apos;re set up! Whenever you&apos;re ready to teach, go to Teaching → Course requests on YanLearn and click Submit course request. You can check Courses we need for ideas. Your Discord Pending role is normal until a course you teach is created. Keep Teaching → Readme handy, and reach out if you need help with your first request.</blockquote>
        </div>
      </section>
    </section>
  );
}
