'use strict';

/* ================= Konstanten ================= */
const STORE_KEY = 'englisch-lernen-v1';
// Wiederholungsabstand in Tagen je Stufe (Stufe 0 = neu)
const INTERVALS = [0, 1, 3, 7, 14, 30, 90];
const MAX_LVL = 6;
const SAFE_LVL = 4;              // ab dieser Stufe gilt eine Vokabel als "sicher"
const IDLE_LIMIT = 90 * 1000;    // ohne Eingabe länger als 90 s → Zeit läuft nicht weiter
const SENTENCE_PASS = 0.8;       // Anteil der Wörter, die beim Satz-Sprechen erkannt werden müssen

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const canSpeak = 'speechSynthesis' in window;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const ICON = {
  speaker: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  speakerSm: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

/* ================= Hilfsfunktionen ================= */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const alts = s => s.split('/').map(x => x.trim()).filter(Boolean);
const show = s => alts(s).join(' / ');
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const $ = sel => document.querySelector(sel);

/* ================= Daten aufbereiten ================= */
const WORDS = [];
const WORD = {};
LESSONS.forEach((l, i) => {
  l.no = i + 1;
  l.words.forEach(([en, de, ex, exDe]) => {
    const w = { id: `${l.id}:${en}`, en, de, ex: ex || '', exDe: exDe || '', lesson: l.id };
    WORDS.push(w); WORD[w.id] = w;
  });
});
const LESSON = Object.fromEntries(LESSONS.map(l => [l.id, l]));
// Beispielsatz zerlegen: "My {mother} is ..." → ["My ", "mother", " is ..."]
function exParts(ex) { const m = ex.match(/^(.*?)\{([^}]+)\}(.*)$/); return m ? [m[1], m[2], m[3]] : [ex, '', '']; }
const exPlain = ex => { const [a, g, b] = exParts(ex); return a + (g ? alts(g)[0] : '') + b; };

/* ================= Speicher ================= */
function defaults() {
  return { words: {}, days: {}, settings: { newPerSession: 10, rate: 0.9, voice: '', autoSpeak: true }, created: Date.now() };
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw); const def = defaults();
      return { ...def, ...d, settings: { ...def.settings, ...(d.settings || {}) } };
    }
  } catch (e) { /* ignorieren */ }
  return defaults();
}
let S = load();
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* voll/gesperrt */ } }

/* ================= Zeit ================= */
const pad = n => String(n).padStart(2, '0');
function dayKey(t = Date.now()) { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addDays(t, n) { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); }
function today() { const k = dayKey(); return S.days[k] || (S.days[k] = { sec: 0, answers: 0, correct: 0 }); }
function fmtDur(sec) {
  if (sec <= 0) return '0 Min';
  if (sec < 60) return '< 1 Min';
  const m = Math.round(sec / 60); const h = Math.floor(m / 60);
  return h ? `${h} Std ${m % 60} Min` : `${m} Min`;
}
const clock = sec => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
function relDay(t) {
  const diff = Math.round((startOfDay(t) - startOfDay(Date.now())) / 864e5);
  if (diff <= 0) return 'heute';
  if (diff === 1) return 'morgen';
  if (diff < 7) return `in ${diff} Tagen`;
  return 'am ' + new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
}

/* ================= Lernstand je Vokabel ================= */
function status(id) { const p = S.words[id]; if (!p || !p.lvl) return 'neu'; return p.lvl >= SAFE_LVL ? 'sicher' : 'lernen'; }
function isDue(id, now = Date.now()) { const p = S.words[id]; return !!(p && p.lvl > 0 && p.due <= now); }
function counts(words) {
  const c = { neu: 0, lernen: 0, sicher: 0, due: 0, total: words.length }; const now = Date.now();
  words.forEach(w => { c[status(w.id)]++; if (isDue(w.id, now)) c.due++; });
  return c;
}
function applyResult(id, ok) {
  const now = Date.now();
  const p = S.words[id] || { lvl: 0, due: 0, right: 0, wrong: 0 };
  if (ok) { p.lvl = p.lvl ? Math.min(MAX_LVL, p.lvl + 1) : 1; p.right++; }
  else { p.lvl = 1; p.wrong++; }
  p.due = startOfDay(addDays(now, INTERVALS[p.lvl]));
  p.last = now;
  S.words[id] = p;
}
function nextDueText() {
  let min = Infinity;
  for (const id in S.words) { const p = S.words[id]; if (p.lvl > 0 && p.due < min) min = p.due; }
  return min === Infinity ? '' : `Nächste Wiederholung: ${relDay(min)}.`;
}

/* ================= Sprachausgabe ================= */
let voices = [];
function loadVoices() {
  if (!canSpeak) return;
  voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
  if (location.hash === '#/settings') viewSettings();
}
if (canSpeak) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function speak(text) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(alts(text)[0]);
  const v = voices.find(x => x.name === S.settings.voice) || voices.find(x => /en[-_]GB/i.test(x.lang)) || voices[0];
  u.lang = v ? v.lang : 'en-GB'; if (v) u.voice = v;
  u.rate = S.settings.rate;
  speechSynthesis.speak(u);
}
const autoSay = text => { if (S.settings.autoSpeak) setTimeout(() => speak(text), 150); };
const sayBtn = (text, size = '') => canSpeak ? `<button class="say ${size}" data-say="${esc(alts(text)[0])}" aria-label="Vorlesen" title="Vorlesen">${ICON.speaker}</button>` : '';

/* ================= Spracherkennung ================= */
let recog = null;
function recognize() {
  return new Promise((resolve, reject) => {
    try {
      if (canSpeak) speechSynthesis.cancel();
      const r = new SR(); recog = r;
      r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 5; r.continuous = false;
      let got = null;
      r.onresult = e => { got = Array.from(e.results[0]).map(a => a.transcript); };
      r.onerror = e => reject(e.error || 'error');
      r.onend = () => { recog = null; resolve(got || []); };
      r.start();
    } catch (err) { reject(err && err.message ? err.message : 'error'); }
  });
}
function stopRecog() { if (recog) { try { recog.abort(); } catch (e) { /* egal */ } recog = null; } }

/* ================= Antwortprüfung ================= */
const CONTRACTIONS = { "i'm": 'i am', "you're": 'you are', "it's": 'it is', "he's": 'he is', "she's": 'she is', "we're": 'we are', "they're": 'they are', "don't": 'do not', "doesn't": 'does not', "can't": 'cannot', "won't": 'will not', "let's": 'let us', "what's": 'what is', "that's": 'that is', "i'd": 'i would', "i'll": 'i will', "isn't": 'is not' };
function norm(s) { return s.toLowerCase().replace(/[’‘`´]/g, "'").replace(/[.,!?;:"„“()]/g, ' ').replace(/\s+/g, ' ').trim(); }
const expand = s => s.split(' ').map(w => CONTRACTIONS[w] || w).join(' ');
const core = s => s.replace(/^(to|the|a|an) /, '');
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const tolerance = len => len >= 8 ? 2 : len >= 4 ? 1 : 0;
// Geschriebene Antwort: 'exact' | 'typo' | false
function checkTyped(input, target) {
  const a = core(expand(norm(input))); let typo = false;
  for (const t of alts(target)) {
    const b = core(expand(norm(t)));
    if (a === b) return 'exact';
    if (lev(a, b) <= tolerance(b.length)) typo = true;
  }
  return typo ? 'typo' : false;
}
// Gesprochene Antwort (mehrere Erkennungs-Varianten)
function matchSpoken(transcripts, target) {
  const targets = alts(target).map(t => core(expand(norm(t))));
  for (const tr of transcripts) {
    const n = expand(norm(tr)); const c = core(n);
    for (const t of targets) {
      if (c === t || (' ' + n + ' ').includes(' ' + t + ' ')) return true;
      if (lev(c, t) <= tolerance(t.length)) return true;
    }
  }
  return false;
}
// Anteil der Satzwörter, die erkannt/geschrieben wurden (0…1)
function sentenceScore(heard, target) {
  const tw = expand(norm(target)).split(' ');
  const pool = expand(norm(heard)).split(' ');
  let hit = 0;
  for (const w of tw) {
    const k = pool.findIndex(h => h === w || (w.length >= 5 && lev(h, w) <= 1));
    if (k >= 0) { hit++; pool.splice(k, 1); }
  }
  return hit / tw.length;
}

/* ================= Lerndurchgang ================= */
/*
 * Ablauf:
 *  1. Neue Vokabeln als Paare (Tippen auf Englisch = vorlesen)   – nur beim Neulernen
 *  2. Paare finden (richtiges Paar verschwindet)
 *  3. Lernkarten: deutsches Wort → auf Englisch sagen; Fehler werden danach erneut geübt
 *  4. Alle Paare noch einmal im Überblick
 *  5. Lückentext
 *  6. Sätze sprechen
 */
const PHASE_TITLE = {
  intro: 'Neue Vokabeln', match: 'Paare finden', speak: 'Vokabeln sprechen',
  review: 'Alle Paare im Überblick', gap: 'Lückentext', sentences: 'Sätze sprechen',
};
let session = null;

function sessionWords(opts) {
  const pool = opts.lessonId ? WORDS.filter(w => w.lesson === opts.lessonId) : WORDS;
  const n = S.settings.newPerSession; const now = Date.now();
  if (opts.mode === 'learn') return pool.filter(w => status(w.id) === 'neu').slice(0, n);
  if (opts.mode === 'review') return pool.filter(w => isDue(w.id, now)).sort((a, b) => S.words[a.id].due - S.words[b.id].due).slice(0, n);
  return shuffle(pool.filter(w => S.words[w.id] && S.words[w.id].lvl > 0)).sort((a, b) => S.words[a.id].lvl - S.words[b.id].lvl).slice(0, n);
}

function startSession(opts) {
  const words = sessionWords(opts);
  if (!words.length) { toast('Gerade gibt es hier nichts zu üben.'); return; }
  const phases = ['match', 'speak', 'review', 'gap', 'sentences'];
  if (opts.mode === 'learn') phases.unshift('intro');
  session = {
    opts, words, phases, ph: 0, sec: 0, answers: 0, firstTry: 0, firstOk: 0,
    speakWrong: new Set(), gapWrong: new Set(), gapSeen: new Set(),
    newWords: [], reviewed: [], hard: [], sentOk: 0, sentTotal: 0,
    typeMode: !SR, done: false, answered: false,
  };
  enterPhase();
  location.hash = '#/session';
}

function enterPhase() {
  const s = session; const p = s.phases[s.ph];
  s.idx = 0; s.queue = [];
  if (p === 'match') s.matchedCount = 0;
  if (p === 'speak') { s.queue = shuffle(s.words); s.round = 1; s.roundWrong = []; }
  if (p === 'gap') s.queue = shuffle(s.words.filter(w => w.ex));
  if (p === 'sentences') {
    const lessonIds = [...new Set(s.words.map(w => w.lesson))];
    const ls = shuffle(lessonIds.flatMap(id => LESSON[id].sentences || [])).slice(0, 2);
    const exs = shuffle(s.words.filter(w => w.ex)).slice(0, 4 - ls.length).map(w => ({ en: exPlain(w.ex), de: w.exDe }));
    s.queue = shuffle([...ls, ...exs]);
    s.tries = 0;
  }
}

function nextPhase() {
  const s = session; if (!s) return;
  stopRecog();
  if (s.phases[s.ph] === 'gap') finalizeWords();
  s.ph++;
  if (s.ph >= s.phases.length) { s.done = true; save(); renderSession(); return; }
  enterPhase(); renderSession(); window.scrollTo(0, 0);
}

// Lernstand der Vokabeln nach dem Lückentext festschreiben
function finalizeWords() {
  const s = session; if (s.finalized) return; s.finalized = true;
  s.words.forEach(w => {
    const bad = s.speakWrong.has(w.id) || s.gapWrong.has(w.id);
    const wasNew = status(w.id) === 'neu';
    if (s.opts.mode === 'practice') { if (bad) applyResult(w.id, false); }
    else applyResult(w.id, !bad);
    (wasNew ? s.newWords : s.reviewed).push(w);
    if (bad) s.hard.push(w);
  });
  save();
}

function count(ok, first) {
  const s = session; s.answers++;
  const d = today(); d.answers++; if (ok) d.correct++;
  if (first) { s.firstTry++; if (ok) s.firstOk++; }
  save();
}

function phaseFrac() {
  const s = session; const p = s.phases[s.ph];
  if (p === 'match') return s.matchedCount / s.words.length;
  if (s.queue && s.queue.length) return s.idx / s.queue.length;
  return 0;
}
function updateProgress() {
  const el = $('.progress > div'); if (!el || !session) return;
  el.style.width = ((session.ph + phaseFrac()) / session.phases.length * 100) + '%';
}

function footer(html, cls = '', onNext) {
  const f = document.getElementById('fb'); if (!f) return;
  f.className = 'footer ' + cls; f.innerHTML = html;
  const n = f.querySelector('#next');
  if (n) { if (onNext) n.onclick = onNext; n.focus({ preventScroll: true }); }
}

const pairHtml = w => `<b>${esc(show(w.en))}</b> = ${esc(show(w.de))}`;

// Einheitliche Rückmeldung: grün bei richtig, rot bei falsch
function feedback(ok, title, lines, extraBtns, onNext) {
  footer(`<div class="fb-head">
      <span class="fb-icon">${ok ? ICON.check : ICON.cross}</span>
      <div class="fb-msg"><strong>${title}</strong>${lines.filter(Boolean).map(l => `<span>${l}</span>`).join('')}</div>
    </div>
    <div class="fb-btns">${extraBtns || ''}<button class="btn next ${ok ? 'ok' : 'bad'}" id="next">Weiter ${ICON.arrow}</button></div>`,
    'fb ' + (ok ? 'ok' : 'bad'), onNext);
}

/* ---------- Wortbausteine: ziehen oder antippen ---------- */
const inside = (el, ev) => {
  const r = el.getBoundingClientRect(); const pad = 18;
  return ev.clientX >= r.left - pad && ev.clientX <= r.right + pad && ev.clientY >= r.top - pad && ev.clientY <= r.bottom + pad;
};
function chipBoard(zone, bank, chips, o = {}) {
  const placed = []; let locked = false;
  function draw() {
    zone.innerHTML = placed.length
      ? placed.map((k, pos) => `<button class="chip in" data-pos="${pos}" aria-label="${esc(chips[k])} entfernen">${esc(chips[k])}</button>`).join('')
      : `<span class="zone-ph">${esc(o.placeholder || '')}</span>`;
    bank.innerHTML = chips.map((c, k) => placed.includes(k)
      ? `<button class="chip used" disabled tabindex="-1" aria-hidden="true">${esc(c)}</button>`
      : `<button class="chip" data-k="${k}">${esc(c)}</button>`).join('');
    if (o.onChange) o.onChange(placed.map(k => chips[k]));
  }
  function place(k) {
    if (locked || placed.includes(k)) return;
    if (o.multi) placed.push(k); else placed.splice(0, placed.length, k);
    draw();
  }
  zone.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b || locked) return;
    placed.splice(+b.dataset.pos, 1); draw();
  });
  bank.addEventListener('pointerdown', e => {
    const b = e.target.closest('.chip'); if (!b || b.disabled || locked || b.dataset.k === undefined) return;
    e.preventDefault();
    const k = +b.dataset.k; const sx = e.clientX, sy = e.clientY; let ghost = null;
    const move = ev => {
      if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
        ghost = b.cloneNode(true); ghost.classList.add('ghost'); document.body.appendChild(ghost);
        b.classList.add('dragging');
      }
      if (ghost) {
        ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
        zone.classList.toggle('over', inside(zone, ev));
      }
    };
    const up = ev => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      if (ghost) {
        ghost.remove(); b.classList.remove('dragging'); zone.classList.remove('over');
        if (ev.type === 'pointerup' && inside(zone, ev)) place(k);
      } else if (ev.type === 'pointerup') place(k);   // einfach angetippt
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
  bank.addEventListener('keydown', e => {
    const b = e.target.closest('.chip');
    if (b && b.dataset.k !== undefined && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); place(+b.dataset.k); }
  });
  draw();
  return {
    value: () => placed.map(k => chips[k]),
    lock: () => { locked = true; zone.classList.add('locked'); bank.querySelectorAll('.chip').forEach(c => { c.disabled = true; }); },
  };
}

/* ---------- Eingabe: Mikrofon oder Wortbausteine ---------- */
function answerInput(area, opts) {
  // opts: { chips, multi, placeholder, onAnswer(list, chosen:boolean), footerExtra }
  const s = session;
  if (s.typeMode) {
    area.innerHTML = `<div class="zone${opts.multi ? ' multi' : ''}" id="zone"></div>
      <div class="bank" id="bank"></div>
      ${SR ? '<button class="linkbtn" id="toSpeak">Lieber sprechen</button>' : '<p class="muted small center">Spracherkennung wird von diesem Browser nicht unterstützt.</p>'}`;
    opts.footerExtra('<button class="btn primary" id="check" disabled>Prüfen</button>');
    const board = chipBoard($('#zone'), $('#bank'), opts.chips, {
      multi: opts.multi, placeholder: opts.placeholder,
      onChange: v => { const c = $('#check'); if (c) c.disabled = opts.multi ? v.length !== opts.chips.length : !v.length; },
    });
    $('#check').onclick = () => {
      const v = board.value(); if (!v.length || s.answered) return;
      board.lock(); opts.onAnswer([v.join(' ')], true);
    };
    const ts = $('#toSpeak'); if (ts) ts.onclick = () => { s.typeMode = false; renderSession(); };
  } else {
    area.innerHTML = `<div class="mic-wrap">
        <button class="mic" id="mic" aria-label="Mikrofon: jetzt sprechen">${ICON.mic}</button>
        <p class="mic-status muted" id="micStatus" aria-live="polite">Tippe aufs Mikrofon und sprich.</p>
        <button class="linkbtn" id="toType">Ich kann gerade nicht sprechen – Antwort auswählen</button>
      </div>`;
    opts.footerExtra('');
    const status = $('#micStatus'); const btn = $('#mic');
    btn.onclick = async () => {
      if (s.answered || btn.classList.contains('on')) return;
      btn.classList.add('on'); status.textContent = 'Ich höre zu …';
      try {
        const res = await recognize();
        btn.classList.remove('on');
        if (!session || session !== s) return;
        if (!res.length) { status.textContent = 'Ich habe nichts verstanden. Tippe noch einmal aufs Mikrofon.'; return; }
        opts.onAnswer(res, false);
      } catch (err) {
        btn.classList.remove('on');
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          toast('Kein Zugriff aufs Mikrofon – du kannst die Antwort auswählen.');
          s.typeMode = true; renderSession();
        } else if (err === 'no-speech') status.textContent = 'Ich habe nichts gehört. Tippe noch einmal aufs Mikrofon.';
        else if (err === 'network') status.textContent = 'Die Spracherkennung braucht eine Internetverbindung.';
        else if (err === 'aborted') status.textContent = 'Tippe aufs Mikrofon und sprich.';
        else status.textContent = 'Spracherkennung nicht möglich (' + err + '). Du kannst die Antwort auch auswählen.';
      }
    };
    $('#toType').onclick = () => { stopRecog(); s.typeMode = true; renderSession(); };
  }
}

/* ---------- Schritte ---------- */
const PH = {
  intro(el) { pairList(el, 'Lies die neuen Vokabeln. Tippe auf ein englisches Wort, um es zu hören.', 'Los geht’s'); },
  review(el) { pairList(el, 'Alle Vokabeln noch einmal im Überblick. Tippe zum Anhören.', 'Weiter zum Lückentext'); },

  match(el) {
    const s = session;
    const left = shuffle(s.words), right = shuffle(s.words);
    el.innerHTML = `<p class="ex-label">Tippe die zusammengehörenden Paare an.</p>
      <div class="match">
        <div class="mcol">${left.map(w => `<button class="mcard" data-id="${esc(w.id)}" data-side="en">${esc(show(w.en))}</button>`).join('')}</div>
        <div class="mcol">${right.map(w => `<button class="mcard" data-id="${esc(w.id)}" data-side="de">${esc(show(w.de))}</button>`).join('')}</div>
      </div>`;
    footer('');
    let sel = null;
    el.onclick = e => {
      const b = e.target.closest('.mcard'); if (!b || b.disabled) return;
      if (b.dataset.side === 'en') speak(WORD[b.dataset.id].en);
      if (!sel || sel.dataset.side === b.dataset.side) {
        if (sel) sel.classList.remove('sel');
        sel = sel === b ? null : b;
        if (sel) sel.classList.add('sel');
        return;
      }
      const a = sel; sel = null; a.classList.remove('sel');
      const wa = WORD[a.dataset.id], wb = WORD[b.dataset.id];
      const ok = wa === wb || show(wa.de) === show(wb.de) || show(wa.en) === show(wb.en);
      if (ok) {
        [a, b].forEach(x => { x.classList.add('ok'); x.disabled = true; });
        s.matchedCount++; updateProgress();
        setTimeout(() => [a, b].forEach(x => x.classList.add('gone')), 400);
        if (s.matchedCount === s.words.length) setTimeout(nextPhase, 900);
      } else {
        [a, b].forEach(x => x.classList.add('bad'));
        setTimeout(() => [a, b].forEach(x => x.classList.remove('bad')), 600);
      }
    };
  },

  speak(el) {
    const s = session; const w = s.queue[s.idx]; s.answered = false;
    el.innerHTML = `<p class="ex-label">${s.round > 1 ? 'Wiederholung: ' : ''}Sag es auf Englisch</p>
      <div class="flashcard" id="card">
        <div class="fc-de">${esc(show(w.de))}</div>
        <div class="fc-en" id="fcEn" hidden></div>
      </div>
      <div id="area"></div>
      <p class="muted small center">Karte ${s.idx + 1} von ${s.queue.length}${s.round > 1 ? ' · diese Vokabeln haben noch nicht geklappt' : ''}</p>`;
    let extra = '';
    const setFooter = x => { extra = x; footer(`<button class="btn ghost" id="skip">Weiß ich nicht</button>${extra}`); $('#skip').onclick = () => judge([], false, true); };
    const judge = (answers, typed, skipped) => {
      if (s.answered) return; s.answered = true; stopRecog();
      const ok = !skipped && (typed ? alts(w.en).some(a => norm(a) === norm(answers[0])) : matchSpoken(answers, w.en));
      const first = s.round === 1;
      count(ok, first);
      $('#area').hidden = true;
      const card = $('#card'); const en = $('#fcEn');
      en.innerHTML = esc(show(w.en)); en.hidden = false;
      card.classList.add(ok ? 'ok' : 'bad');
      speak(w.en);
      if (!ok) { s.roundWrong.push(w); if (first) s.speakWrong.add(w.id); }
      const heard = !skipped && answers[0] ? `<small>${typed ? 'Deine Wahl' : 'Verstanden'}: „${esc(answers[0])}“</small>` : '';
      feedback(ok, ok ? 'Richtig!' : 'Leider falsch', [pairHtml(w), ok ? '' : heard, ok ? '' : '<small>Diese Vokabel kommt gleich noch einmal.</small>'],
        !ok && !skipped && !typed ? '<button class="btn ghost" id="override">Das war richtig</button>' : '', advanceSpeak);
      const ov = $('#override');
      if (ov) ov.onclick = () => {
        s.roundWrong.pop(); if (first) s.speakWrong.delete(w.id);
        const d = today(); d.correct++; if (first) s.firstOk++; save();
        advanceSpeak();
      };
    };
    setFooter('');
    const pool = [...shuffle(s.words), ...shuffle(WORDS.filter(x => x.lesson === w.lesson))].filter(x => x.id !== w.id).map(x => alts(x.en)[0]);
    const chips = shuffle([alts(w.en)[0], ...[...new Set(pool)].slice(0, 5)]);
    answerInput($('#area'), { chips, placeholder: 'Wort hierher ziehen oder antippen', onAnswer: judge, footerExtra: setFooter });
  },

  gap(el) {
    const s = session; const w = s.queue[s.idx]; s.answered = false;
    const [pre, g, post] = exParts(w.ex);
    // Steht die Lücke am Satzanfang, beginnen alle Auswahlwörter groß – sonst würde die Großschreibung die Lösung verraten
    const atStart = pre.trim() === '';
    const fix = t => atStart ? t[0].toUpperCase() + t.slice(1) : t;
    const target = fix(alts(g)[0]);
    const others = [...shuffle(s.words), ...shuffle(WORDS.filter(x => x.lesson === w.lesson))]
      .filter(x => x.id !== w.id && x.ex)
      .map(x => {
        const [p2, g2] = exParts(x.ex); let t = alts(g2)[0];
        if (p2.trim() === '' && !/^(I|Monday|Friday|Sunday)\b/.test(t)) t = t[0].toLowerCase() + t.slice(1);
        return fix(t);
      });
    const distract = [...new Set(others)].filter(t => !alts(g).some(a => norm(a) === norm(t))).slice(0, 5);
    const chips = shuffle([target, ...distract]);
    el.innerHTML = `<p class="ex-label">Zieh das passende Wort in die Lücke – oder tippe es an</p>
      <p class="gap-sentence">${esc(pre)}<span class="zone gap-slot" id="zone"></span>${esc(post)}</p>
      <p class="muted center">${esc(w.exDe)}</p>
      <div class="bank" id="bank"></div>
      <p class="muted small center">${s.idx + 1} von ${s.queue.length}</p>`;
    footer('<button class="btn primary" id="check" disabled>Prüfen</button>');
    const board = chipBoard($('#zone'), $('#bank'), chips, { onChange: v => { const c = $('#check'); if (c) c.disabled = !v.length; } });
    $('#check').onclick = () => {
      const v = board.value()[0];
      if (s.answered || !v) return;
      s.answered = true; board.lock();
      const ok = alts(g).some(a => norm(a) === norm(v));
      const first = !s.gapSeen.has(w.id); s.gapSeen.add(w.id);
      count(ok, first);
      $('#zone').classList.add(ok ? 'ok' : 'bad');
      if (!ok) { s.gapWrong.add(w.id); s.queue.push(w); }
      autoSay(exPlain(w.ex));
      const full = `${esc(pre)}<b>${esc(target)}</b>${esc(post)}`;
      feedback(ok, ok ? 'Richtig!' : 'Leider falsch', [ok ? full : `Richtig ist: ${full}`, ok ? '' : '<small>Dieser Satz kommt am Ende noch einmal.</small>'], '',
        () => { s.idx++; if (s.idx >= s.queue.length) nextPhase(); else renderSession(); });
    };
  },

  sentences(el) {
    const s = session;
    if (!s.queue.length) { nextPhase(); return; }
    const sen = s.queue[s.idx]; s.answered = false;
    const typing = s.typeMode;
    el.innerHTML = `<p class="ex-label">${typing ? 'Bilde den Satz auf Englisch' : 'Sprich den Satz laut nach'}</p>
      <div class="sentence-card">
        ${typing ? '' : `<div class="sen-en">${esc(sen.en)} ${sayBtn(sen.en)}</div>`}
        <div class="${typing ? 'sen-en' : 'muted'}">${esc(sen.de)}</div>
      </div>
      <div id="area"></div>
      <p class="muted small center">Satz ${s.idx + 1} von ${s.queue.length}</p>`;
    const go = () => { s.idx++; s.tries = 0; if (s.idx >= s.queue.length) nextPhase(); else renderSession(); };
    const setFooter = x => {
      footer(`<button class="btn ghost" id="skip">Überspringen</button>${x}`);
      $('#skip').onclick = () => { stopRecog(); go(); };
    };
    const judge = (answers, typed) => {
      if (s.answered) return; s.answered = true; stopRecog();
      $('#area').hidden = true;
      // Gesprochen: mind. 80 % der Wörter erkannt. Gebaut: Reihenfolge muss stimmen.
      const score = typed ? (norm(answers[0]) === norm(sen.en) ? 1 : 0) : Math.max(...answers.map(a => sentenceScore(a, sen.en)));
      const ok = typed ? score === 1 : score >= SENTENCE_PASS;
      const first = s.tries === 0; s.tries++;
      count(ok, first);
      if (first) { s.sentTotal++; if (ok) s.sentOk++; }
      autoSay(sen.en);
      const heard = typed ? `<small>Deine Lösung: „${esc(answers[0])}“</small>`
        : `<small>Verstanden: „${esc(answers[0])}“ · ${Math.round(score * 100)} % der Wörter</small>`;
      feedback(ok, ok ? (typed ? 'Richtig!' : 'Gut gesprochen!') : 'Noch nicht ganz', [ok ? esc(sen.en) : `Richtig ist: <b>${esc(sen.en)}</b>`, ok ? '' : heard],
        ok ? '' : '<button class="btn ghost" id="again">Nochmal</button>', go);
      const ag = $('#again'); if (ag) ag.onclick = () => renderSession();
    };
    setFooter('');
    const chips = shuffle(sen.en.split(' ').map(t => t.replace(/[.,!?]+$/, '')));
    answerInput($('#area'), { chips, multi: true, placeholder: 'Wörter in der richtigen Reihenfolge antippen oder hierher ziehen', onAnswer: judge, footerExtra: setFooter });
    if (!typing) autoSay(sen.en);
  },
};

function advanceSpeak() {
  const s = session; s.idx++;
  if (s.idx < s.queue.length) { renderSession(); return; }
  if (s.roundWrong.length) {
    s.queue = shuffle(s.roundWrong); s.roundWrong = []; s.idx = 0; s.round++;
    toast(`Jetzt noch einmal die ${s.queue.length === 1 ? 'Vokabel, die' : s.queue.length + ' Vokabeln, die'} nicht geklappt ${s.queue.length === 1 ? 'hat' : 'haben'}.`);
    renderSession();
  } else nextPhase();
}

function pairList(el, text, nextLabel) {
  const s = session;
  el.innerHTML = `<p class="ex-label">${text}</p>
    <div class="pairs">${s.words.map(w => `<div class="pair">
      <button class="pair-en" data-say="${esc(alts(w.en)[0])}">${canSpeak ? ICON.speakerSm : ''}<span>${esc(show(w.en))}</span></button>
      <span class="pair-de">${esc(show(w.de))}</span></div>`).join('')}</div>`;
  footer(`<div class="fb-btns"><button class="btn next primary" id="next">${nextLabel} ${ICON.arrow}</button></div>`, 'fb plain', nextPhase);
}

function renderSession() {
  const s = session;
  if (!s) { location.hash = '#/'; return; }
  if (s.done) return renderSummary();
  const p = s.phases[s.ph];
  $app.innerHTML = `
    <div class="session">
      <div class="session-top">
        <button class="icon-btn" id="quit" aria-label="Durchgang beenden" title="Beenden">${ICON.close}</button>
        <div class="progress" role="progressbar" aria-label="Fortschritt"><div></div></div>
        <span class="timer" id="timer" title="Lernzeit in diesem Durchgang">${clock(s.sec)}</span>
      </div>
      <p class="phase">Schritt ${s.ph + 1} von ${s.phases.length} · ${PHASE_TITLE[p]}</p>
      <div class="ex" id="ex"></div>
    </div>
    <div class="footer" id="fb"></div>`;
  PH[p](document.getElementById('ex'));
  updateProgress();
}

function renderSummary() {
  const s = session;
  const pct = s.firstTry ? Math.round(s.firstOk / s.firstTry * 100) : 100;
  const list = ws => `<ul class="words">${ws.map(w => `<li>${sayBtn(w.en)}<div class="w"><b>${esc(show(w.en))}</b><span class="muted">${esc(show(w.de))}</span></div>${levelDots(w.id)}</li>`).join('')}</ul>`;
  $app.innerHTML = `
    <header class="page-head"><h1>Durchgang abgeschlossen</h1><p class="muted">${nextDueText()}</p></header>
    <section class="card"><div class="kpis">
      <div><span class="num">${clock(s.sec)}</span><span class="lbl">Lernzeit</span></div>
      <div><span class="num">${s.answers}</span><span class="lbl">Antworten</span></div>
      <div><span class="num">${pct} %</span><span class="lbl">auf Anhieb richtig</span></div>
    </div>
    ${s.sentTotal ? `<p class="muted small">Sätze gesprochen: ${s.sentOk} von ${s.sentTotal} beim ersten Versuch gut verstanden.</p>` : ''}</section>
    ${s.newWords.length ? `<section class="card"><h2>Neu gelernt (${s.newWords.length})</h2>${list(s.newWords)}</section>` : ''}
    ${s.reviewed.length ? `<section class="card"><h2>Wiederholt (${s.reviewed.length})</h2><p class="muted small">${s.reviewed.filter(w => !s.hard.includes(w)).length} ohne Fehler – der Abstand bis zur nächsten Wiederholung wird größer.</p></section>` : ''}
    ${s.hard.length ? `<section class="card"><h2>Schwierig – kommt morgen wieder</h2>${list(s.hard)}</section>` : ''}
    <div class="actions">
      ${s.opts.lessonId ? `<a class="btn wide" href="#/lesson/${s.opts.lessonId}">Zur Lektion</a>` : ''}
      <a class="btn primary wide" href="#/">Zur Übersicht</a>
    </div>`;
}

/* ================= Ansichten ================= */
function stackBar(c) {
  const t = c.total || 1;
  return `<div class="stack" role="img" aria-label="${c.sicher} sicher, ${c.lernen} in Arbeit, ${c.neu} neu">
    <div class="s-safe" style="width:${c.sicher / t * 100}%"></div><div class="s-learn" style="width:${c.lernen / t * 100}%"></div></div>`;
}
const legend = c => `<div class="legend"><span><i class="dot safe"></i>${c.sicher} sicher</span><span><i class="dot learn"></i>${c.lernen} in Arbeit</span><span><i class="dot new"></i>${c.neu} neu</span></div>`;

function viewHome() {
  const c = counts(WORDS); const d = today();
  const dateTxt = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  $app.innerHTML = `
    <header class="page-head"><h1>Englisch lernen</h1><p class="muted">${dateTxt}</p></header>
    <section class="card">
      <div class="kpis">
        <div><span class="num">${fmtDur(d.sec)}</span><span class="lbl">heute gelernt</span></div>
        <div><span class="num">${c.lernen + c.sicher}</span><span class="lbl">Vokabeln gelernt</span></div>
        <div><span class="num">${c.due}</span><span class="lbl">fällig</span></div>
      </div>
      ${c.due
        ? `<button class="btn primary wide" data-start="review">Wiederholen (${Math.min(c.due, S.settings.newPerSession)} Vokabeln)</button>`
        : `<p class="muted center small">${c.lernen + c.sicher ? 'Keine Wiederholungen fällig. ' + nextDueText() : 'Starte mit der ersten Lektion.'}</p>`}
    </section>
    <section class="card">
      <h2>Dein Wortschatz</h2>
      ${stackBar(c)}${legend(c)}
    </section>
    <h2 class="section-title">Lektionen</h2>
    <div class="lessons">${LESSONS.map(lessonCard).join('')}</div>`;
}

function lessonCard(l) {
  const c = counts(WORDS.filter(w => w.lesson === l.id));
  return `<a class="lesson" href="#/lesson/${l.id}">
    <span class="lesson-no">${l.no}</span>
    <div class="lesson-body">
      <div class="lesson-title">${esc(l.title)}${c.due ? `<span class="badge">${c.due} fällig</span>` : ''}</div>
      <div class="muted small">${esc(l.desc)}</div>
      ${stackBar(c)}
      <div class="muted small">${c.sicher + c.lernen} von ${c.total} Vokabeln gelernt</div>
    </div></a>`;
}

function levelDots(id) {
  const p = S.words[id]; const lvl = p ? p.lvl : 0; const st = status(id);
  const title = lvl ? `Stufe ${lvl} von ${MAX_LVL} · nächste Wiederholung ${relDay(p.due)}` : 'noch nicht gelernt';
  return `<span class="dots ${st}" title="${title}" aria-label="${title}">${[1, 2, 3, 4, 5, 6].map(i => `<i class="${lvl >= i ? 'on' : ''}"></i>`).join('')}</span>`;
}

function viewLesson(id) {
  const l = LESSON[id]; if (!l) { location.hash = '#/'; return; }
  const ws = WORDS.filter(w => w.lesson === id); const c = counts(ws); const n = S.settings.newPerSession;
  $app.innerHTML = `
    <a class="back" href="#/">${ICON.back} Übersicht</a>
    <header class="page-head"><p class="muted small">Lektion ${l.no}</p><h1>${esc(l.title)}</h1><p class="muted">${esc(l.desc)}</p></header>
    <section class="card">
      ${stackBar(c)}${legend(c)}
      <div class="actions">
        ${c.neu ? `<button class="btn primary wide" data-start="learn" data-lesson="${id}">Neue Vokabeln lernen <small>(${Math.min(c.neu, n)})</small></button>` : ''}
        ${c.due ? `<button class="btn ${c.neu ? '' : 'primary '}wide" data-start="review" data-lesson="${id}">Wiederholen <small>(${Math.min(c.due, n)} fällig)</small></button>` : ''}
        ${!c.neu && !c.due ? '<p class="muted small center">Alle Vokabeln sind eingeführt und aktuell wiederholt.</p>' : ''}
        ${c.lernen + c.sicher ? `<button class="btn wide" data-start="practice" data-lesson="${id}">Frei üben</button>` : ''}
      </div>
    </section>
    <h2 class="section-title">Vokabeln</h2>
    <ul class="words card">${ws.map(w => `<li>${sayBtn(w.en)}<div class="w"><b>${esc(show(w.en))}</b><span class="muted">${esc(show(w.de))}</span>${w.ex ? `<span class="ex-line">${esc(exPlain(w.ex))}</span>` : ''}</div>${levelDots(w.id)}</li>`).join('')}</ul>
    ${(l.sentences || []).length ? `<h2 class="section-title">Sätze</h2>
    <ul class="words card">${l.sentences.map(s => `<li>${sayBtn(s.en)}<div class="w"><b>${esc(s.en)}</b><span class="muted">${esc(s.de)}</span></div></li>`).join('')}</ul>` : ''}`;
}

function viewStats() {
  const c = counts(WORDS);
  let tot = 0, ans = 0, cor = 0, active = 0;
  for (const k in S.days) { const d = S.days[k]; tot += d.sec; ans += d.answers; cor += d.correct; if (d.sec >= 60 || d.answers > 0) active++; }
  const now = Date.now(); const last = [];
  for (let i = 13; i >= 0; i--) { const t = addDays(now, -i); const k = dayKey(t); last.push({ t, sec: (S.days[k] || {}).sec || 0 }); }
  const week = last.slice(-7).reduce((a, b) => a + b.sec, 0);
  const maxMin = Math.max(10, ...last.map(x => Math.ceil(x.sec / 60)));
  const sod = startOfDay(now); const tmr = addDays(sod, 1), d2 = addDays(sod, 2), d8 = addDays(sod, 8);
  let dTmr = 0, dWeek = 0;
  for (const id in S.words) { const p = S.words[id]; if (!p.lvl) continue; if (p.due >= tmr && p.due < d2) dTmr++; if (p.due >= tmr && p.due < d8) dWeek++; }

  $app.innerHTML = `
    <header class="page-head"><h1>Statistik</h1></header>
    <section class="card"><h2>Lernzeit</h2><div class="kpis">
      <div><span class="num">${fmtDur(today().sec)}</span><span class="lbl">heute</span></div>
      <div><span class="num">${fmtDur(week)}</span><span class="lbl">letzte 7 Tage</span></div>
      <div><span class="num">${fmtDur(tot)}</span><span class="lbl">gesamt</span></div>
    </div>
    <div class="chart" role="img" aria-label="Lernminuten der letzten 14 Tage">
      ${last.map((x, i) => { const m = Math.round(x.sec / 60); const dt = new Date(x.t);
        return `<div class="col${i === 13 ? ' today' : ''}" title="${dt.toLocaleDateString('de-DE')}: ${fmtDur(x.sec)}">
          <span class="val">${m || ''}</span><div class="bar-wrap"><div class="bar-v" style="height:${Math.min(100, x.sec / 60 / maxMin * 100)}%"></div></div>
          <span class="day">${dt.toLocaleDateString('de-DE', { weekday: 'narrow' })}</span></div>`; }).join('')}
    </div><p class="muted small">Minuten pro Tag, letzte 14 Tage · ${active} Lerntage insgesamt</p></section>

    <section class="card"><h2>Vokabeln</h2><div class="kpis">
      <div><span class="num">${c.sicher}</span><span class="lbl">sicher</span></div>
      <div><span class="num">${c.lernen}</span><span class="lbl">in Arbeit</span></div>
      <div><span class="num">${c.neu}</span><span class="lbl">noch neu</span></div>
    </div>${stackBar(c)}
    <p class="muted small">„Sicher“ = mindestens ${SAFE_LVL}-mal hintereinander zum richtigen Zeitpunkt gewusst. Trefferquote aller Antworten: ${ans ? Math.round(cor / ans * 100) + ' %' : '–'} (${ans} Antworten).</p></section>

    <section class="card"><h2>Anstehende Wiederholungen</h2><div class="kpis">
      <div><span class="num">${c.due}</span><span class="lbl">jetzt fällig</span></div>
      <div><span class="num">${dTmr}</span><span class="lbl">morgen</span></div>
      <div><span class="num">${dWeek}</span><span class="lbl">nächste 7 Tage</span></div>
    </div></section>

    <section class="card"><h2>Lektionen</h2>
      <table class="ltable"><tbody>${LESSONS.map(l => { const lc = counts(WORDS.filter(w => w.lesson === l.id));
        return `<tr><td><a href="#/lesson/${l.id}">${esc(l.title)}</a></td><td class="bar-cell">${stackBar(lc)}</td><td class="num-cell">${lc.sicher + lc.lernen}/${lc.total}</td></tr>`; }).join('')}
      </tbody></table></section>`;
}

function viewSettings() {
  const st = S.settings;
  $app.innerHTML = `
    <header class="page-head"><h1>Einstellungen</h1></header>
    <section class="card"><h2>Lernen</h2>
      <label class="row"><span>Vokabeln pro Durchgang</span>
        <select data-setting="newPerSession">${[5, 8, 10].map(n => `<option value="${n}"${st.newPerSession === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <p class="muted small">Spracherkennung: ${SR ? 'verfügbar. Beim ersten Sprechen fragt der Browser nach dem Mikrofon.' : 'von diesem Browser nicht unterstützt – Antworten werden geschrieben. Am besten Chrome oder Edge verwenden.'}</p>
    </section>
    <section class="card"><h2>Aussprache</h2>
      ${canSpeak ? `
      <label class="row"><span>Lösungen automatisch vorlesen</span><input type="checkbox" data-setting="autoSpeak"${st.autoSpeak ? ' checked' : ''}></label>
      <label class="row"><span>Sprechtempo <small class="muted" id="rateVal">${st.rate.toFixed(1)}</small></span>
        <input type="range" min="0.6" max="1.2" step="0.1" value="${st.rate}" data-setting="rate"></label>
      <label class="row"><span>Stimme</span>
        <select data-setting="voice"><option value="">Automatisch (britisch bevorzugt)</option>
        ${voices.map(v => `<option value="${esc(v.name)}"${st.voice === v.name ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select></label>
      <button class="btn wide" data-say="Hello! How are you today?">Stimme testen</button>`
      : '<p class="muted">Dieser Browser unterstützt keine Sprachausgabe.</p>'}
    </section>
    <section class="card"><h2>Daten</h2>
      <p class="muted small">Dein Lernstand wird nur auf diesem Gerät im Browser gespeichert. Mit einer Sicherung kannst du ihn auf ein anderes Gerät übertragen.</p>
      <div class="actions">
        <button class="btn wide" id="export">Sicherung herunterladen</button>
        <label class="btn wide">Sicherung laden<input type="file" id="import" accept="application/json,.json" hidden></label>
        <button class="btn danger-outline wide" id="reset">Lernstand zurücksetzen</button>
      </div>
    </section>
    <section class="card"><h2>So läuft ein Durchgang ab</h2>
      <ol class="muted small steps">
        <li>Neue Vokabeln als Paare ansehen und anhören</li>
        <li>Paare finden – richtige Paare verschwinden</li>
        <li>Lernkarten: deutsches Wort sehen, englisch sagen. Was nicht klappt, kommt danach noch einmal.</li>
        <li>Alle Paare noch einmal im Überblick</li>
        <li>Lückentext</li>
        <li>Sätze laut sprechen</li>
      </ol>
      <p class="muted small">Danach steigt jede fehlerfreie Vokabel eine Stufe und kommt nach ${INTERVALS.slice(1).join(', ')} Tagen wieder. Ein Fehler setzt sie auf Stufe 1 zurück – sie kommt dann am nächsten Tag wieder.</p>
    </section>`;
}

/* ================= Router ================= */
function route() {
  const h = location.hash || '#/';
  const [name, arg] = h.slice(2).split('/');
  const view = name || 'home';
  if (view !== 'session' && session) session = null;
  stopRecog();
  if (canSpeak) speechSynthesis.cancel();
  save();
  document.body.classList.toggle('in-session', view === 'session');
  $nav.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.nav === (view === 'lesson' ? 'home' : view)));
  if (view === 'session') renderSession();
  else if (view === 'lesson') viewLesson(arg);
  else if (view === 'stats') viewStats();
  else if (view === 'settings') viewSettings();
  else viewHome();
  if (view !== 'session') window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

/* ================= Ereignisse ================= */
let toastTimer;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

document.addEventListener('click', e => {
  const say = e.target.closest('[data-say]');
  if (say) { e.preventDefault(); speak(say.dataset.say); return; }
  const st = e.target.closest('[data-start]');
  if (st) { startSession({ mode: st.dataset.start, lessonId: st.dataset.lesson || null }); return; }
  if (e.target.closest('#quit') && session) {
    if (session.answers === 0 || confirm('Durchgang beenden? Der Lernstand der Vokabeln wird erst nach dem Lückentext gespeichert.')) {
      location.hash = session.opts.lessonId ? '#/lesson/' + session.opts.lessonId : '#/';
    }
    return;
  }
  if (e.target.closest('#export')) {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `englisch-lernstand-${dayKey()}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  if (e.target.closest('#reset')) {
    if (confirm('Wirklich den gesamten Lernstand und die Lernzeit löschen? Das lässt sich nicht rückgängig machen.')) {
      S = defaults(); save(); toast('Lernstand zurückgesetzt.'); route();
    }
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'import' && el.files[0]) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || typeof d.words !== 'object' || typeof d.days !== 'object') throw new Error();
        if (!confirm('Lernstand aus der Sicherung übernehmen? Der aktuelle Stand auf diesem Gerät wird ersetzt.')) return;
        const def = defaults();
        S = { ...def, ...d, settings: { ...def.settings, ...(d.settings || {}) } };
        save(); toast('Sicherung geladen.'); route();
      } catch (err) { toast('Die Datei ist keine gültige Sicherung.'); }
    };
    r.readAsText(el.files[0]);
    return;
  }
  const key = el.dataset && el.dataset.setting; if (!key) return;
  if (key === 'autoSpeak') S.settings.autoSpeak = el.checked;
  else if (key === 'newPerSession') S.settings.newPerSession = +el.value;
  else if (key === 'rate') S.settings.rate = +el.value;
  else if (key === 'voice') S.settings.voice = el.value;
  save();
});
document.addEventListener('input', e => {
  if (e.target.dataset && e.target.dataset.setting === 'rate') {
    S.settings.rate = +e.target.value; const v = $('#rateVal'); if (v) v.textContent = S.settings.rate.toFixed(1);
  }
});

document.addEventListener('keydown', e => {
  if (!session || session.done || location.hash !== '#/session') return;
  if (e.key === 'Enter') {
    if (e.target.tagName === 'BUTTON') return; // Button reagiert selbst
    const b = $('#next') || $('#check');
    if (b && !b.disabled) { e.preventDefault(); b.click(); }
  }
});

/* ================= Lernzeit messen ================= */
// Gezählt wird nur, solange ein Durchgang läuft, die Seite sichtbar ist
// und in den letzten 90 Sekunden eine Eingabe stattfand.
let lastAct = Date.now();
['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true }));
setInterval(() => {
  if (!session || session.done) return;
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastAct > IDLE_LIMIT && !recog) return;
  session.sec++; const d = today(); d.sec++;
  if (d.sec % 15 === 0) save();
  const t = $('#timer'); if (t) t.textContent = clock(session.sec);
}, 1000);
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

/* ================= Start ================= */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
route();
