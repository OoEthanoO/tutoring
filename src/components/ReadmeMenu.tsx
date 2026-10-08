import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Teaching → Readme: the tutor handbook every executive reads before their
 * first class. It replaced the Discord #readme channel in October 2026.
 *
 * Every rule here describes what the site, YanBot or YanLearn Recorder
 * actually does, so change it with them: reminders (reminderSchedule.ts and
 * the class-reminders cron), presence warnings (CLASS_PRESENCE_WARNINGS.md),
 * live channels and breakout rooms (discordLiveChannels.ts, breakoutRooms.ts),
 * Zen mode (ZEN_MODE.md), exercises (CLASS_EXERCISES.md), the Recorder
 * (RECORDER.md), trials (TRIAL_CLASSES.md) and service hours (serviceHours.ts).
 */

const linkStyle = "font-medium underline decoration-[var(--border)] underline-offset-4 hover:decoration-[var(--foreground)]";
const listStyle = "list-disc space-y-2 pl-5";
const stepsStyle = "list-decimal space-y-2 pl-5";
const noteStyle = "text-[var(--muted)]";

type Section = { id: string; title: string; body: ReactNode };
type Part = { id: string; title: string; sections: Section[] };

export const readmeParts: Part[] = [
  {
    id: "basics",
    title: "The basics",
    sections: [
      {
        id: "course-vs-class",
        title: "Course vs class",
        body: <>
          <p>At YanLearn, the words “course” and “class” mean different things. A <strong>class</strong> is one live session you have with your students, usually an hour long. A <strong>course</strong> is the sequence of classes you teach, usually once a week. “Lesson” is sometimes used in place of “class.”</p>
        </>,
      },
      {
        id: "roles",
        title: "Your account and roles",
        body: <ul className={listStyle}>
          <li>Your website role is <strong>Executive</strong>. It gives you the Teaching menu (My courses, Course requests, this Readme) and lets you sign in to YanLearn Recorder.</li>
          <li>Connect your own Discord account from your <strong>Profile Card</strong> (upper right) → <strong>Connect Discord</strong>, then join the server. Use the account you will teach with.</li>
          <li>In Discord you hold the <strong>Pending</strong> role until a course you own or co-teach has been created, then <strong>Executive</strong> instead, never both. Management can grant Executive without a course as an exception.</li>
          <li>Each course you teach gives you its course role and its course channel. YanBot keeps roles, channels and nicknames in step with the website, so do not change them by hand. Your server nickname is always your YanLearn name: change your name on the website, not in Discord.</li>
        </ul>,
      },
      {
        id: "management",
        title: "Who to contact",
        body: <p>“Management” on this page means the <strong>Founder, CEO and COO</strong>. Contact them on Discord for anything this page tells you to report, from a class you cannot teach to a student’s behaviour or a security bug.</p>,
      },
    ],
  },
  {
    id: "getting-a-course",
    title: "Getting a course",
    sections: [
      {
        id: "course-requests",
        title: "Course requests",
        body: <>
          <p>Course requests are how you tell us what and when you want to teach. Open <Link href="/?menu=manage_course_requests" className={linkStyle}>Teaching → Course requests</Link> and press <strong>Submit course request</strong>.</p>
          <ul className={listStyle}>
            <li><strong>Title</strong> and <strong>Description</strong> become the course’s title and description in the catalog. The description supports Markdown.</li>
            <li><strong>Available Timeframes</strong>: every interval you can teach, day by day, for example “9:30am-11am, 3pm-5pm.” The wider they are, the more students can fit the schedule and the more likely the request is approved, so put your full availability.</li>
            <li><strong>Frequency</strong>: how often you want to teach it, such as “Weekly” or “Twice per week.”</li>
            <li><strong>Total Number of Classes</strong>: exactly how many classes the course has. Choose carefully (see <a href="#readme-course-content" className={linkStyle}>Course content</a>): extending a course after submitting the request is very unlikely.</li>
            <li><strong>Proposed Start Date</strong>: the earliest date you are able to start teaching.</li>
            <li><strong>Notes for Founders</strong> (optional): any other concerns or special information about this request.</li>
            <li><strong>Record classes with YanLearn Recorder</strong>: ticked by default. Students are much less inclined to enroll in a course without recordings, because they cannot catch up on a class they miss or review one afterwards. See <a href="#readme-recorder" className={linkStyle}>YanLearn Recorder</a>.</li>
          </ul>
          <p>After you submit, the request shows <strong>In Review</strong> and management is notified. You will hear the result by email and on Discord.</p>
          <ul className={listStyle}>
            <li><strong>Approved</strong>: your course is in the catalog (the <Link href="/?menu=all_courses" className={linkStyle}>Courses</Link> tab) and in <Link href="/?menu=manage_courses" className={linkStyle}>My courses</Link>. Check that its details and class schedule are correct and work for you, and tell management straight away if not.</li>
            <li><strong>Rejected</strong>: the rejection reason explains why. Usually the request is not up to standard, breaks a policy, or has not gathered enough students. You can edit and resubmit it, addressing the reason, or abandon it. After resubmitting, check that the status says <strong>In Review</strong>; <strong>Draft</strong> means it has not been resubmitted.</li>
          </ul>
        </>,
      },
      {
        id: "courses-we-need",
        title: "Courses we need",
        body: <p>Management keeps a running list of courses YanLearn needs but nobody teaches yet. It is shown as <strong>Courses we need</strong> on the Course requests page, and YanBot announces each new addition in the executives channel. If you can teach one, submit a course request for it. A course stays on the list until management removes it.</p>,
      },
      {
        id: "course-content",
        title: "Course content",
        body: <>
          <p>Your courses are meant to be <strong>as comprehensive as possible</strong> unless specified otherwise. A course titled “Grade 8 Math” should cover most of grade 8 math rather than half or parts of it, so request as many classes as that takes. This does not apply to a course titled something like “Introduction to Java”: that implies introductory topics only, and that students should take a higher-level course, perhaps “Continuation of Java,” to go deeper.</p>
          <p>It is <strong>highly preferable</strong> to plan the exact length and content of your course <strong>before</strong> the first class. Extending a course after it starts is messy with parent billing and the promises made to parents, and is very unlikely to happen.</p>
        </>,
      },
    ],
  },
  {
    id: "teaching",
    title: "Teaching a class",
    sections: [
      {
        id: "before-class",
        title: "Before class",
        body: <>
          <ul className={listStyle}>
            <li><strong>Reminders.</strong> YanBot mentions you in the executives channel 24 hours, 1 hour, 15 minutes and 5 minutes before each class, plus 6 hours before if you have a strike. You also get reminder emails 24 hours and 1 hour before, and when your voice channel opens. Your students get emails 24 hours and 1 hour before, and a post in the course channel 1 hour and 5 minutes before.</li>
            <li><strong>Join the class voice channel at least 5 minutes before the start.</strong> It opens for you 15 minutes early so you have time to set up. If you have not joined by 5 minutes before, YanBot mentions you in the executives channel.</li>
            <li>If the course is recorded, have <a href="#readme-recorder" className={linkStyle}>YanLearn Recorder</a> open and signed in by then too.</li>
            <li>If you will not be able to join within 5 minutes of the start time, <strong>contact management immediately</strong>.</li>
            <li>You can choose whatever learning management system you want, but Google Classroom should cover most of your needs. Post its class code in your course channel and pin the message.</li>
          </ul>
        </>,
      },
      {
        id: "absences",
        title: "Absences and class changes",
        body: <>
          <p>If you cannot teach a class because of an emergency or a schedule change, <strong>contact management at least 24 hours before that class starts</strong>. If the change comes up within those 24 hours, <strong>contact management immediately</strong>. Deliberately skipping a class without telling us is not permitted (see <a href="#readme-strikes" className={linkStyle}>Strike system</a>).</p>
          <p>By default, a skipped class is removed and the course is extended by one class. You may ask to move the class to a different time instead, so the course is not extended, but this is not recommended: fewer students may be able to attend the new time.</p>
        </>,
      },
      {
        id: "voice-channels",
        title: "Class voice channels",
        body: <>
          <p>Classes take place in Discord voice channels, which replaced Zoom on June 24, 2026. YanBot creates a voice channel for each class under the <strong>Live</strong> category 15 minutes before it starts. Students cannot see it until 5 minutes before the start, when your enrolled students, and any trial student booked for that class, can join.</p>
          <ul className={listStyle}>
            <li>Attendance is taken automatically when students join. If no student has joined within 5 minutes of the start, YanBot nudges your course role in the course channel.</li>
            <li>The channel is never deleted before the scheduled end. Afterwards it is deleted once nobody has been in it for 5 minutes, or once you have been out of it for 30 minutes, even if students are still chatting.</li>
            <li>If management removes a cancelled class from the schedule, its voice channel and breakout rooms still close automatically after that class’s original end time and the same absence countdown.</li>
          </ul>
        </>,
      },
      {
        id: "during-class",
        title: "During class",
        body: <ul className={listStyle}>
          <li>A microphone is required for teaching. A camera is <strong>not</strong> mandatory.</li>
          <li>Students may speak through their microphones or type in the voice channel’s chat, unless <a href="#readme-zen-mode" className={linkStyle}>Zen mode</a> is on. Student cameras are not mandatory unless there are problems with class participation.</li>
          <li>Profanity is not permitted. If a student uses profanity, report it to management.</li>
          <li><strong>Do not wait for students.</strong> Start teaching as soon as the start time arrives. Often not every student can come, and you could be waiting for no reason.</li>
          <li>Stay in the call until at least the last 5 minutes of the class. If you leave for more than a minute before then, YanBot mentions you in the executives channel. Moving between your class’s breakout rooms counts as being in the class.</li>
        </ul>,
      },
      {
        id: "breakout-rooms",
        title: "Breakout rooms",
        body: <>
          <p>Breakout rooms let you split the class into groups, each in its own voice channel.</p>
          <ol className={stepsStyle}>
            <li>In <Link href="/?menu=my_classes" className={linkStyle}>My classes</Link>, find the class and press <strong>Breakout rooms</strong>. Rooms can be opened once students are let in, 5 minutes before the start.</li>
            <li>Choose how many rooms to open (up to 10 per class). Tick <strong>Split the students into them</strong> to share the students across the rooms, then press <strong>Open</strong>.</li>
            <li>Each room has a <strong>Join in Discord</strong> link. <strong>Split students again</strong> reshuffles them. <strong>Bring everyone back</strong> returns everyone to the class channel and deletes the rooms.</li>
          </ol>
          <p>Rooms have the same access as the class channel, and students can move between them themselves; press <strong>Refresh</strong> to see where everyone is. A student without a linked Discord account cannot be placed in a room. Being in any of the rooms counts as being in the class for attendance, YanBot’s warnings and YanLearn Recorder. The rooms are deleted along with the class channel.</p>
        </>,
      },
      {
        id: "zen-mode",
        title: "Zen mode",
        body: <>
          <p>Zen mode makes a class listen-only for students. Turn it on or off for a course in <Link href="/?menu=my_classes" className={linkStyle}>My classes</Link>, including during a class. It applies to the current class and every remaining class of that course, breakout rooms included, until someone turns it off. Management can change it too.</p>
          <ul className={listStyle}>
            <li>While it is on, students and trial students can listen but cannot speak, stream, use soundboards or type in the voice channel’s chat. They use the course text channel instead, which stays open.</li>
            <li>You, your co-tutors, your approved extra accounts and management can still speak.</li>
            <li>Turning it off gives students their voices back, including removing the server mutes Zen mode applied.</li>
          </ul>
        </>,
      },
      {
        id: "exercises",
        title: "In-class exercises",
        body: <>
          <p>Ask the class timed questions and mark each student’s answer. Exercises live in YanLearn Recorder’s <strong>Class exercises</strong> panel, and work whether or not the course is recorded.</p>
          <ol className={stepsStyle}>
            <li>In YanLearn Recorder, choose <strong>Class exercises</strong> and select the class.</li>
            <li>Type a question, choose a time limit (3 minutes by default) and press <strong>Share question &amp; start timer</strong>.</li>
            <li>With the first question, YanBot posts the class’s exercise link in the course channel, mentioning the course role. <strong>Copy class link</strong> gives you the same link. Students open it, sign in to their enrolled YanLearn account, and see each new question with its countdown.</li>
            <li>Answers appear with each student’s name. Press <strong>Mark correct &amp; send feedback</strong> or <strong>Mark incorrect &amp; send feedback</strong>. A student can revise an incorrect answer while the timer runs.</li>
            <li>The question closes when its timer runs out, when you press <strong>Stop timer &amp; freeze submissions</strong>, or when you share the next question. You can still mark answers and send feedback afterwards.</li>
          </ol>
          <p className={noteStyle}>Students see only their own answers and feedback, never their classmates’. Trial students cannot answer, because exercises need an enrolled YanLearn account. You can practise in the Recorder’s <strong>Try the recorder</strong> mode, which sends nothing to anyone.</p>
        </>,
      },
      {
        id: "recorder",
        title: "YanLearn Recorder",
        body: <>
          <p>Courses with class recordings on are recorded by YanLearn Recorder, a desktop app for Windows and Apple silicon Macs. <strong>If you teach a recorded course, the Recorder must be running for every one of its classes.</strong> A course with recordings off does not need it, apart from <a href="#readme-exercises" className={linkStyle}>in-class exercises</a>. Recording is chosen on the course request, and management can change it later.</p>
          <ul className={listStyle}>
            <li><strong>Install it</strong> from the <Link href="/recorder" className={linkStyle}>YanLearn Recorder download page</Link> and sign in with your YanLearn account. It stays signed in, lives in the menu bar or system tray, and updates itself between classes.</li>
            <li><strong>Have it open at least 5 minutes before the start</strong> and keep it running throughout the class. If it is not open by then, YanBot mentions you in the executives channel. Closing its window only hides it, which is fine. On macOS 13 or earlier, keep the window visible on screen during class: older versions of macOS can pause an app whose window is hidden.</li>
            <li><strong>Recording is automatic.</strong> It starts at the class’s start time while you are in the class voice channel or one of its breakout rooms. Leaving the call pauses it, and rejoining resumes it.</li>
            <li><strong>Choose what to record</strong> under <strong>Devices → What to record</strong>: the whole display, or only the windows you tick. In window mode, only the ticked window you are working in is recorded, captured on its own, so notifications and other windows drawn over it never appear. While you are in any other window, the picture freezes and the audio keeps recording.</li>
            <li><strong>Hotkeys:</strong> <strong>Ctrl+Alt+M</strong> (⌘+Option+M on a Mac) removes your microphone from the recording, not from Discord, until you press it again. <strong>Ctrl+Alt+P</strong> (⌘+Option+P) pauses and resumes recording.</li>
            <li>From 5 minutes before the class until its recording has uploaded, the Recorder cannot be quit. After the class, leave the call; when it asks <strong>Is the class done?</strong>, press <strong>Yes</strong> to upload straight away.</li>
            <li>Enrolled students can watch the recording in <strong>My classes → Class recordings</strong> for 7 days, after which it is deleted.</li>
            <li><strong>Troubleshooting:</strong> Recorder shares recent Activity logs and capture status with the Founder, CEO, COO and their Shadows, so they can investigate without asking you for screenshots. Credentials, local file paths and window titles are removed before sending. Reports expire after 7 days. Practice mode sends no diagnostics.</li>
          </ul>
          <p className={noteStyle}>Try it any time with <strong>Try the recorder</strong>: nothing is saved or uploaded.</p>
        </>,
      },
      {
        id: "trial-students",
        title: "Trial students",
        body: <>
          <p>Management can book a prospective student into one of your classes as a trial student, without a YanLearn account. They can see your course channel and join that class’s voice channel and breakout rooms from 5 minutes before the start until 30 minutes after the end. They get the Student role, never your course role, and they do not count as enrolled or absent students. Welcome them like anyone else.</p>
          <p className={noteStyle}>Exercises and recordings need a YanLearn account and an enrollment, so trial students cannot use them. Never add a student as one of your approved Discord accounts to let them into a class: ask management to book a trial instead.</p>
        </>,
      },
    ],
  },
  {
    id: "after-class",
    title: "After class",
    sections: [
      {
        id: "homework-and-notes",
        title: "Homework and lesson notes",
        body: <>
          <p>We strongly recommend homework and lesson notes for every class. Homework helps students reinforce what they learned, and lesson notes are extremely helpful to students who miss a class but still want to catch up. The notes do not have to be structured or detailed: they can be rough, or simply the document you were working in during the class.</p>
          <p className={noteStyle}>The Tutor Log Form is no longer required. Your community service hours are counted automatically.</p>
        </>,
      },
      {
        id: "service-hours",
        title: "Community service hours",
        body: <ul className={listStyle}>
          <li>You earn hours automatically for every class you teach, once it has started: the class’s length × 1.5, or × 2 for a course at grade 11 or 12. A one-hour class earns 1.5 hours, or 2 at grade 11 or 12.</li>
          <li>Hours count teaching time rather than classes, so a removed class that is made up by extending the course does not cost you hours.</li>
          <li>To claim them, request a withdrawal in <Link href="/?menu=manage_courses" className={linkStyle}>My courses</Link>. Your legal name must be set first. You can have one pending request at a time; management processes it and issues your certificate.</li>
        </ul>,
      },
    ],
  },
  {
    id: "communication",
    title: "Communication",
    sections: [
      {
        id: "student-communication",
        title: "Student communication",
        body: <p>Every course has its own Discord channel, created automatically. Use it to send important notices to your students outside class time, and pin anything they need to keep, such as your Google Classroom code. When your course ends (the last class has finished), YanBot posts the date its channel will be deleted, and deletes it 7 days later.</p>,
      },
      {
        id: "tasks",
        title: "Tasks",
        body: <>
          <p>The <strong>tasks</strong> channel is where management posts things people should complete. Task messages start with one or more mentions:</p>
          <ul className={listStyle}>
            <li>A single person: that person should resolve the task.</li>
            <li>Several people: either all of them should complete it, or at least one of them.</li>
            <li>A role: either everyone with that role should complete it, or at least one person with it.</li>
          </ul>
          <p>Each task message should make clear whether it is a group task or first come, first served. Task messages are deleted once their tasks are complete.</p>
        </>,
      },
      {
        id: "admin-communication",
        title: "Administrative communication",
        body: <>
          <p>Discord is the main communication platform for all YanLearn executives, so you have a duty to be reasonably responsive on it. Check the YanLearn Discord server for important notifications and tasks <strong>daily</strong>, at some point in the day.</p>
          <p>YanBot sends your class reminders and warnings in the executives channel and mentions you, so keep Discord notifications on for it. Only the Founder, CEO and COO can mention @everyone or @here.</p>
        </>,
      },
    ],
  },
  {
    id: "policies",
    title: "Policies",
    sections: [
      {
        id: "strikes",
        title: "Strike system",
        body: <>
          <p>A tutor who fails to notify management of a class absence at least 24 hours before the class, or within a reasonable timeframe, receives a strike. If you have still not joined 5 minutes after a class starts, YanBot warns you in the executives channel that not joining within 10 minutes of the start means a strike. Strikes are decided and recorded by management, never applied automatically.</p>
          <p>The strike system follows a two-strikes rule:</p>
          <ul className={listStyle}>
            <li><strong>First strike:</strong> your student recruitment reputation decreases, because your tendency to skip classes unpredictably is made known to students and their parents. You also get an extra class reminder 6 hours before each class.</li>
            <li><strong>Second strike:</strong> your executive role is removed immediately and indefinitely. Your donation link is invalidated, your courses are cancelled, you may not teach more classes, and you are no longer part of the YanLearn team. You can still claim the volunteering hours you have already earned.</li>
          </ul>
          <p>A first strike decays after 3 months of <strong>continuous good behaviour</strong>, meaning no other strike in that time; another strike resets the timer. A second strike does not decay and cannot be appealed.</p>
          <p className={noteStyle}>The strike system is not there purely to punish tutors. Its purpose is to make sure students receive a quality education and that tutors are responsible for their students, whose families have donated for our courses. Remember that you represent YanLearn as an organization.</p>
        </>,
      },
      {
        id: "feedback",
        title: "Feedback and open source",
        body: <>
          <p>All feedback is welcome. Suggestions about the YanLearn website, the Discord server, YanBot’s notifications, YanLearn Recorder or how we run things are all useful.</p>
          <p>The source code of the YanLearn website, YanBot and YanLearn Recorder is <a href="https://github.com/OoEthanoO/tutoring" target="_blank" rel="noreferrer" className={linkStyle}>open source on GitHub</a>, so you are free to read and modify it. Nonetheless, every form of infrastructure attack, abuse or reverse engineering aimed at YanLearn and its services is strictly prohibited. If you find a security bug, report it to management rather than exploiting it.</p>
        </>,
      },
    ],
  },
];

export default function ReadmeMenu() {
  return (
    <section aria-labelledby="readme-title" className="space-y-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-[var(--foreground)] sm:p-8">
      <header className="max-w-3xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Executive handbook</p>
        <h1 id="readme-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">Readme</h1>
        <p className="text-sm leading-6 text-[var(--muted)]">What YanLearn expects from tutors before, during and after every class, and how the website, Discord and YanLearn Recorder fit together. Read all of it before your first class. This page replaces the #readme channel in Discord and is kept up to date as YanLearn changes, so check here rather than relying on an old screenshot or a rule you remember.</p>
        <div className="flex flex-wrap gap-3 pt-1 text-sm">
          <Link href="/?menu=my_classes" className={linkStyle}>My classes</Link>
          <Link href="/?menu=manage_courses" className={linkStyle}>My courses</Link>
          <Link href="/?menu=manage_course_requests" className={linkStyle}>Course requests</Link>
          <Link href="/recorder" className={linkStyle}>Download YanLearn Recorder</Link>
          <Link href="/?menu=help" className={linkStyle}>Help</Link>
        </div>
      </header>

      <nav aria-label="Readme contents" className="grid gap-5 rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 sm:grid-cols-2 lg:grid-cols-3">
        {readmeParts.map((part) => (
          <div key={part.id} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{part.title}</p>
            <ul className="space-y-1 text-sm">
              {part.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#readme-${section.id}`} className={linkStyle}>{section.title}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {readmeParts.map((part) => (
        <section key={part.id} aria-labelledby={`readme-part-${part.id}`} className="space-y-4">
          <h2 id={`readme-part-${part.id}`} className="text-lg font-semibold">{part.title}</h2>
          {part.sections.map((section) => (
            <article key={section.id} id={`readme-${section.id}`} className="scroll-mt-24 space-y-3 rounded-xl border border-[var(--border)] p-5 text-sm leading-6 sm:p-6">
              <h3 className="text-base font-semibold">{section.title}</h3>
              {section.body}
            </article>
          ))}
        </section>
      ))}
    </section>
  );
}
