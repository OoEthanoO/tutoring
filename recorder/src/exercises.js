// Kept separate from capture/tick: exercise requests never block recording.
(function () {
  "use strict";
  window.createRecorderExercises = ({ api, context, showView }) => {
    const $ = id => document.getElementById(id);
    let opened = false, working = false, loading = false, epoch = 0;
    let selected = "", data = null, demo = false, pendingPublish = null;
    let clock = { server: 0, received: 0 };
    let lastResponses = "", lastReview = "", review = "";
    const feedbackDrafts = new Map();
    const demoRooms = new Map();
    const now = () => clock.server + performance.now() - clock.received;
    const current = () => data?.questions.find(q => q.id === data.currentQuestionId);
    const classPath = () => `/api/recorder/exercises/${selected}${review ? `?questionId=${encodeURIComponent(review)}` : ""}`;
    const isOpen = () => !!current() && !current().stopped_at && now() < Date.parse(current().closes_at);
    const message = (text, error = false) => { $("exercises-message").textContent = text; $("exercises-message").classList.toggle("error", error); };
    const ensureSession = () => {
      if (demo !== !!context().test || (!demo && !context().token)) throw new Error("The session changed. Reopen class exercises.");
    };
    const request = async (path, options) => {
      ensureSession();
      if (demo) throw new Error("Practice mode cannot contact the server.");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const result = await api(path, { ...options, signal: controller.signal });
        if (!result.ok) throw new Error(result.data?.error || "Unable to reach YanLearn. Try again.");
        return result.data;
      } finally { clearTimeout(timer); }
    };
    const setData = value => {
      if (data?.currentQuestionId !== value.currentQuestionId) review = value.currentQuestionId || "";
      data = value;
      if (pendingPublish && value.questions.some(q => q.id === pendingPublish.id)) {
        const draftKey = JSON.stringify([selected, $("exercises-draft").value, Math.round(Number($("exercises-duration").value) * 60)]);
        if (draftKey === pendingPublish.key) $("exercises-draft").value = "";
        pendingPublish = null;
      }
      clock = { server: value.serverNow, received: performance.now() };
      render();
    };
    const tickClock = () => {
      const active = isOpen();
      const seconds = active ? Math.max(0, Math.ceil((Date.parse(current().closes_at) - now()) / 1000)) : 0;
      const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      $("exercises-countdown").textContent = active ? `${countdown} left` : "Submissions closed";
      $("exercises-button").textContent = active ? `Class exercises · ${countdown}` : "Class exercises";
      $("exercises-stop").disabled = !active || working;
      $("exercises-sample").disabled = !active || working;
    };
    const render = () => {
      const q = current();
      $("exercises-current").hidden = !q;
      $("exercises-number").textContent = q ? `Question ${q.number}` : "";
      $("exercises-prompt").textContent = q?.prompt || "";
      $("exercises-send").disabled = working || !selected || !data;
      $("exercises-class").disabled = working;
      $("exercises-refresh").disabled = working;
      $("exercises-announce").hidden = demo || !q || data?.announced;
      $("exercises-announce").disabled = working;
      $("exercises-copy").disabled = demo || !selected;
      $("exercises-link").value = demo ? "Practice mode — no public link" : selected ? `${context().serverUrl}/class-exercises/${selected}` : "";
      const choices = $("exercises-review");
      if (JSON.stringify(data?.questions.map(q => q.id)) !== choices.dataset.ids) {
        choices.replaceChildren(...(data?.questions || []).map(q => new Option(`Question ${q.number}${q.id === data.currentQuestionId ? " (current)" : ""}`, q.id)));
        choices.dataset.ids = JSON.stringify(data?.questions.map(q => q.id));
      }
      choices.value = review;
      renderResponses();
      tickClock();
    };
    const renderResponses = () => {
      const attempts = (data?.submissions || []).filter(s => s.question_id === review);
      const latest = new Map();
      attempts.forEach(s => { if (!latest.has(s.student_id) || latest.get(s.student_id).attempt < s.attempt) latest.set(s.student_id, s); });
      const rows = [...latest.values()].sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || a.studentName.localeCompare(b.studentName));
      $("exercises-summary").textContent = rows.length ? `${rows.length} students responded · ${rows.filter(s => s.status === "pending").length} waiting for marking · ${rows.filter(s => s.status === "correct").length} correct` : "No responses yet. Answers appear here automatically.";
      const signature = JSON.stringify([review, attempts]);
      // Don't replace focused editors or destroy drafts as another student submits.
      const container = $("exercises-responses");
      if (signature === lastResponses || (lastReview === review && container.contains(document.activeElement))) return;
      lastResponses = signature;
      lastReview = review;
      const expanded = new Set([...container.querySelectorAll("details[open]")].map(el => el.dataset.id));
      const previousIds = new Set([...container.children].map(el => el.dataset.id));
      container.replaceChildren();
      rows.forEach(s => {
        const item = document.createElement("details");
        item.className = "card exercise-response"; item.dataset.id = s.id;
        item.open = expanded.has(s.id) || (!previousIds.has(s.id) && s.status === "pending");
        const summary = document.createElement("summary");
        summary.textContent = `${s.studentName} · ${s.status} · attempt ${s.attempt}`;
        const answer = document.createElement("pre"); answer.className = "exercise-code"; answer.textContent = s.answer;
        const form = document.createElement("form");
        const label = document.createElement("label"); label.textContent = "Feedback";
        const feedback = document.createElement("textarea"); feedback.rows = 3; feedback.maxLength = 10000;
        feedback.value = feedbackDrafts.get(s.id) ?? s.feedback;
        feedback.addEventListener("input", () => feedbackDrafts.set(s.id, feedback.value));
        label.append(feedback); form.append(label);
        const actions = document.createElement("div"); actions.className = "actions";
        ["correct", "incorrect"].forEach(status => {
          const button = document.createElement("button"); button.type = "button";
          button.textContent = status === "correct" ? "Mark correct & send feedback" : "Mark incorrect & send feedback";
          button.addEventListener("click", async () => {
            if (working) return;
            const success = await mutate({ action: "grade", submissionId: s.id, status, feedback: feedback.value });
            if (success) { feedbackDrafts.delete(s.id); feedback.blur(); button.blur(); lastResponses = ""; render(); }
          }); actions.append(button);
        });
        form.addEventListener("submit", event => event.preventDefault()); form.append(actions); item.append(summary, answer, form);
        const older = attempts.filter(old => old.student_id === s.student_id && old.id !== s.id).sort((a, b) => b.attempt - a.attempt);
        older.forEach(old => {
          const history = document.createElement("details");
          const heading = document.createElement("summary"); heading.textContent = `Earlier attempt ${old.attempt} · ${old.status}`;
          const body = document.createElement("pre"); body.className = "exercise-code"; body.textContent = `${old.answer}\n\nFeedback: ${old.feedback || "None"}`;
          history.append(heading, body); item.append(history);
        });
        container.append(item);
      });
    };
    const refresh = async () => {
      if (!opened || !selected || loading || working) return;
      const version = epoch;
      loading = true;
      try {
        ensureSession();
        if (demo) { if (demoRooms.has(selected)) setData({ ...demoRooms.get(selected), serverNow: Date.now() }); return; }
        const value = await request(classPath());
        if (version === epoch) setData(value);
      } catch (error) { if (version === epoch) message(`${error.message} Reconnecting…`, true); }
      finally { loading = false; }
    };
    const mutate = async body => {
      if (working || !selected) return false;
      const version = ++epoch;
      working = true; render();
      message("Saving…");
      try {
        ensureSession();
        let value;
        if (demo) {
          value = structuredClone(data);
          const stamp = new Date().toISOString();
          if (body.action === "publish") {
            const old = value.questions.find(q => q.id === value.currentQuestionId); if (old) old.stopped_at = stamp;
            value.questions.unshift({ id: body.id, number: value.questions.length + 1, prompt: body.prompt, opened_at: stamp, closes_at: new Date(Date.now() + body.durationSeconds * 1000).toISOString(), stopped_at: null });
            value.currentQuestionId = body.id;
          } else if (body.action === "stop") value.questions.find(q => q.id === body.questionId).stopped_at = stamp;
          else if (body.action === "grade") Object.assign(value.submissions.find(s => s.id === body.submissionId), { status: body.status, feedback: body.feedback });
          value.serverNow = Date.now(); demoRooms.set(selected, value);
        } else value = await request(classPath(), { method: "POST", body });
        if (version !== epoch) return false;
        setData(value);
        message(demo ? "Saved in practice mode only." : body.action === "publish" ? "Question shared. Students use the same class link." : "Saved.");
        return true;
      } catch (error) { if (version === epoch) message(error.message, true); return false; }
      finally { working = false; render(); void refresh(); }
    };
    const chooseClass = async () => {
      epoch++; selected = $("exercises-class").value; data = null; review = ""; lastResponses = "";
      pendingPublish = null; $("exercises-draft").value = ""; feedbackDrafts.clear();
      render(); await refresh();
    };
    const loadClasses = async () => {
      const version = ++epoch;
      message("Loading classes…");
      try {
        const classes = demo ? [{ id: "practice", courseTitle: "Practice class", title: "Try class exercises", startsAt: new Date().toISOString() }] : (await request("/api/recorder/exercises")).classes;
        if (version !== epoch) return;
        const preferred = classes.find(c => c.id === selected) || classes.find(c => c.id === context().classId)
          || classes.find(c => Date.parse(c.startsAt) <= Date.now() && Date.parse(c.endsAt) > Date.now())
          || [...classes].sort((a, b) => Math.abs(Date.parse(a.startsAt) - Date.now()) - Math.abs(Date.parse(b.startsAt) - Date.now()))[0];
        $("exercises-class").replaceChildren(...classes.map(c => new Option(`${c.courseTitle} — ${c.title} · ${new Date(c.startsAt).toLocaleString()}`, c.id)));
        $("exercises-class").value = preferred?.id || "";
        if (demo && !demoRooms.has("practice")) demoRooms.set("practice", { questions: [], submissions: [], currentQuestionId: null, announced: true, serverNow: Date.now() });
        message(classes.length ? "One link for every question in this class. YanBot posts it with the first question." : "No classes found in the past or next 30 days.");
        if (selected !== (preferred?.id || "") || !data) await chooseClass(); else await refresh();
      } catch (error) { message(error.message, true); }
    };
    $("exercises-class").addEventListener("change", chooseClass);
    $("exercises-refresh").addEventListener("click", loadClasses);
    $("exercises-review").addEventListener("change", () => { review = $("exercises-review").value; renderResponses(); void refresh(); });
    $("exercises-publish").addEventListener("submit", async event => {
      event.preventDefault();
      const prompt = $("exercises-draft").value;
      const durationSeconds = Math.round(Number($("exercises-duration").value) * 60);
      if (!prompt.trim() || !Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 7200) return message("Enter a question and a valid time limit.", true);
      const key = JSON.stringify([selected, prompt, durationSeconds]);
      if (pendingPublish?.key !== key) pendingPublish = { key, id: crypto.randomUUID() };
      if (await mutate({ action: "publish", id: pendingPublish.id, prompt, durationSeconds })) {
        $("exercises-draft").value = ""; pendingPublish = null;
      }
    });
    $("exercises-stop").addEventListener("click", () => { if (current()) void mutate({ action: "stop", questionId: current().id }); });
    $("exercises-announce").addEventListener("click", () => void mutate({ action: "announce" }));
    $("exercises-copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("exercises-link").value); message("Class link copied."); }
      catch { $("exercises-link").select(); message("Copy the selected link with Ctrl+C (or Command+C)."); }
    });
    $("exercises-sample").addEventListener("click", () => {
      if (!demo || !isOpen()) return;
      const student = "practice-student";
      const attempts = data.submissions.filter(s => s.question_id === current().id && s.student_id === student);
      if (attempts.at(-1) && attempts.at(-1).status !== "incorrect") return message("Mark the practice answer incorrect to try a resubmission, or share another question.");
      data.submissions.push({ id: crypto.randomUUID(), student_id: student, studentName: "Practice student", question_id: current().id, attempt: attempts.length + 1, answer: "def greet(name):\n    if name:\n        return 'Hello, ' + name\n", status: "pending", feedback: "" });
      demoRooms.set(selected, structuredClone(data)); render();
    });
    const close = () => { opened = false; showView("main"); };
    $("exercises-back").addEventListener("click", close);
    $("exercises-button").addEventListener("click", () => {
      const nextDemo = !!context().test;
      if (demo !== nextDemo) { selected = ""; data = null; }
      demo = nextDemo; opened = true; showView("exercises");
      $("exercises-test").hidden = !demo; $("exercises-sample").hidden = !demo;
      void loadClasses();
    });
    setInterval(() => { tickClock(); if (opened && (demo !== !!context().test || (!demo && !context().token))) close(); }, 250);
    setInterval(() => { void refresh(); }, 2000);
    return {
      active: () => opened || working || (!demo && isOpen()), close,
      reset: () => { opened = false; epoch++; selected = ""; data = null; feedbackDrafts.clear(); demoRooms.clear(); pendingPublish = null; $("exercises-draft").value = ""; render(); },
    };
  };
})();
