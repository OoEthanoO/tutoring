// Reminder scheduling for the class-reminders cron. Pure date math lives here
// (rather than the route file) so it can be unit-tested — the cron queries
// classes whose start time falls inside each target's window.

export type ReminderType =
  | "twenty_four_hours"
  | "six_hours"
  | "one_hour"
  | "fifteen_minutes"
  | "ten_minutes"
  | "five_minutes";

export type ReminderTarget = {
  type: ReminderType;
  minutesBeforeStart: number;
  label: string;
  lowerBoundDriftMinutes: number;
};

export const reminderTargets: ReminderTarget[] = [
  {
    type: "twenty_four_hours",
    minutesBeforeStart: 24 * 60,
    label: "24 hours",
    lowerBoundDriftMinutes: 2,
  },
  {
    type: "six_hours",
    minutesBeforeStart: 6 * 60,
    label: "6 hours",
    lowerBoundDriftMinutes: 2,
  },
  {
    type: "one_hour",
    minutesBeforeStart: 60,
    label: "1 hour",
    lowerBoundDriftMinutes: 2,
  },
  {
    type: "fifteen_minutes",
    minutesBeforeStart: 15,
    label: "15 minutes",
    lowerBoundDriftMinutes: 2,
  },
  {
    type: "ten_minutes",
    minutesBeforeStart: 10,
    label: "10 minutes",
    lowerBoundDriftMinutes: 2,
  },
  {
    type: "five_minutes",
    minutesBeforeStart: 5,
    label: "5 minutes",
    lowerBoundDriftMinutes: 2,
  },
];

// Reminder copy helper: "Class 3" → "3rd class"; anything else is untouched.
export const formatOrdinalClass = (title: string) => {
  const match = title.match(/^Class\s+(\d+)$/i);
  if (!match) return title;
  const num = parseInt(match[1], 10);
  const j = num % 10;
  const k = num % 100;
  if (j === 1 && k !== 11) return `${num}st class`;
  if (j === 2 && k !== 12) return `${num}nd class`;
  if (j === 3 && k !== 13) return `${num}rd class`;
  return `${num}th class`;
};

export const floorToMinuteBoundary = (value: Date) => {
  const rounded = new Date(value.getTime());
  rounded.setSeconds(0, 0);
  return rounded;
};

// The cron can skip or drift a few minutes between ticks (external invoker,
// deploys, cold starts), so each target matches classes starting in
// [target - drift, target + 1 minute). Without the drift allowance a single
// skipped tick permanently drops that reminder type for any class whose
// instant fell in the missed minute; with it, the next tick catches up and
// the class_reminder_logs dedupe prevents duplicate sends.
export const getReminderWindow = (base: Date, target: ReminderTarget) => {
  const targetTime = new Date(
    base.getTime() + target.minutesBeforeStart * 60 * 1000
  );
  return {
    windowStart: new Date(
      targetTime.getTime() - target.lowerBoundDriftMinutes * 60 * 1000
    ),
    windowEnd: new Date(targetTime.getTime() + 60 * 1000),
  };
};
