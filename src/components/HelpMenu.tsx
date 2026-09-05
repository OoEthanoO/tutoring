"use client";

import { useEffect, useState } from "react";
import { recorderDownloadUrl } from "@/components/RecorderNotice";

export default function HelpMenu() {
    const [contactEmail, setContactEmail] = useState("ethanxucoder@gmail.com");

    useEffect(() => {
        fetch("/api/settings/contact-email")
            .then((res) => res.json())
            .then((data) => {
                if (data.contact_email) setContactEmail(data.contact_email);
            })
            .catch((err) => console.error(err));
    }, []);
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
                            If the course requires a donation, click <span className="font-semibold text-[var(--foreground)]">&quot;Open Donation Link&quot;</span> to make your course donation.
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
                        After submitting, navigate to <span className="font-semibold text-[var(--foreground)]">&quot;My enrollments&quot;</span>. Your registration will show as <span className="font-semibold text-amber-600">&quot;Under Review&quot;</span> while our founder reviews your application. You will receive an email notification upon approval or rejection.
                    </p>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                        Once approved, <span className="font-semibold text-[var(--foreground)]">check your email for instructions on how to attend your classes</span>. You must also <span className="font-semibold text-[var(--foreground)]">connect to Discord</span> to participate — see the instructions below.
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

                {/* Recorder Section (tutors) */}
                <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-5 py-5">
                    <header className="space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                            For tutors
                        </p>
                        <h3 className="text-base font-semibold text-[var(--foreground)]">
                            YanLearn Recorder
                        </h3>
                    </header>
                    <p className="text-sm text-[var(--foreground)] leading-relaxed">
                        Starting <span className="font-semibold">September 9, 2026</span>, every class must be recorded with the
                        YanLearn Recorder desktop app (macOS and Windows). Recordings are uploaded to YanLearn automatically,
                        can only be watched by the students enrolled in that course, cannot be downloaded, and are deleted 7 days
                        after the class.
                    </p>
                    <ol className="list-decimal list-outside text-sm text-[var(--foreground)] space-y-1 pl-5">
                        <li>
                            <a href={recorderDownloadUrl} target="_blank" rel="noreferrer" className="font-semibold underline decoration-2 decoration-[var(--border)] underline-offset-4 hover:decoration-[var(--foreground)]">Download the app</a>{" "}
                            and sign in with your YanLearn account. On macOS, allow <span className="font-semibold">Screen Recording</span> and <span className="font-semibold">Microphone</span> access when asked. You only ever download it once: the app updates itself between classes.
                        </li>
                        <li>If you have more than one display, microphone, or speaker, the app asks you to choose which ones to record before each class.</li>
                        <li>
                            By default the app records your whole display. In <span className="font-semibold">Devices → What to record</span> you can instead pick
                            <span className="font-semibold"> only the windows you tick</span>. Then only the window you are actually working in is recorded, and only if you ticked it — on any other window the picture freezes on the last shared window and a banner tells you so, while your microphone and the class audio keep recording.
                        </li>
                        <li>Have the app open <span className="font-semibold">at least 5 minutes before</span> the class starts. From then until the class is uploaded it cannot be closed.</li>
                        <li>Recording starts by itself at the start time whenever you are in the class voice channel. It pauses when you leave the call and resumes the moment you rejoin.</li>
                        <li>Press <span className="font-semibold">Ctrl+Alt+P</span> (macOS: <span className="font-semibold">⌘+Option+P</span>) to pause. A pause while you are in the call shows a large reminder until you resume; a pause while you are outside the call is a <span className="font-semibold">forced pause</span> and recording will not resume by itself when you rejoin.</li>
                        <li>When the class end time has passed and you leave the call, the app asks whether the class is done. Answer <span className="font-semibold">Yes</span> to upload. If you answer No, the recording is uploaded automatically once the live voice channel is removed.</li>
                    </ol>
                    <p className="text-xs text-[var(--muted)]">
                        The app is designed to be light on your computer: it records the chosen display at 720p and 10 frames per second, and its status overlay is hidden from Discord screen sharing.
                    </p>
                </div>

                <div className="space-y-3 pt-4 border-t border-[var(--border)]">
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                        Still need help?
                    </p>
                    <p className="text-sm text-[var(--foreground)]">
                        Email us at{" "}
                        <a
                            href={`mailto:${contactEmail}`}
                            className="font-semibold text-[var(--foreground)] underline decoration-2 decoration-[var(--border)] underline-offset-4 hover:decoration-[var(--foreground)] transition-all"
                        >
                            {contactEmail}
                        </a>
                    </p>
                </div>
            </div>
        </section>
    );
}
