/* =====================================================================
   Monglish Teens Placement v2 — CORE LOGIC (pure functions, no DOM)
   Same rules as the Power Up and Business Result engines, written once so
   they can be unit-tested in Node (see _test/simulate.js).
     Rule 1  common ability scale      theta = tier + (p - mastery) / width
     Rule 3  band table + gates        coverage < 80% -> provisional; uneven profile flag
     Rule 4  productive at level       writing moves speaking start +/-1; decision table
             asymmetric cap            final <= receptive band + 1, lowering unrestricted
     Rule 5  confidence + flags
   ===================================================================== */
(function (root) {
  "use strict";
  function make(T) {
    const { CONFIG, TIERS, DECISION, READING, BANK } = T;
    const MAX_T = Object.keys(TIERS).length;
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

    /* Rule 1 — one block -> position on the common scale */
    const abil = (t, pct) => t + (clamp(pct, 0, 100) - CONFIG.masteryBar) / CONFIG.levelWidth;

    /* Reading: raw score -> tier by band table */
    function tierForScore(score) {
      for (let t = 1; t <= MAX_T; t++) if (score >= TIERS[t].min && score <= TIERS[t].max) return t;
      return score > TIERS[MAX_T].max ? MAX_T : 1;
    }

    /* Reading profile: correct/total per tier, highest tier securely passed
       (that tier and every tier below at >= 2/3), uneven flag (a higher tier
       at least 50 points better than a lower one = possible guessing). */
    function readingProfile(answers) {
      const by = {};
      for (let t = 1; t <= MAX_T; t++) by[t] = [0, 0];
      READING.forEach((q, i) => { by[q.lvl][1]++; if (answers[i] === q.a) by[q.lvl][0]++; });
      let secure = 0;
      for (let t = 1; t <= MAX_T; t++) { const [c, n] = by[t]; if (n && c / n >= 2 / 3) secure = t; else break; }
      let uneven = false;
      for (let lo = 1; lo <= MAX_T; lo++) for (let hi = lo + 1; hi <= MAX_T; hi++) {
        const [cl, nl] = by[lo], [ch, nh] = by[hi];
        if (nl && nh && ch / nh - cl / nl >= 0.5) uneven = true;
      }
      const text = Object.keys(by).map(t => `${TIERS[t].cefr} ${by[t][0]}/${by[t][1]}`).join(" · ");
      return { by, secure, uneven, text };
    }

    function scoreReading(answers, answerTimesMs) {
      let score = 0, answered = 0;
      READING.forEach((q, i) => { if (answers[i] != null && answers[i] >= 0) answered++; if (answers[i] === q.a) score++; });
      const min = Math.ceil(READING.length * CONFIG.minCoverage);
      const tier = tierForScore(score), Tt = TIERS[tier];
      const pos = (score - Tt.min) / (Tt.max - Tt.min + 1);     // 0..<1 inside the band
      const sections = {};
      READING.forEach((q, i) => { const s = q.sec || "Reading"; sections[s] = sections[s] || [0, 0]; sections[s][1]++; if (answers[i] === q.a) sections[s][0]++; });
      const fast = (answerTimesMs || []).filter(ms => ms < CONFIG.fastAnswerMs).length;
      return { score, answered, total: READING.length, coverage: answered / READING.length, provisional: answered < min,
               tier, te: tier + pos, profile: readingProfile(answers), sections, fastShare: answerTimesMs && answerTimesMs.length ? fast / answerTimesMs.length : 0 };
    }

    /* Listening: one exercise at the reading tier; worked example not scored */
    function scoreListening(tier, chosen) {
      const items = BANK[tier].listening.items;
      let correct = 0, total = 0; const perObj = [];
      items.forEach((it, i) => { if (it.example) return; total++; const ok = chosen[i] === it.answer; if (ok) correct++; perObj.push({ obj: it.obj, correct: ok }); });
      const pct = Math.round(correct / Math.max(1, total) * 100);
      return { tier, correct, total, pct, te: clamp(abil(tier, pct), 1, MAX_T + 0.99), perObj };
    }

    /* Receptive placement: equal weight reading + listening */
    function provisional(R, Ls) {
      const te = clamp((R.te + Ls.te) / 2, 1, MAX_T + 0.99);
      const tier = Math.min(MAX_T, Math.floor(te)), pos = te - tier;
      return { tier, pos, sub: pos < 1 / 3 ? "lower" : pos < 2 / 3 ? "secure" : "upper", te, teR: R.te, teL: Ls.te, gap: Math.abs(R.te - Ls.te) };
    }

    /* Writing mark sets where speaking starts */
    function speakingStart(provTier, writingTotal) {
      const W = DECISION.writing;
      if (writingTotal != null && writingTotal >= W.above[0] && provTier < MAX_T) return { t: provTier + 1, why: "one level up - strong writing" };
      if (writingTotal != null && writingTotal > 0 && writingTotal <= W.below[1] && provTier > 1) return { t: provTier - 1, why: "one level down - writing below level" };
      return { t: provTier, why: "reading + listening level" };
    }

    /* Recorded-answer option: five questions at the level, one per topic set in turn */
    function recordedSet(L) {
      const sets = BANK[L].speaking.sets, out = [];
      for (let i = 0; out.length < 5; i++) {
        let added = false;
        sets.forEach(s => { if (s.qs[i] && out.length < 5) { out.push(s.qs[i]); added = true; } });
        if (!added) break;
      }
      return out;
    }

    /* Rule 4 + 5 — final decision. o = { recTier, spLevel, sp[5], wr[4], wrTier, gap, uneven, provisional, fastShare, notPlayed, micFlagged } */
    function decide(o) {
      const D = DECISION, flags = []; let conf = "High";
      const lower = c => { const ord = ["High", "Medium", "Low"]; if (ord.indexOf(c) > ord.indexOf(conf)) conf = c; };
      const sum = a => a.reduce((x, y) => x + y, 0);
      const L = o.spLevel || o.recTier;
      let final = L, spBand = "missing", wrBand = "missing";
      const spOk = Array.isArray(o.sp) && o.sp.length === 5 && o.sp.every(v => v >= 1);
      const wrOk = Array.isArray(o.wr) && o.wr.length === 4 && o.wr.every(v => v >= 1);
      if (spOk) {
        const t = sum(o.sp), mn = Math.min(...o.sp);
        spBand = t >= D.speaking.above[0] ? "above" : t >= D.speaking.place[0] ? (mn >= D.speaking.minCriterionToPlace ? "place" : "borderline")
               : t >= D.speaking.borderline[0] ? "borderline" : "below";
      }
      if (wrOk) {
        const t = sum(o.wr);
        wrBand = t >= D.writing.above[0] ? "above" : t >= D.writing.confirm[0] ? "confirm" : "below";
        if (o.wrTier && o.wrTier !== L) flags.push(`Writing was set at level ${o.wrTier}; speaking was assessed at level ${L}.`);
      }
      if (spBand === "missing") {
        if (wrBand === "below") { final = Math.max(1, o.recTier - 1); flags.push("No speaking evidence and writing below level - placed one level lower; speaking to be done with an examiner."); }
        else { final = o.recTier; flags.push("No speaking evidence - placement rests on reading + listening (+ writing); speaking to be done with an examiner."); }
        lower("Low");
      } else if (spBand === "above") {
        if (wrBand === "below") { final = L; flags.push("Speaking above level but writing below - kept at the level tested."); lower("Medium"); }
        else if (L < MAX_T) { final = L + 1; flags.push("Speaking 22-25 at the level tested - placed one level up; examiner to confirm."); lower("Medium"); }
        else final = L;
      } else if (spBand === "place") {
        final = L;
        if (wrBand === "below") { flags.push("Writing below the placed level - examiner to review."); lower("Medium"); }
        if (wrBand === "missing") { flags.push("No writing submitted."); lower("Medium"); }
      } else if (spBand === "borderline") {
        lower("Medium");
        if (wrBand === "below") { final = Math.max(1, L - 1); flags.push("Borderline speaking and writing below level - placed one level lower."); }
        else if (wrBand === "missing") { final = L; flags.push("Borderline speaking and no writing to decide - examiner to decide."); lower("Low"); }
        else { final = L; flags.push("Borderline speaking - the writing confirmed the level."); }
      } else {
        final = Math.max(1, L - 1); flags.push("Speaking 13 or less at the level tested - placed one level lower.");
        if (wrBand === "above" || wrBand === "confirm") { flags.push("Writing was at or above level - examiner to check."); lower("Medium"); }
      }
      // asymmetric cap: productive evidence may raise by ONE band at most
      if (final > o.recTier + 1) { flags.push(`Productive evidence suggests level ${final}; capped at one above reading + listening (level ${o.recTier + 1}).`); final = o.recTier + 1; lower("Medium"); }
      if (o.gap >= 1.5) { flags.push("Reading and listening differ by 1.5 levels or more."); lower("Low"); }
      else if (o.gap >= 1) { flags.push("Noticeable reading/listening difference."); lower("Medium"); }
      if (o.uneven) { flags.push("Uneven reading profile - possible guessing."); lower("Medium"); }
      if (o.readingSecure != null && o.readingTier != null && o.readingSecure < o.readingTier) { flags.push(`Reading band (level ${o.readingTier}) is above the highest level passed securely (level ${o.readingSecure || 0}, 2/3 rule) - check the receptive level.`); lower("Medium"); }
      if (o.provisional) { flags.push("Reading coverage below 80% - provisional; CEFR withheld."); lower("Low"); }
      if (o.fastShare >= 0.4) { flags.push("Many reading answers were very fast - reliability check advised."); lower("Medium"); }
      if (o.notPlayed) { flags.push("Listening answered without playing the audio."); lower("Medium"); }
      if (o.micFlagged) { flags.push("Microphone problem reported."); lower("Low"); }
      if (spOk) flags.push("Pronunciation is judged by AI from audio/transcript - examiner to confirm.");
      return { final, course: TIERS[final].course, cefr: TIERS[final].cefr, spBand, wrBand, confidence: conf, flags,
               spTotal: spOk ? sum(o.sp) : null, wrTotal: wrOk ? sum(o.wr) : null };
    }

    /* Reported marks out of 100 — raw marks scaled to CONFIG.reportMarks. Missing parts count 0. */
    function marks100(raw) {
      const W = CONFIG.reportMarks, r1 = x => Math.round(x * 10) / 10;
      const part = (got, max, w) => (got == null || isNaN(got)) ? null : r1(Math.max(0, Math.min(max, got)) / max * w);
      const m = { reading: part(raw.reading, READING.length, W.reading), listening: part(raw.listening, 5, W.listening),
                  writing: part(raw.writing, DECISION.writing.max, W.writing), speaking: part(raw.speaking, DECISION.speaking.max, W.speaking) };
      m.total = Math.round((m.reading || 0) + (m.listening || 0) + (m.writing || 0) + (m.speaking || 0));
      m.complete = [m.reading, m.listening, m.writing, m.speaking].every(v => v != null);
      return m;
    }

    return { MAX_T, abil, marks100, tierForScore, readingProfile, scoreReading, scoreListening, provisional, speakingStart, recordedSet, decide };
  }
  root.TPT_CORE = { make };
  if (typeof module !== "undefined") module.exports = { make };
})(typeof window !== "undefined" ? window : globalThis);
