"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A tutor's breakout rooms for one running class, on its My classes card.
 * Rooms are extra Discord voice channels beside the class's own; see
 * src/lib/breakoutRooms.ts.
 */

type BreakoutState = {
  canOpen: boolean;
  liveChannelUrl: string | null;
  maxRooms: number;
  rooms: { id: string; number: number; url: string; students: string[] }[];
  inMainRoom: string[];
  notInCall: string[];
  unknown: string[];
  withoutDiscord: number;
  problems?: string[];
  error?: string;
};

const button =
  "rounded-full border border-[var(--foreground)] px-3 py-1 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-60";
const quietButton =
  "rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--foreground)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60";

const names = (list: string[]) => (list.length ? list.join(", ") : "—");

export default function BreakoutRoomsPanel({ classId }: { classId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<BreakoutState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [count, setCount] = useState("3");
  const [split, setSplit] = useState(true);

  const url = `/api/classes/${classId}/breakout-rooms`;

  const load = useCallback(async () => {
    setBusy((current) => current ?? "Refreshing...");
    try {
      const response = await fetch(url, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as BreakoutState | null;
      if (!response.ok || !data) {
        setError(data?.error ?? "Could not load the breakout rooms.");
        return;
      }
      setError("");
      setState(data);
    } finally {
      setBusy((current) => (current === "Refreshing..." ? null : current));
    }
  }, [url]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const act = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    setError("");
    setProblems([]);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => null)) as BreakoutState | null;
      if (!response.ok || !data) {
        setError(data?.error ?? "That did not work. Try again.");
        return;
      }
      setState(data);
      setProblems(data.problems ?? []);
    } finally {
      setBusy(null);
    }
  };

  const closeRooms = () => {
    if (window.confirm("Bring everyone back to the class channel and delete the breakout rooms?")) {
      void act("Closing rooms...", { action: "close" });
    }
  };

  if (!open) {
    return (
      <div>
        <button type="button" className={quietButton} onClick={() => setOpen(true)}>
          Breakout rooms
        </button>
      </div>
    );
  }

  const rooms = state?.rooms ?? [];
  const roomsLeft = (state?.maxRooms ?? 10) - rooms.length;

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          Breakout rooms
        </p>
        <div className="flex gap-2">
          <button type="button" className={quietButton} onClick={() => void load()} disabled={Boolean(busy)}>
            Refresh
          </button>
          <button type="button" className={quietButton} onClick={() => setOpen(false)}>
            Hide
          </button>
        </div>
      </div>

      {busy ? <p className="text-xs text-[var(--muted)]">{busy}</p> : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {problems.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-[var(--foreground)]">
          <p className="font-semibold">Some people could not be moved:</p>
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      ) : null}

      {state && !state.canOpen && rooms.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">
          Breakout rooms open once the class voice channel is up and students are let in, 5 minutes
          before the start.
        </p>
      ) : null}

      {state && (state.canOpen || rooms.length > 0) ? (
        <>
          {roomsLeft > 0 && state.canOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
                Open
                <input
                  type="number"
                  min={1}
                  max={roomsLeft}
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                  className="w-16 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground)]"
                />
                {rooms.length ? "more rooms" : "rooms"}
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
                <input type="checkbox" checked={split} onChange={(event) => setSplit(event.target.checked)} />
                Split the students into them
              </label>
              <button
                type="button"
                className={button}
                disabled={Boolean(busy)}
                onClick={() => void act("Opening rooms...", { action: "open", count: Number(count), split })}
              >
                Open
              </button>
            </div>
          ) : null}

          {rooms.length > 0 ? (
            <>
              <ul className="space-y-1">
                {rooms.map((room) => (
                  <li key={room.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-[var(--foreground)]">
                      <span className="font-semibold">Room {room.number}</span>
                      <span className="text-[var(--muted)]"> · {names(room.students)}</span>
                    </span>
                    <a className={quietButton} href={room.url} target="_blank" rel="noreferrer">
                      Join in Discord
                    </a>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={quietButton}
                  disabled={Boolean(busy)}
                  onClick={() => void act("Splitting students...", { action: "split" })}
                >
                  Split students again
                </button>
                <button type="button" className={button} disabled={Boolean(busy)} onClick={closeRooms}>
                  Bring everyone back
                </button>
              </div>
            </>
          ) : null}

          <div className="space-y-0.5 text-xs text-[var(--muted)]">
            <p>
              In the class channel: {names(state.inMainRoom)}
              {state.liveChannelUrl ? (
                <>
                  {" "}
                  <a className="underline" href={state.liveChannelUrl} target="_blank" rel="noreferrer">
                    open
                  </a>
                </>
              ) : null}
            </p>
            {state.notInCall.length ? <p>Not in the call: {names(state.notInCall)}</p> : null}
            {state.unknown.length ? <p>Discord did not say where these students are: {names(state.unknown)}</p> : null}
            {state.withoutDiscord ? (
              <p>
                {state.withoutDiscord} enrolled student{state.withoutDiscord === 1 ? " has" : "s have"} no Discord
                account linked, so cannot be placed in a room.
              </p>
            ) : null}
            <p>Students can also move between rooms themselves; Refresh to see where everyone is.</p>
          </div>
        </>
      ) : null}
    </div>
  );
}
