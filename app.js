/* =====================================================================
   Monglish Teens Placement Test v2 — ENGINE (UI)
   Flow: Reading (30 stratified items) -> Listening (one exercise at the
   reading tier) -> receptive placement -> Writing (task at that level)
   -> Speaking (start = level +/-1 from the writing mark; recorded answers,
   or the live examiner when CONFIG.agentId is set) -> thank-you + tips.
   The candidate never sees a score or a level. Everything is posted to
   n8n (STAGING hooks in CONFIG) and kept as a local backup.
   URL switches: ?test=<name> (labelled TEST TRIAL) · ?examiner (staff
   panel) · ?n8n=<base> (override) · ?from=<anything> (shows Back).
   ===================================================================== */
(function () {
  "use strict";
  const T = window.TPT, C = T.CONFIG, TIERS = T.TIERS, BANK = T.BANK, READING = T.READING;
  const CORE = window.TPT_CORE.make(T);
  const MAX_T = CORE.MAX_T;
  const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
  const esc = x => String(x == null ? "" : x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const qs = new URLSearchParams(location.search);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const EXAMINER = qs.has("examiner");
  const TEST = qs.has("test") ? (qs.get("test") || "Dr. Abir Wafa") : null;

  /* ---------------- services ---------------- */
  let base = C.n8nBase;
  try { const o = qs.get("n8n"); if (o) localStorage.setItem("tpt_n8n", o); base = localStorage.getItem("tpt_n8n") || base; } catch (e) {}
  const HOOK = k => base.replace(/\/$/, "") + "/webhook/" + C.hooks[k];
  function post(kind, body, timeoutMs) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs || 20000);
    return fetch(HOOK(kind), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal })
      .finally(() => clearTimeout(t));
  }

  /* ---------------- state ---------------- */
  const S = {
    attemptId: "TPT-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
    student: {}, stage: "welcome", startedAt: null,
    rAnswers: new Array(READING.length).fill(-1), rTimes: [], rLast: null,
    R: null, Ls: null, P: null, lChosen: {}, plays: 0, notPlayed: false,
    writeTier: null, writingText: "", aiWriting: null, speakTier: null, speakWhy: "",
    clips: [], recQs: [], micFlagged: false, aiSpeaking: null, timer: null, left: C.totalMinutes * 60
  };

  /* ---------------- header: back, test badge, timer ---------------- */
  $("#backBtn").addEventListener("click", () => { if (history.length > 1) history.back(); else location.href = "../"; });
  if (!(history.length > 1 || qs.has("from") || document.referrer)) $("#backBtn").classList.add("hidden");
  if (TEST) { $("#testBadge").classList.remove("hidden"); $("#testBadge").textContent = "TEST TRIAL"; }
  const fmt = s => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  /* Per-part clock (CONFIG.timing). When a part's time runs out it is submitted. */
  function listeningMinutes() { return C.timing.listeningMin; }
  const PART_MIN = {
    reading: () => C.timing.readingMin,
    listening: () => C.timing.listeningMin,
    writing: () => C.timing.writingMin,
    speaking: () => C.timing.speakingMin
  };
  function startClock(part) {
    clearInterval(S.timer);
    S.left = PART_MIN[part]() * 60; S.limits = S.limits || {}; S.limits[part] = S.left / 60;
    $("#timer").textContent = fmt(S.left); $("#timer").classList.remove("warn");
    S.timer = setInterval(() => {
      S.left--; $("#timer").textContent = fmt(Math.max(0, S.left));
      $("#timer").classList.toggle("warn", S.left <= 60);
      if (S.left <= 0) { clearInterval(S.timer); timeUp(); }
    }, 1000);
  }
  $("#timer").textContent = fmt(C.timing.readingMin * 60);
  function timeUp() {
    if (S.stage === "reading") submitReading(true);
    else if (S.stage === "listening") submitListening(true);
    else if (S.stage === "writing") submitWriting(true);
    else if (S.stage === "speaking") finish();
  }

  function show(id) {
    $$("main > section").forEach(s => s.classList.add("hidden"));
    $("#s-" + id).classList.remove("hidden"); S.stage = id;
    const order = ["reading", "listening", "writing", "speaking"];
    $("#steps").classList.toggle("hidden", id === "welcome");
    const cur = id === "break" ? 2 : id === "finish" ? 4 : order.indexOf(id);
    $$(".step").forEach(st => {
      const i = order.indexOf(st.dataset.s);
      st.classList.toggle("on", i === cur); st.classList.toggle("done", i < cur);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------- welcome ---------------- */
  $("#startBtn").addEventListener("click", () => {
    const name = $("#stName").value.trim(), age = parseInt($("#stAge").value, 10), ok = $("#consent").checked;
    const errs = [];
    $("#stName").classList.toggle("err", !name); if (!name) errs.push("Please write your full name.");
    const ageOk = !isNaN(age) && age >= C.ageMin && age <= C.ageMax;
    $("#stAge").classList.toggle("err", !ageOk); if (!ageOk) errs.push(`Please write your age (${C.ageMin}–${C.ageMax}).`);
    if (!ok) errs.push("Please tick the consent box.");
    const box = $("#welcomeErr");
    if (errs.length) { box.innerHTML = errs.map(esc).join("<br>"); box.classList.remove("hidden"); return; }
    box.classList.add("hidden");
    S.student = { name, age, branch: $("#stBranch").value.trim(), date: new Date().toISOString().slice(0, 10) };
    S.startedAt = Date.now(); startReading();
  });

  /* ---------------- PART 1: reading ---------------- */
  function startReading() {
    const list = $("#rList");
    list.innerHTML = READING.map((q, i) => `
      <div class="q" id="rq${i}">
        <div class="qn">Question ${i + 1} of ${READING.length}</div>
        <div class="qt">${esc(q.q)}</div>
        <div class="opts">${q.o.map((o, k) => `<label class="opt"><input type="radio" name="r${i}" value="${k}"><span>${String.fromCharCode(65 + k)}. ${esc(o)}</span></label>`).join("")}</div>
      </div>`).join("");
    S.rLast = Date.now(); startClock("reading");
    list.addEventListener("change", e => {
      const m = /^r(\d+)$/.exec(e.target.name || ""); if (!m) return;
      const i = +m[1];
      if (S.rAnswers[i] < 0) { const now = Date.now(); S.rTimes.push(now - S.rLast); S.rLast = now; }
      S.rAnswers[i] = +e.target.value; $("#rq" + i).classList.add("answered");
      const a = S.rAnswers.filter(x => x >= 0).length;
      $("#rCount").textContent = `${a} / ${READING.length}`; $("#rFill").style.width = (a / READING.length * 100) + "%";
    });
    show("reading");
  }
  let rConfirmed = false;
  $("#rSubmit").addEventListener("click", () => submitReading(false));
  function submitReading(force) {
    const answered = S.rAnswers.filter(x => x >= 0).length, min = Math.ceil(READING.length * C.minCoverage);
    if (!force && answered < min && !rConfirmed) {
      rConfirmed = true;
      $("#rWarn").innerHTML = `<div class="note warn">You have answered ${answered} of ${READING.length}. Unanswered questions count as wrong. Press Submit again to continue anyway.</div>`;
      return;
    }
    S.R = CORE.scoreReading(S.rAnswers, S.rTimes);
    startListening();
  }

  /* ---------------- PART 2: listening (one exercise at the reading tier) ---------------- */
  let audioEl = null, speaking = false;
  function startListening() {
    const tier = S.R.tier, task = BANK[tier].listening;
    S.lTier = tier; S.plays = 0; S.lChosen = {};
    $("#lTitle").textContent = "Part 2 · Listening — " + task.title;
    $("#lInstr").textContent = task.instruction + " The first one is an example.";
    $("#playInfo").textContent = `You can play the recording ${C.maxPlays} times.`;
    $("#lList").innerHTML = task.items.map((it, i) => {
      const order = it.example ? it.options.slice() : shuffle(it.options.slice());   // no answer-position bias
      const opts = order.map((o, k) => `<label class="opt${it.example ? " locked" : ""}"><input type="radio" name="l${i}" value="${esc(o)}" ${it.example && o === it.answer ? "checked" : ""} ${it.example ? "disabled" : ""}><span>${String.fromCharCode(65 + k)}. ${esc(o)}</span></label>`).join("");
      return `<div class="q${it.example ? " answered" : ""}"><div class="qn">${it.example ? "Example" : "Question " + i}${it.example ? '<span class="eg">EXAMPLE</span>' : ""}</div><div class="qt">${esc(it.q)}</div><div class="opts">${opts}</div></div>`;
    }).join("");
    $("#lList").onchange = e => { const m = /^l(\d+)$/.exec(e.target.name || ""); if (m) S.lChosen[+m[1]] = e.target.value; };
    audioEl = new Audio(); audioEl.preload = "auto"; audioEl.src = task.audioSrc;
    audioEl.onended = () => { speaking = false; setPlay(); };
    show("listening"); startClock("listening");
    $("#lTime").textContent = `${listeningMinutes()} minutes for this part (${C.maxPlays} plays + time to answer 5 questions).`;
  }
  function setPlay() {
    const left = C.maxPlays - S.plays;
    $("#playBtn").disabled = left <= 0 || speaking;
    $("#playBtn").innerHTML = speaking ? "&#9654; Playing&hellip;" : left <= 0 ? "No plays left" : (S.plays ? "&#8635; Play again" : "&#9654; Play");
    $("#playInfo").textContent = left > 0 ? `Plays left: ${left}` : "You have used all your plays.";
  }
  $("#playBtn").addEventListener("click", () => {
    if (S.plays >= C.maxPlays || speaking) return;
    S.plays++; speaking = true; setPlay();
    const task = BANK[S.lTier].listening;
    audioEl.currentTime = 0;
    audioEl.play().catch(() => ttsPlay(task));
  });
  /* Fallback until the ElevenLabs recordings exist: read the script in an en-US voice */
  function ttsPlay(task) {
    if (!("speechSynthesis" in window)) { speaking = false; setPlay(); return; }
    const vs = speechSynthesis.getVoices().filter(v => /en[-_]US/i.test(v.lang));
    const pick = who => vs.length ? vs[(who === "W" || who === "W2") ? Math.min(1, vs.length - 1) : (who === "M2" ? Math.min(2, vs.length - 1) : 0)] : null;
    const lines = [];
    task.items.forEach((it, i) => { lines.push({ who: "NARR", text: it.example ? "Example." : "Number " + i + "." }); it.script.forEach(l => lines.push(l)); });
    speechSynthesis.cancel();
    lines.forEach((l, k) => {
      const u = new SpeechSynthesisUtterance(l.text); u.lang = "en-US"; u.rate = S.lTier <= 2 ? 0.85 : 0.95;
      const v = pick(l.who); if (v) u.voice = v;
      if (k === lines.length - 1) u.onend = () => { speaking = false; setPlay(); };
      speechSynthesis.speak(u);
    });
  }
  $("#lSubmit").addEventListener("click", () => submitListening(false));
  function submitListening(force) {
    try { audioEl && audioEl.pause(); if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch (e) {}
    S.notPlayed = S.plays === 0;
    S.Ls = CORE.scoreListening(S.lTier, S.lChosen);
    S.P = CORE.provisional(S.R, S.Ls);
    S.writeTier = S.P.tier;
    clearInterval(S.timer);
    show("break");
    sendResult();
  }

  function common() {
    return { attemptId: S.attemptId, test: !!TEST, student: TEST ? "TEST TRIAL - " + TEST : S.student.name,
             enteredName: S.student.name, age: S.student.age, branch: S.student.branch, testDate: S.student.date, version: C.version };
  }
  function sendResult() {
    const R = S.R, Ls = S.Ls, P = S.P, Tt = TIERS[P.tier];
    const body = Object.assign(common(), {
      readingScore: R.score, readingAnswered: R.answered, readingTotal: R.total, coverage: Math.round(R.coverage * 100) + "%",
      provisional: R.provisional, readingByLevel: R.profile.text, readingSecureUpTo: R.profile.secure ? TIERS[R.profile.secure].cefr : "below Pre-A1",
      readingUneven: R.profile.uneven, readingSections: Object.entries(R.sections).map(([k, v]) => `${k} ${v[0]}/${v[1]}`).join(" · "),
      readingFastShare: Math.round(R.fastShare * 100) + "%",
      listeningTier: Ls.tier, listeningScore: `${Ls.correct}/${Ls.total}`, listeningPct: Ls.pct, listeningPlays: S.plays,
      listeningSecure: Ls.perObj.filter(o => o.correct).map(o => o.obj).join(", "),
      listeningToDevelop: Ls.perObj.filter(o => !o.correct).map(o => o.obj).join(", "),
      receptiveTier: P.tier, receptiveSub: P.sub, readingTe: +P.teR.toFixed(2), listeningTe: +P.teL.toFixed(2), rlGap: +P.gap.toFixed(2),
      course: Tt.course, cefrIndicative: R.provisional ? "WITHHELD - reading coverage below 80%" : Tt.cefr,
      placementBasis: "Reading + Listening (receptive), pending writing, speaking and examiner confirmation",
      readingMarks: CORE.marks100({ reading: R.score }).reading, listeningMarks: CORE.marks100({ listening: Ls.correct }).listening,
      minutes: Math.round((Date.now() - S.startedAt) / 60000), timeLimits: JSON.stringify(S.limits || {})
    });
    S.resultBody = body; saveLocal();
    post("result", body).then(() => { $("#saveStatus").innerHTML = '<span style="color:var(--ok)">&#10003; Your answers have been saved.</span>'; })
      .catch(() => { $("#saveStatus").innerHTML = '<span style="color:#78350F">We could not reach the server. Please tell your teacher, then continue.</span>'; });
  }

  /* ---------------- PART 3: writing (at the receptive level) ---------------- */
  $("#toWriting").addEventListener("click", goWriting);
  function goWriting() {
    const w = BANK[S.writeTier].writing;
    $("#wTask").textContent = w.task;
    $("#wInstr").textContent = w.instruction;
    $("#wPoints").innerHTML = w.points.map(p => `<li>${esc(p)}</li>`).join("");
    $("#wText").placeholder = w.starter;
    $("#wTarget").textContent = `Target: ${w.words[0]}\u2013${w.words[1]} words \u00b7 ${C.timing.writingMin} minutes`;
    show("writing"); startClock("writing");
  }
  const words = s => { const t = String(s || "").trim(); return t ? t.split(/\s+/).length : 0; };
  $("#wText").addEventListener("input", () => { $("#wCount").textContent = words($("#wText").value) + " words"; });
  ["paste", "drop"].forEach(ev => $("#wText").addEventListener(ev, e => e.preventDefault()));
  let wConfirmed = false;
  $("#wSubmit").addEventListener("click", () => submitWriting(false));
  function submitWriting(force) {
    const text = $("#wText").value.trim(), n = words(text), w = BANK[S.writeTier].writing;
    if (!force && n < Math.ceil(w.words[0] * 0.6) && !wConfirmed) {
      wConfirmed = true;
      $("#wWarn").innerHTML = `<div class="note warn">Your text has ${n} words. The task asks for ${w.words[0]}–${w.words[1]}. Add more, or press Submit again to continue.</div>`;
      return;
    }
    S.writingText = text; clearInterval(S.timer);
    $("#wSubmit").disabled = true; $("#wSubmit").textContent = "Saving…";
    const body = Object.assign(common(), {
      tier: S.writeTier, course: TIERS[S.writeTier].course, cefr: TIERS[S.writeTier].cefr, receptiveTier: S.P.tier,
      task: w.task, instruction: w.instruction, contentPoints: w.points, targetWords: w.words, grammarFocus: w.focus,
      targetStructures: BANK[S.writeTier].speaking.grammar, text, wordCount: n,
      rubric: T.WRITING_RUBRIC.map(r => ({ criterion: r.c, focus: r.d })), scale: "1-5 per criterion, against the level tested"
    });
    post("writing", body, 25000).then(r => r.json()).then(d => { if (d && d.ok) S.aiWriting = d; }).catch(() => {})
      .finally(() => { saveLocal(); goSpeaking(); });
  }

  /* ---------------- PART 4: speaking (last) ---------------- */
  function goSpeaking() {
    const total = S.aiWriting && Number(S.aiWriting.total);
    const st = CORE.speakingStart(S.P.tier, isNaN(total) ? null : total);
    S.speakTier = st.t; S.speakWhy = st.why;
    S.recQs = CORE.recordedSet(S.speakTier);
    $("#recList").innerHTML = S.recQs.map((q, i) => `
      <div class="rec-q">
        <div class="rec-head"><span class="num">${i + 1}</span><span>${esc(q)}</span></div>
        <div class="rec-ctrl">
          <button type="button" class="btn btn-outline rec-btn" data-i="${i}">&#127897; Record answer</button>
          <span class="rec-status" id="recStatus${i}"></span>
          <audio class="hidden" id="recAudio${i}" controls></audio>
        </div>
      </div>`).join("");
    $$("#recList .rec-btn").forEach(b => b.addEventListener("click", () => toggleClip(+b.dataset.i, b)));
    if (C.agentId) $("#liveBox").classList.remove("hidden");
    show("speaking"); startClock("speaking");
  }

  let rec = null, recIdx = -1, recChunks = [], recStream = null, recTimer = null;
  async function toggleClip(i, btn) {
    if (rec && recIdx === i) { rec.stop(); return; }
    if (rec) { rec.stop(); }
    try {
      recStream = recStream || await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { micProblem("The browser could not use your microphone. Allow the microphone in the address bar, then try again."); return; }
    recChunks = []; recIdx = i;
    rec = new MediaRecorder(recStream);
    rec.ondataavailable = e => e.data.size && recChunks.push(e.data);
    rec.onstop = () => {
      clearTimeout(recTimer);
      const blob = new Blob(recChunks, { type: rec.mimeType || "audio/webm" });
      const a = $("#recAudio" + i); a.src = URL.createObjectURL(blob); a.classList.remove("hidden");
      const fr = new FileReader();
      fr.onload = () => { S.clips[i] = { n: i + 1, level: S.speakTier, question: S.recQs[i], audioDataUrl: fr.result, seconds: Math.round(blob.size / 4000) }; saveLocal(); };
      fr.readAsDataURL(blob);
      btn.classList.remove("recording"); btn.innerHTML = "&#8635; Record again";
      $("#recStatus" + i).textContent = "Saved ✓";
      rec = null; recIdx = -1;
    };
    rec.start(); btn.classList.add("recording"); btn.innerHTML = "&#9632; Stop";
    $("#recStatus" + i).textContent = "Recording… (up to 90 seconds)";
    recTimer = setTimeout(() => rec && rec.state === "recording" && rec.stop(), 90000);
  }
  function micProblem(msg) {
    const n = $("#micNotice"); n.className = "note warn"; n.textContent = msg; n.classList.remove("hidden");
  }
  $("#micIssueBtn").addEventListener("click", () => {
    S.micFlagged = true; $("#micIssueBtn").disabled = true;
    micProblem("Thank you. An examiner will contact you to complete the speaking part. You can finish the test now.");
    post("flag", Object.assign(common(), { reason: "microphone", stage: "speaking", speakTier: S.speakTier })).catch(() => {});
  });

  /* Live examiner (optional): ElevenLabs widget, ladder resolved here, not by the agent */
  $("#liveBtn").addEventListener("click", () => {
    const t = S.speakTier, up = Math.min(MAX_T, t + 1), down = Math.max(1, t - 1);
    const block = L => CORE.recordedSet(L).map((q, i) => `${i + 1}) ${q}`).join("  ");
    const dv = { student_name: S.student.name, age: String(S.student.age), attemptId: S.attemptId,
      course: TIERS[t].course, cefr: TIERS[t].cefr, descriptor: T.CEFR_DESCRIPTORS[TIERS[t].anchor] || "",
      questions_at: block(t), questions_up: block(up), questions_down: block(down),
      course_up: TIERS[up].course, course_down: TIERS[down].course };
    $("#avatarBox").innerHTML = `<elevenlabs-convai agent-id="${esc(C.agentId)}" dynamic-variables='${JSON.stringify(dv).replace(/'/g, "&#39;")}'></elevenlabs-convai>`;
    if (!document.getElementById("el-widget")) {
      const s = document.createElement("script"); s.id = "el-widget"; s.async = true;
      s.src = "https://unpkg.com/@elevenlabs/convai-widget-embed"; document.body.appendChild(s);
    }
  });

  $("#sFinish").addEventListener("click", finish);
  function finish() {
    if (rec) try { rec.stop(); } catch (e) {}
    clearInterval(S.timer);
    const clips = S.clips.filter(Boolean);
    const done = () => { saveLocal(); renderFinish(); };
    if (!clips.length) { done(); return; }
    $("#sFinish").disabled = true; $("#sFinish").textContent = "Sending your answers…";
    post("speaking", Object.assign(common(), {
      mode: "recorded-answers", receptiveTier: S.P.tier, startLevel: S.speakTier, startReason: S.speakWhy,
      course: TIERS[S.speakTier].course, cefr: TIERS[S.speakTier].cefr, targetStructures: BANK[S.speakTier].speaking.grammar,
      rubric: T.SPEAKING_RUBRIC.map(r => ({ criterion: r.c, focus: r.d })), scale: "1-5 per criterion, against the level tested",
      rawMarks: { reading: S.R.score, listening: S.Ls.correct, writing: S.aiWriting && S.aiWriting.total != null ? Number(S.aiWriting.total) : null },
      clips: clips.map(c => ({ n: c.n, question: c.question, level: c.level, audioDataUrl: c.audioDataUrl }))
    }), 60000).then(r => r.json()).then(d => { if (d && d.ok) S.aiSpeaking = d; }).catch(() => {}).finally(done);
  }

  /* ---------------- finish: thank-you + tips only ---------------- */
  const GENERIC = {
    Reading: "Read something short in English every day — a news story for teens, a comic or song lyrics — and note three new words.",
    Listening: "Watch a short English video with English subtitles, then watch it again without them.",
    Writing: "Plan before you write: list your points, then join them with words like because, so, but and however.",
    Speaking: "Answer in full sentences and add one extra detail or reason to every answer."
  };
  function tips() {
    const out = [];
    const add = (skill, arr) => (Array.isArray(arr) ? arr : []).filter(Boolean).slice(0, 2).forEach(t => out.push({ skill, t: String(t) }));
    add("Speaking", S.aiSpeaking && S.aiSpeaking.tips); if (!out.some(x => x.skill === "Speaking")) out.push({ skill: "Speaking", t: GENERIC.Speaking });
    add("Writing", S.aiWriting && S.aiWriting.tips); if (!out.some(x => x.skill === "Writing")) out.push({ skill: "Writing", t: GENERIC.Writing });
    const gaps = S.Ls ? [...new Set(S.Ls.perObj.filter(o => !o.correct).map(o => o.obj))] : [];
    out.push({ skill: "Listening", t: (gaps.length ? `When you listen, focus on ${gaps.slice(0, 3).join(", ")}. ` : "") + GENERIC.Listening });
    out.push({ skill: "Reading", t: GENERIC.Reading });
    return out;
  }
  function renderFinish() {
    const first = (S.student.name || "").split(/\s+/)[0];
    $("#candidateResult").innerHTML = `
      <h2>Thank you${first ? ", " + esc(first) : ""}! &#127881;</h2>
      <p class="sub">You have finished all four parts. Your answers have been sent to the Monglish Academic Team, who will contact you about your class.</p>
      ${S.micFlagged ? '<div class="note warn">An examiner will contact you to complete the speaking part.</div>' : ""}
      <h3 style="margin-top:14px;color:var(--navy)">Tips to keep improving</h3>
      <ul class="tips">${tips().map(x => `<li><span class="tip-skill">${esc(x.skill)}</span><span>${esc(x.t)}</span></li>`).join("")}</ul>
      <p class="sub" style="margin-top:14px">You may now close this window.</p>`;
    if (EXAMINER) { $("#examinerPanel").classList.remove("hidden"); buildExaminer(); }
    show("finish");
  }

  /* ---------------- examiner panel (?examiner) ---------------- */
  function rubricHtml(key, rubric, ai) {
    return `<div class="rub">${rubric.map((r, i) => `<label for="${key}${i}"><b>${esc(r.c)}</b><small>${esc(r.d)}</small></label>
      <select id="${key}${i}"><option value="">–</option>${[1, 2, 3, 4, 5].map(v => `<option value="${v}" ${ai && Number(ai[i]) === v ? "selected" : ""}>${v} ${T.BAND_WORDS[v]}</option>`).join("")}</select>`).join("")}</div>`;
  }
  function buildExaminer() {
    const R = S.R, Ls = S.Ls, P = S.P;
    const levelOpts = sel => Object.keys(TIERS).map(t => `<option value="${t}" ${+t === sel ? "selected" : ""}>${t} · ${TIERS[t].course} (${TIERS[t].cefr})</option>`).join("");
    $("#examinerPanel").innerHTML = `
      <h2>Examiner view <span style="font-size:12px;color:var(--muted)">staff only &middot; ${esc(S.attemptId)}</span></h2>
      <div class="kv">
        <span>Reading</span><b>${R.score}/${R.total} &middot; answered ${R.answered} &middot; ${esc(R.profile.text)}</b>
        <span>Listening (level ${Ls.tier})</span><b>${Ls.correct}/${Ls.total} &middot; plays ${S.plays}</b>
        <span>Receptive level</span><b>${P.tier} &middot; ${esc(TIERS[P.tier].course)} (${TIERS[P.tier].cefr}), ${P.sub}; R/L gap ${P.gap.toFixed(2)}</b>
        <span>Writing task level</span><b>${S.writeTier} &middot; ${words(S.writingText)} words${S.aiWriting ? " &middot; AI total " + esc(S.aiWriting.total) + "/20" : " &middot; no AI mark yet"}</b>
        <span>Speaking</span><b>started at level ${S.speakTier} (${esc(S.speakWhy)}) &middot; ${S.clips.filter(Boolean).length} recorded answers${S.aiSpeaking ? " &middot; AI total " + esc(S.aiSpeaking.total) + "/25" : ""}</b>
      </div>
      <h3 style="margin-top:16px">Writing (1&ndash;5 against the level tested)</h3>
      <p class="sub" style="white-space:pre-wrap;background:#F2F4F8;border-radius:8px;padding:10px;margin-top:6px">${esc(S.writingText || "(no text)")}</p>
      ${rubricHtml("wr", T.WRITING_RUBRIC, S.aiWriting && S.aiWriting.scores)}
      <h3>Speaking (1&ndash;5 against the level tested)</h3>
      <label class="f" for="spLevel">Level the speaking was assessed at</label>
      <select id="spLevel">${levelOpts(S.speakTier)}</select>
      ${rubricHtml("sp", T.SPEAKING_RUBRIC, S.aiSpeaking && S.aiSpeaking.scores)}
      <button class="btn btn-navy" id="calcBtn" type="button">Calculate final placement</button>
      <button class="btn btn-outline" id="dlBtn" type="button">Download record (JSON)</button>
      <div id="finalBox"></div>`;
    $("#calcBtn").addEventListener("click", () => {
      const read = (k, n) => Array.from({ length: n }, (_, i) => Number($("#" + k + i).value) || 0);
      const F = CORE.decide({ recTier: P.tier, spLevel: +$("#spLevel").value, sp: read("sp", 5), wr: read("wr", 4), wrTier: S.writeTier,
        gap: P.gap, uneven: R.profile.uneven, readingSecure: R.profile.secure, readingTier: R.tier, provisional: R.provisional, fastShare: R.fastShare, notPlayed: S.notPlayed, micFlagged: S.micFlagged });
      const sum = arr => arr.every(v => v >= 1) ? arr.reduce((x, y) => x + y, 0) : null;
      const M = CORE.marks100({ reading: R.score, listening: Ls.correct, writing: sum(read("wr", 4)), speaking: sum(read("sp", 5)) });
      F.marks100 = M; S.final = F; saveLocal();
      $("#finalBox").innerHTML = `<div class="final"><h3>Place in <span>${esc(F.course)}</span> &middot; ${R.provisional ? "CEFR withheld" : esc(F.cefr) + " (indicative)"}</h3>
        <p>Speaking: ${F.spTotal == null ? "missing" : F.spTotal + "/25"} (${F.spBand}) &middot; Writing: ${F.wrTotal == null ? "missing" : F.wrTotal + "/20"} (${F.wrBand}) &middot; Confidence: <b>${F.confidence}</b></p>
        <p>Marks: Reading ${M.reading}/25 &middot; Listening ${M.listening}/25 &middot; Writing ${M.writing == null ? "\u2013" : M.writing}/25 &middot; Speaking ${M.speaking == null ? "\u2013" : M.speaking}/25 &middot; <b>Total ${M.total}/100</b>${M.complete ? "" : " (incomplete)"} <span style="opacity:.75">\u2014 for the record; the level follows the rules above</span></p>
        <ul class="flags">${F.flags.map(f => `<li>${esc(f)}</li>`).join("")}</ul></div>`;
      post("report", Object.assign(common(), { final: F, receptiveTier: P.tier })).catch(() => {});
    });
    $("#dlBtn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(record(true), null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = S.attemptId + ".json"; a.click();
    });
  }

  /* ---------------- local backup ---------------- */
  function record(withAudio) {
    return { attemptId: S.attemptId, student: S.student, test: TEST, reading: S.R, answers: S.rAnswers, listening: S.Ls, provisional: S.P,
      writing: { tier: S.writeTier, text: S.writingText, ai: S.aiWriting }, speaking: { tier: S.speakTier, why: S.speakWhy, ai: S.aiSpeaking,
      clips: S.clips.filter(Boolean).map(c => withAudio ? c : { n: c.n, question: c.question }) }, micFlagged: S.micFlagged, final: S.final || null };
  }
  function saveLocal() { try { localStorage.setItem("tpt_" + S.attemptId, JSON.stringify(record(false))); } catch (e) {} }

  /* expose for automated tests */
  window.__TPT_STATE = S;
})();
