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

            <div className="space-y-8">
                {/* Step 1 */}
                <div className="space-y-3">
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                        Step 1
                    </p>
                    <p className="text-sm text-[var(--foreground)]">
                        Click <span className="font-semibold">&quot;Sign in&quot;</span> in the upper right corner to register a new account or use an existing one.
                        Please note that if a parent is registering for two children, please register using two separate accounts for each child. One account per student.
                    </p>
                </div>

                {/* Step 2 */}
                <div className="space-y-3">
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                        Step 2
                    </p>
                    <p className="text-sm text-[var(--foreground)]">
                        After entering the website, click <span className="font-semibold">&quot;All courses,&quot;</span> find the course you wish to enroll in, check the instructor and class time, and then click <span className="font-semibold">&quot;Enroll.&quot;</span> You will see two red links: one for the donation and the other for registration form. Please make a donation of $50 and fill out the registration form. After completing this, return to the enroll page. The two red links will have turned green, and "Confirm enrollment (locked)" will have changed to "Confirm enrollment." Please click it.
                    </p>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                            <img
                                src="/images/help/enroll-step-2.jpg"
                                alt="Enrollment modal showing two red links"
                                style={{ display: "block", width: "100%", height: "auto" }}
                            />
                        </div>
                        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                            <img
                                src="/images/help/enroll-step-3.jpg"
                                alt="Enrollment modal showing two green links and unlocked confirm button"
                                style={{ display: "block", width: "100%", height: "auto" }}
                            />
                        </div>
                    </div>
                </div>

                {/* Step 3 */}
                <div className="space-y-3">
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                        Step 3
                    </p>
                    <p className="text-sm text-[var(--foreground)]">
                        After completing course registration, click <span className="font-semibold">&quot;Enrolled courses&quot;</span> in the main menu. You should then see the courses you just registered for. The status is <span className="font-semibold">&quot;Under Review&quot;</span>. If you don&apos;t see the &quot;Under Review&quot; status, the registration is incomplete.
                    </p>
                </div>

                {/* Important notices */}
                <div className="space-y-4 rounded-xl px-4 py-4" style={{ border: "1px solid rgba(239,68,68,0.35)", backgroundColor: "rgba(239,68,68,0.08)" }}>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600">
                        Important
                    </p>

                    <div className="space-y-3">
                        <p className="text-sm text-[var(--foreground)]">
                            If you made a donation and filled out the registration form, but forgot to click the <span className="font-semibold">&quot;Confirm enrollment&quot;</span> button, you need to register again. When you return to register, both links will still be red. Please click both links again. <span className="font-semibold text-red-600">DO NOT</span> make another donation or fill out the registration form again, just click both links. Then, return to the registration page, where the two links will turn green. Click <span className="font-semibold">&quot;Confirm enrollment&quot;</span> at the bottom.
                        </p>
                    </div>
                </div>

                <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                        Important
                    </p>

                    <div className="space-y-3">
                        <p className="text-sm text-[var(--foreground)]">
                            To facilitate communication between instructors and students, we have set up a dedicated Discord server for YanLearn. Students should log in to the YanLearn website, click your profile card on the upper right corner, select <span className="font-semibold">Connect Discord</span>, then follow through with the instructions to join the Discord server.
                        </p>
                    </div>
                </div>

                <div className="space-y-3">
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                        Contact us
                    </p>
                    <p className="text-sm text-[var(--foreground)]">
                        If you have any questions or need further assistance, please email us at{" "}
                        <a
                            href="mailto:ethans.coding.class@gmail.com"
                            className="font-semibold underline"
                        >
                            ethans.coding.class@gmail.com
                        </a>.
                    </p>
                </div>
            </div>
        </section>
    );
}
