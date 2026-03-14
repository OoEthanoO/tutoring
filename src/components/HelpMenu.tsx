"use client";

export default function HelpMenu() {
    return (
        <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <header className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                    Support
                </p>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                    How to enroll in a course
                </h2>
            </header>

{/* 
            <div className="space-y-3">
                <p className="text-sm font-semibold text-[var(--foreground)]">
                    Video Walkthrough
                </p>
                <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                    <video
                        controls
                        playsInline
                        preload="metadata"
                        style={{ display: "block", width: "100%", height: "auto" }}
                    >
                        <source src="/images/help/enroll-walkthrough.mp4" type="video/mp4" />
                        <source src="/images/help/enroll-walkthrough.mov" type="video/quicktime" />
                        Your browser does not support the video tag.
                    </video>
                </div>
            </div>
            */}

            <div className="space-y-8">
                {/* Step 1 */}
                <div className="space-y-3">
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                        Step 1: Create an Account
                    </p>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                        Click <span className="font-semibold text-[var(--foreground)]">&quot;Sign in&quot;</span> in the upper right corner to register a new account or use an existing one. 
                        <span className="block mt-2 text-xs text-[var(--muted)] italic">
                            Note: If a parent is registering for multiple children, please use separate accounts for each child. Each student must have their own account.
                        </span>
                    </p>
                </div>

                {/* Step 2 */}
                <div className="space-y-3">
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                        Step 2: Choose and Enroll
                    </p>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                        Navigate to <span className="font-semibold text-[var(--foreground)]">&quot;All courses&quot;</span> and click on the course card you are interested in. This will open the course details page where you can review the tutor, schedule, and course details.
                    </p>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                        Inside the course details page, follow these steps:
                    </p>
                    <ul className="list-disc list-outside text-sm text-[var(--foreground)] space-y-2 pl-5">
                        <li>
                            If the course requires a donation, click <span className="font-semibold text-[var(--foreground)]">&quot;Open Donation Link&quot;</span> to make your course donation ($50).
                        </li>
                        <li>
                            Fill out the <span className="font-semibold text-[var(--foreground)]">Student Application Form</span> embedded below.
                        </li>
                        <li>
                            Once all steps are complete, click <span className="font-semibold text-[var(--foreground)]">&quot;Submit Enrollment Request&quot;</span>.
                        </li>
                    </ul>
                </div>

                {/* Step 3 */}
                <div className="space-y-3">
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                        Step 3: Track Status
                    </p>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                        After submitting, navigate to <span className="font-semibold text-[var(--foreground)]">&quot;Enrolled courses&quot;</span>. Your registration will show as <span className="font-semibold text-amber-600">&quot;Under Review&quot;</span> while our founder reviews your application. You will receive an email notification upon approval or rejection.
                    </p>
                </div>

                {/* Troubleshooting Section */}
                <div className="space-y-4 rounded-xl px-5 py-5 border border-red-200/50 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/30">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-600">
                        Troubleshooting
                    </p>

                    <div className="space-y-3">
                        <p className="text-sm text-[var(--foreground)] leading-relaxed">
                            If the <span className="font-semibold">&quot;Submit Enrollment Request&quot;</span> button remains disabled after you have donated:
                        </p>
                        <p className="text-sm text-[var(--foreground)] leading-relaxed">
                            Simply click the <span className="font-semibold">&quot;Open Donation Link&quot;</span> again. You <span className="font-semibold text-red-600">DO NOT</span> need to make a second donation. This will refresh the enrollment status and enable the submit button.
                        </p>
                    </div>
                </div>

                {/* Discord Section */}
                <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-5 py-5">
                    <header className="space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                            Community
                        </p>
                        <h3 className="text-base font-semibold text-[var(--foreground)]">
                            Join our Discord
                        </h3>
                    </header>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                        We use Discord for essential communication between tutors and students. To join:
                    </p>
                    <ol className="list-decimal list-outside text-sm text-[var(--foreground)] space-y-1 pl-5">
                        <li>Click your <span className="font-semibold">Profile Card</span> (upper right).</li>
                        <li>Select <span className="font-semibold">Connect Discord</span>.</li>
                        <li>Follow the prompts to authorize and join.</li>
                    </ol>
                </div>

                <div className="space-y-3 pt-4 border-t border-[var(--border)]">
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                        Still need help?
                    </p>
                    <p className="text-sm text-[var(--foreground)]">
                        Email us at{" "}
                        <a
                            href="mailto:ethans.coding.class@gmail.com"
                            className="font-semibold text-[var(--foreground)] underline decoration-2 decoration-[var(--border)] underline-offset-4 hover:decoration-[var(--foreground)] transition-all"
                        >
                            ethans.coding.class@gmail.com
                        </a>
                    </p>
                </div>
            </div>
        </section>
    );
}
