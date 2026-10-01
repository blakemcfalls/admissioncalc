import {
  SCHOOLS, RANKING, CYCLE, DATA_AS_OF, C7_FACTORS, C7_LABELS, RESEARCH_SOURCES, INTEREST_REPORTED,
} from './schools.js';
import {
  MODEL, MAJORS, ACTIVITY_CATEGORIES, ACTIVITY_TIERS, HONOR_LEVELS, REC_LEVELS, INTERVIEW_LEVELS,
  scoreAll, profileSummary, readerBand, describeRating, earlyPlanNotes, satEquivalent,
} from './model.js';
import { checkEssay } from './essay-check.js';

const STORAGE_KEY = 'top20-admit-odds:v1';
const MAX_ACTIVITIES = 10;
const MAX_HONORS = 5;

const ESSAY_DIMS = [
  ['voice', 'Authentic voice', 'Sounds like a specific person, not a résumé in paragraphs'],
  ['specificity', 'Specific detail', 'Concrete scenes, names, places and numbers'],
  ['reflection', 'Insight', 'Shows how you think and what changed in you'],
  ['craft', 'Writing craft', 'Clean, controlled structure and sentences'],
  ['fit', 'School fit ("why us")', 'Names real courses, people and opportunities at each school'],
  ['supplements', 'Supplements', 'Short answers add new information instead of repeating the main essay'],
];
const ESSAY_ANCHORS = { 1: 'Weak', 2: 'Below average', 3: 'Solid', 4: 'Strong', 5: 'Exceptional' };

const act = (name, category, tier, years, hours) => ({ name, category, tier, years, hours });

// A clearly labelled sample so the page opens in a working state.
const EXAMPLE = {
  example: true,
  gpaScale: '4', gpa: 3.96, rankPct: 4, ucGpa: '', rigor: 'most', collegeCourses: 10, apAvg: 4.6,
  trend: 'steady', limitedOfferings: false, beyondCurriculum: false,
  testType: 'sat', testScore: 1530,
  activities: [
    act('Debate team captain, state semifinalist', 'Debate/Speech', 2, 4, 8),
    act('Founder, free middle-school tutoring program (40 students)', 'Community Service (Volunteer)', 3, 3, 4),
    act('Research assistant, university neuroscience lab', 'Research', 3, 2, 6),
    act('Varsity tennis', 'Athletics: JV/Varsity', 4, 4, 10),
    act('Part-time job at a bakery', 'Work (Paid)', 4, 2, 8),
    act('Hospital volunteer', 'Community Service (Volunteer)', 4, 2, 3),
  ],
  honors: [
    { name: 'National Merit Semifinalist', level: 'national' },
    { name: 'State debate tournament semifinalist', level: 'state' },
    { name: 'AP Scholar with Distinction', level: 'school' },
  ],
  research: 'mentored', program: 'selective', workHours: '6', internship: 'none', venture: 'started', portfolio: 'none',
  essay: { voice: 4, specificity: 4, reflection: 3, craft: 4, fit: 3, supplements: 3 },
  recs: { teacher1: 'outstanding', teacher2: 'excellent', counselor: 'excellent' },
  interview: 'strong', interest: 'some',
  residency: 'us', major: 'socsci', firstGen: false, lowIncome: false, rural: false, hardship: false,
  legacy: [], athlete: [], donor: [], earlyChoice: 'penn',
};

const BLANK = {
  example: false,
  gpaScale: '4', gpa: '', rankPct: '', ucGpa: '', rigor: 'very', collegeCourses: '', apAvg: '',
  trend: 'steady', limitedOfferings: false, beyondCurriculum: false,
  testType: 'none', testScore: '',
  activities: [act('', ACTIVITY_CATEGORIES[0], 4, 1, 2)],
  honors: [],
  research: 'none', program: 'none', workHours: '0', internship: 'none', venture: 'none', portfolio: 'none',
  essay: { voice: 3, specificity: 3, reflection: 3, craft: 3, fit: 3, supplements: 3 },
  recs: { teacher1: 'unsure', teacher2: 'unsure', counselor: 'unsure' },
  interview: 'none', interest: 'some',
  residency: 'us', major: 'undecided', firstGen: false, lowIncome: false, rural: false, hardship: false,
  legacy: [], athlete: [], donor: [], earlyChoice: '',
};

const clone = (x) => JSON.parse(JSON.stringify(x));

let state = loadState() ?? clone(EXAMPLE);
let sortMode = 'chance';
const expanded = new Set();

// ------------------------------------------------------------ storage

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { ...clone(BLANK), ...parsed, essay: { ...BLANK.essay, ...parsed.essay }, recs: { ...BLANK.recs, ...parsed.recs } };
  } catch {
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the page still works for this visit */
  }
}

// ------------------------------------------------------------ helpers

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmtPct(p) {
  if (p == null) return '—';
  if (p <= 0) return '0%';
  if (p < 0.01) return '<1%';
  if (p < 0.1) return `${(p * 100).toFixed(1)}%`;
  return `${Math.round(p * 100)}%`;
}

const fmtRate = (r) => (r == null ? '—' : `${(r * 100).toFixed(r < 0.2 ? 1 : 0)}%`);
const fmtInt = (n) => (n == null ? '—' : n.toLocaleString('en-US'));
const fmtMult = (m) => `×${m >= 10 ? m.toFixed(0) : m.toFixed(m < 1 ? 2 : 1)}`;

function readerScale(r) {
  if (r == null) return '';
  if (r >= 9) return '1';
  if (r >= 8) return '2+';
  if (r >= 7) return '2';
  if (r >= 6) return '2−';
  if (r >= 5) return '3+';
  if (r >= 4) return '3';
  if (r >= 3) return '3−';
  if (r >= 2) return '4';
  return '5';
}

const POLICY_LABEL = {
  required: 'Required',
  optional: 'Optional',
  flexible: 'Test-flexible',
  blind: 'Test-blind',
};
const LEGACY_LABEL = {
  strong: 'Considered (significant)',
  moderate: 'Considered',
  light: 'Considered (minor)',
  none: 'Not considered',
};
const INTERVIEW_LABEL = {
  evaluative: 'Offered, evaluative',
  informational: 'Offered, optional',
  none: 'Not offered',
};

function interestLabel(school) {
  return INTEREST_REPORTED.has(school.id) ? C7_LABELS[school.c7.interest] : 'Not reported';
}

function classLabel(cls) {
  return cls ? `Class of ${cls}` : '';
}

// ------------------------------------------------------------ form building

function fillSelect(sel, options, value) {
  sel.innerHTML = options.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  if (value != null) sel.value = value;
}

function buildStaticControls() {
  for (const id of ['teacher1', 'teacher2', 'counselor']) {
    fillSelect($(`#${id}`), Object.entries(REC_LEVELS).map(([k, v]) => [k, v.label]));
  }
  fillSelect($('#interview'), Object.entries(INTERVIEW_LEVELS).map(([k, v]) => [k, v.label]));
  fillSelect($('#major'), MAJORS);

  const early = SCHOOLS.filter((s) => s.early);
  fillSelect($('#earlyChoice'), [['', 'Not applying early'], ...early.map((s) => [s.id, `${s.short} · ${s.early.plan}`])]);

  $('#essay-sliders').innerHTML = ESSAY_DIMS.map(
    ([key, label, help]) => `
      <div class="slider">
        <div class="slider-top">
          <label for="essay-${key}">${esc(label)}</label>
          <span class="slider-val" id="essay-${key}-val"></span>
        </div>
        <input type="range" id="essay-${key}" data-essay="${key}" min="1" max="5" step="1">
        <p class="micro">${esc(help)}</p>
      </div>`,
  ).join('');

  $('#ties-table tbody').innerHTML = [...SCHOOLS]
    .sort((a, b) => a.short.localeCompare(b.short))
    .map((s) => {
      const legacyOff = s.legacy === 'none';
      const cell = (kind, off) =>
        off
          ? `<td><span class="na" title="Not considered by ${esc(s.short)}">n/a</span></td>`
          : `<td><input type="checkbox" id="tie-${kind}-${s.id}" data-tie="${kind}" value="${s.id}" aria-label="${esc(`${s.short}: ${kind}`)}"></td>`;
      return `<tr><td>${esc(s.short)}</td>${cell('legacy', legacyOff)}${cell('athlete', false)}${cell('donor', legacyOff)}</tr>`;
    })
    .join('');
}

function activityRow(a, i) {
  const cats = ACTIVITY_CATEGORIES.map((c) => `<option ${c === a.category ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const tiers = Object.entries(ACTIVITY_TIERS)
    .map(([k, v]) => `<option value="${k}" ${Number(k) === Number(a.tier) ? 'selected' : ''}>${esc(v.label)}</option>`)
    .join('');
  return `
    <div class="row" data-row="activities" data-index="${i}">
      <span class="row-index">${i + 1}</span>
      <div class="row-fields">
        <div class="field wide">
          <label for="act-name-${i}">Activity</label>
          <input type="text" id="act-name-${i}" data-list="activities" data-index="${i}" data-key="name" value="${esc(a.name)}" placeholder="Position and organization" maxlength="150">
        </div>
        <div class="field">
          <label for="act-cat-${i}">Category</label>
          <select id="act-cat-${i}" data-list="activities" data-index="${i}" data-key="category">${cats}</select>
        </div>
        <div class="field wide">
          <label for="act-tier-${i}">Level of impact</label>
          <select id="act-tier-${i}" data-list="activities" data-index="${i}" data-key="tier">${tiers}</select>
        </div>
        <div class="field">
          <label for="act-years-${i}">Years (grades 9–12)</label>
          <input type="number" id="act-years-${i}" data-list="activities" data-index="${i}" data-key="years" min="1" max="4" step="1" value="${esc(a.years)}">
        </div>
        <div class="field">
          <label for="act-hours-${i}">Hours per week</label>
          <input type="number" id="act-hours-${i}" data-list="activities" data-index="${i}" data-key="hours" min="0" max="60" step="1" value="${esc(a.hours)}">
        </div>
      </div>
      <button type="button" class="btn icon" data-remove="activities" data-index="${i}" aria-label="Remove activity ${i + 1}">✕</button>
    </div>`;
}

function honorRow(h, i) {
  const levels = Object.entries(HONOR_LEVELS)
    .map(([k, v]) => `<option value="${k}" ${k === h.level ? 'selected' : ''}>${esc(v.label)}</option>`)
    .join('');
  return `
    <div class="row" data-row="honors" data-index="${i}">
      <span class="row-index">${i + 1}</span>
      <div class="row-fields">
        <div class="field wide">
          <label for="hon-name-${i}">Honor</label>
          <input type="text" id="hon-name-${i}" data-list="honors" data-index="${i}" data-key="name" value="${esc(h.name)}" placeholder="Award name" maxlength="100">
        </div>
        <div class="field">
          <label for="hon-level-${i}">Level</label>
          <select id="hon-level-${i}" data-list="honors" data-index="${i}" data-key="level">${levels}</select>
        </div>
      </div>
      <button type="button" class="btn icon" data-remove="honors" data-index="${i}" aria-label="Remove honor ${i + 1}">✕</button>
    </div>`;
}

function renderLists() {
  $('#activities-list').innerHTML = state.activities.map(activityRow).join('');
  $('#honors-list').innerHTML = state.honors.map(honorRow).join('');
  $('#add-activity').hidden = state.activities.length >= MAX_ACTIVITIES;
  $('#add-honor').hidden = state.honors.length >= MAX_HONORS;
}

const SIMPLE_FIELDS = [
  'gpaScale', 'gpa', 'rankPct', 'ucGpa', 'rigor', 'collegeCourses', 'apAvg', 'trend', 'testType', 'testScore',
  'research', 'program', 'workHours', 'internship', 'venture', 'portfolio', 'interview', 'interest',
  'residency', 'major', 'earlyChoice',
];
const CHECK_FIELDS = ['limitedOfferings', 'beyondCurriculum', 'firstGen', 'lowIncome', 'rural', 'hardship'];

function writeForm() {
  for (const k of SIMPLE_FIELDS) {
    const el = $(`#${k}`);
    if (el) el.value = state[k] ?? '';
  }
  for (const k of CHECK_FIELDS) $(`#${k}`).checked = !!state[k];
  for (const k of ['teacher1', 'teacher2', 'counselor']) $(`#${k}`).value = state.recs[k] ?? 'unsure';
  for (const [k] of ESSAY_DIMS) {
    $(`#essay-${k}`).value = state.essay[k] ?? 3;
  }
  $$('[data-tie]').forEach((el) => {
    el.checked = (state[el.dataset.tie] || []).includes(el.value);
  });
  renderLists();
  syncFormHints();
}

function syncFormHints() {
  for (const [k] of ESSAY_DIMS) {
    const v = Number(state.essay[k] ?? 3);
    $(`#essay-${k}-val`).textContent = `${v} · ${ESSAY_ANCHORS[v]}`;
  }
  const score = $('#testScore');
  const type = state.testType;
  score.disabled = type === 'none';
  score.max = type === 'act' ? 36 : 1600;
  score.step = type === 'act' ? 1 : 10;
  score.placeholder = type === 'act' ? '1–36' : type === 'sat' ? '400–1600' : '';
  const gpa = $('#gpa');
  gpa.max = state.gpaScale === '100' ? 100 : 4;
  gpa.placeholder = state.gpaScale === '100' ? 'e.g. 95.5' : 'e.g. 3.92';
  $('#example-flag').hidden = !state.example;
}

function readForm(e) {
  const t = e?.target;
  if (t?.dataset.list) {
    const list = state[t.dataset.list];
    const item = list[Number(t.dataset.index)];
    if (item) item[t.dataset.key] = t.type === 'number' || t.dataset.key === 'tier' ? numOrBlank(t.value) : t.value;
  } else if (t?.dataset.essay) {
    state.essay[t.dataset.essay] = Number(t.value);
  } else if (t?.dataset.tie) {
    const key = t.dataset.tie;
    const set = new Set(state[key] || []);
    if (t.checked) set.add(t.value);
    else set.delete(t.value);
    state[key] = [...set];
  } else if (t && ['teacher1', 'teacher2', 'counselor'].includes(t.id)) {
    state.recs[t.id] = t.value;
  } else if (t && CHECK_FIELDS.includes(t.id)) {
    state[t.id] = t.checked;
  } else if (t && SIMPLE_FIELDS.includes(t.id)) {
    state[t.id] = t.type === 'number' ? numOrBlank(t.value) : t.value;
    if (t.id === 'testType') {
      state.testScore = '';
      $('#testScore').value = '';
    }
  }
  if (t && t.id !== 'essayText') state.example = false;
  syncFormHints();
  scheduleRender();
}

function numOrBlank(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : '';
}

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    saveState();
    renderResults();
  }, 80);
}

// ------------------------------------------------------------ results

function gaugeSvg(R) {
  const x = (v) => 4 + (v / 10) * 292;
  const ticks = [0, 2.5, 5, 7.5, 10]
    .map((v) => `<line x1="${x(v)}" x2="${x(v)}" y1="14" y2="22" stroke="var(--rule-strong)" stroke-width="1"/>`)
    .join('');
  const you = x(Math.max(0, Math.min(10, R)));
  return `
    <svg viewBox="0 0 300 46" role="img" aria-label="Overall file rating ${R.toFixed(1)} out of 10">
      <rect x="4" y="16" width="292" height="4" rx="2" fill="var(--neutral-soft)"/>
      <rect x="4" y="16" width="${Math.max(0, you - 4)}" height="4" rx="2" fill="var(--ivy)"/>
      ${ticks}
      <text x="${x(5)}" y="36" text-anchor="middle" font-size="8.5" fill="var(--muted)" font-family="var(--font-body)">typical applicant</text>
      <text x="${x(7.5)}" y="36" text-anchor="middle" font-size="8.5" fill="var(--muted)" font-family="var(--font-body)">typical admit</text>
      <text x="${x(0)}" y="10" text-anchor="start" font-size="8" fill="var(--muted)" font-family="var(--font-data)">0</text>
      <text x="${x(10)}" y="10" text-anchor="end" font-size="8" fill="var(--muted)" font-family="var(--font-data)">10</text>
      <circle cx="${you}" cy="18" r="6" fill="var(--sheet)" stroke="var(--ivy)" stroke-width="2.5"/>
    </svg>`;
}

function renderReaderCard(profile) {
  const s = profileSummary(profile);
  const band = readerBand(s.R);
  const rows = s.components
    .map((c) => {
      const off = c.rating == null || (!c.used && c.key !== 'tests');
      const r = c.rating;
      const width = r == null ? 0 : Math.max(0, Math.min(10, r)) * 10;
      const note = c.key === 'tests' && r == null ? 'No score' : c.key === 'interview' && r == null ? 'None' : describeRating(r);
      return `
        <li class="rating ${off ? 'off' : ''}" title="${esc(note)}">
          <span class="label">${esc(c.label)}</span>
          <span class="bar"><span style="width:${width}%"></span><i></i></span>
          <span class="val">${r == null ? '—' : r.toFixed(1)}</span>
          <span class="reader">${r == null ? '' : `reader ${readerScale(r)}`}</span>
        </li>`;
    })
    .join('');
  const levers = s.improvements
    .map((i) => `<li><b>${esc(i.label)}.</b> ${esc(i.tip)}</li>`)
    .join('');
  $('#summary').innerHTML = `
    <div class="card-head">
      <p class="card-kicker">Reader's card · overall file</p>
      <div class="card-title"><h2>${esc(band.label)}</h2><span class="card-score">${s.R.toFixed(1)} / 10</span></div>
      <p class="card-detail">${esc(band.detail)}</p>
    </div>
    <div class="gauge">${gaugeSvg(s.R)}</div>`;
  $('#reader-card').innerHTML = `
    <div class="card-head">
      <p class="card-kicker">Reader's ratings · 0–10, with the 1–6 reader scale</p>
      <div class="card-title"><h2>Part by part</h2></div>
    </div>
    <ul class="ratings">${rows}</ul>
    ${levers ? `<div class="levers"><h3>Biggest levers</h3><ol>${levers}</ol></div>` : ''}`;
}

function track(kind, res) {
  const lo = res.low * 100;
  const hi = res.high * 100;
  return `<span class="track ${kind}"><span class="range" style="left:${lo}%;width:${Math.max(hi - lo, 0.6)}%"></span><span class="point" style="width:${Math.max(res.p * 100, 0.6)}%"></span></span>`;
}

function contribChart(result, round) {
  const rows = result.contributions
    .filter((c) => c.used)
    .map((c) => ({ label: c.label, lo: c.logOdds, note: `rated ${c.rating.toFixed(1)}` }));
  for (const [label, m] of round.adjustments) rows.push({ label, lo: Math.log(m), note: 'odds adjustment' });
  if (result.athlete) {
    const d1 = result.school.athletics === 'D1';
    rows.push({ label: 'Recruited athlete', lo: Math.log(d1 ? 6 : MODEL.athleteD3Mult), note: 'coach support', text: d1 ? '≥85%' : fmtMult(MODEL.athleteD3Mult) });
  }
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.lo)));
  return rows
    .map((r) => {
      const w = (Math.min(Math.abs(r.lo), max) / max) * 50;
      const cls = r.lo >= 0 ? 'up' : 'down';
      const style = r.lo >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`;
      const mult = r.text ?? fmtMult(Math.exp(r.lo));
      return `<div class="contrib-row" title="${esc(r.note)}"><span class="label">${esc(r.label)}</span><span class="dbar"><span class="${cls}" style="${style}"></span></span><span class="mult">${mult}</span></div>`;
    })
    .join('');
}

function testAdviceHtml(r, profile) {
  const s = r.school;
  if (r.missingTest) {
    const what = s.tests.policy === 'flexible' ? 'SAT, ACT, AP or IB scores' : 'SAT or ACT scores';
    return `<p class="advice bad">${esc(s.short)} requires ${what} for 2026–27. Add a score to see your chances.</p>`;
  }
  if (s.tests.policy === 'blind') return `<p class="advice">${esc(s.short)} is test-blind: scores are not read, so grades, rigor and your Personal Insight Questions carry more weight.</p>`;
  if (r.testFromAP) return `<p class="advice">Yale is test-flexible; your AP scores stand in for the SAT/ACT here.</p>`;
  const sat = satEquivalent(profile);
  const range = s.tests.sat ? `${s.tests.sat[0]}–${s.tests.sat[1]}` : '';
  const yours = profile.testType === 'act' ? `ACT ${profile.testScore} (≈${sat} SAT)` : `${sat}`;
  if (r.testAdvice === 'submit') return `<p class="advice">Send your scores: your ${esc(yours)} sits at or above the middle of the ${esc(range)} range.</p>`;
  if (r.testAdvice === 'withhold') return `<p class="advice">Consider applying test-optional: your ${esc(yours)} is below the middle of ${esc(s.short)}'s ${esc(range)} range, so the estimate assumes you withhold it.</p>`;
  if (r.testAdvice === 'none') return `<p class="advice">Applying without scores under ${esc(s.short)}'s test-optional policy.${s.tests.note ? ` ${esc(s.tests.note)}` : ''}</p>`;
  return '';
}

function athleteNote(r) {
  if (!r.athlete) return '';
  return r.school.athletics === 'D1'
    ? '<p class="advice">Recruited athletes on a Division I coach\'s list were admitted at about 86% at Harvard (SFFA data). Assumes the coach supports you and you clear the academic bar.</p>'
    : '<p class="advice">Division III coaches can flag recruits but with less pull than Division I; modeled as about four times the odds.</p>';
}

function schoolFacts(s) {
  const early = s.early
    ? `${s.early.plan} ${fmtRate(s.early.rate)}${s.early.estimated ? ' (est.)' : ''}`
    : 'No early round';
  const rows = [
    ['Overall admit rate', `${fmtRate(s.admit.rate)} · ${classLabel(s.admit.cls)}`],
    ['Early round', early],
    ['Regular decision', `${fmtRate(s.rd.rate)}${s.rd.estimated ? ' (est.)' : ''}`],
    ['SAT middle 50%', s.tests.sat ? `${s.tests.sat[0]}–${s.tests.sat[1]}` : 'Not used'],
    ['ACT middle 50%', s.tests.act ? `${s.tests.act[0]}–${s.tests.act[1]}` : 'Not used'],
    ['Testing 2026–27', POLICY_LABEL[s.tests.policy]],
    ['Legacy', LEGACY_LABEL[s.legacy]],
    ['Demonstrated interest', interestLabel(s)],
    ['Interview', INTERVIEW_LABEL[s.interview]],
  ];
  if (s.residency) {
    rows.splice(2, 1, ['By residency', `CA ${fmtRate(s.residency.ca)} · U.S. ${fmtRate(s.residency.us)} · Intl ${fmtRate(s.residency.intl)}`]);
  }
  return `<dl class="facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function schoolDetail(r, profile) {
  const s = r.school;
  const earlyNum = r.early
    ? `<div class="bignum ea"><span class="k">${esc(s.early.plan)}</span><span class="v">${fmtPct(r.early.p)}</span><span class="r">likely ${fmtPct(r.early.low)}–${fmtPct(r.early.high)}</span></div>`
    : `<div class="bignum"><span class="k">Early round</span><span class="v">—</span><span class="r">UC campuses have one deadline</span></div>`;
  const round = r.early && state.earlyChoice === s.id ? r.early : r.rd;
  return `
    <div class="detail-nums">
      <div class="bignum rd"><span class="k">Regular decision</span><span class="v">${fmtPct(r.rd.p)}</span><span class="r">likely ${fmtPct(r.rd.low)}–${fmtPct(r.rd.high)}</span></div>
      ${earlyNum}
    </div>
    ${testAdviceHtml(r, profile)}
    ${athleteNote(r)}
    ${r.missingTest ? '' : `<div class="detail-block"><h4>What moved your odds${round === r.early ? ` (${esc(s.early.plan)})` : ''}, compared with a typical applicant</h4><div class="contrib">${contribChart(r, round)}</div></div>`}
    <div class="detail-block"><h4>${esc(s.name)}</h4>${schoolFacts(s)}</div>
    <a href="#school-${s.id}" class="micro">Full school profile and sources</a>`;
}

function renderSchools(results, profile) {
  const list = [...results];
  if (sortMode === 'chance') {
    list.sort((a, b) => b.rd.p - a.rd.p || (b.early?.p ?? 0) - (a.early?.p ?? 0) || a.school.rank - b.school.rank);
  } else {
    list.sort((a, b) => a.school.rank - b.school.rank || a.school.short.localeCompare(b.school.short));
  }
  $('#school-list').innerHTML = list
    .map((r) => {
      const s = r.school;
      const isEarly = state.earlyChoice === s.id;
      const open = expanded.has(s.id);
      const cat = r.missingTest ? r.rd.category : (isEarly && r.early ? r.early : r.rd).category;
      const tag = isEarly ? `<span class="chip tag">Your ${esc(s.early.plan)}</span>` : '';
      const earlyPct = r.early ? `<span class="pct-ea">${esc(s.early.plan)} ${fmtPct(r.early.p)}</span>` : '';
      const bars = r.missingTest ? '' : `${track('rd', r.rd)}${r.early ? track('ea', r.early) : ''}`;
      return `
        <li class="school ${isEarly ? 'is-early' : ''} ${r.missingTest ? 'is-blocked' : ''}">
          <button type="button" class="school-row" data-school="${s.id}" aria-expanded="${open}" aria-controls="detail-${s.id}">
            <span class="rank">#${s.rank}</span>
            <span class="sname">${esc(s.short)}</span>
            <span class="pcts">${r.missingTest ? '' : `<span class="pct-rd">${fmtPct(r.rd.p)}</span>${earlyPct}`}</span>
            <span class="row-bars">${bars}</span>
            <span class="meta-line"><span class="chip ${cat.key}">${esc(cat.label)}</span>${tag}<span>admits ${fmtRate(s.residency ? s.residency[profile.residency] : s.admit.rate)} · tests ${esc(POLICY_LABEL[s.tests.policy].toLowerCase())}</span></span>
          </button>
          <div class="school-detail" id="detail-${s.id}" ${open ? '' : 'hidden'}>${open ? schoolDetail(r, profile) : ''}</div>
        </li>`;
    })
    .join('');
}

function renderStrategy(results, profile) {
  const plan = earlyPlanNotes(results, state.earlyChoice);
  const withheld = results.filter((r) => r.testAdvice === 'withhold').map((r) => r.school.short);
  const blocked = results.filter((r) => r.missingTest).map((r) => r.school.short);
  const gains = plan.bestGains
    .filter((g) => g.gain > 0.005)
    .map((g) => {
      const r = results.find((x) => x.school.id === g.id);
      return `<li><b>${esc(g.short)} ${esc(g.plan)}</b>: ${fmtPct(r.rd.p)} regular → ${fmtPct(g.p)} early</li>`;
    })
    .join('');
  const items = [];
  if (gains) items.push(`<p>Biggest early-round gains for your profile:</p><ul>${gains}</ul>`);
  for (const n of plan.notes) items.push(`<p>${esc(n)}</p>`);
  if (withheld.length) items.push(`<p>Consider applying test-optional to ${esc(withheld.join(', '))}, where your score is below the middle of the range.</p>`);
  if (blocked.length) items.push(`<p>${esc(blocked.join(', '))} ${blocked.length === 1 ? 'requires' : 'require'} test scores for 2026–27. Add a score to include ${blocked.length === 1 ? 'it' : 'them'}.</p>`);
  if (profile.residency === 'intl') items.push('<p>International applicants face lower admit rates at most of these schools, and some consider financial need for international students.</p>');
  $('#strategy').innerHTML = items.length ? `<h3>Strategy notes</h3>${items.join('')}` : '';
}

let lastResults = [];
function renderResults() {
  const profile = state;
  lastResults = scoreAll(profile);
  renderReaderCard(profile);
  renderSchools(lastResults, profile);
  renderStrategy(lastResults, profile);
  renderEssayCheck();
}

function renderEssayCheck() {
  const res = checkEssay($('#essayText').value);
  $('#essay-notes').innerHTML = res ? res.notes.map((n) => `<li class="${n.level}">${esc(n.text)}</li>`).join('') : '';
}

// ------------------------------------------------------------ school data view

function renderSchoolData() {
  $('#schools-intro').textContent = `The ${SCHOOLS.length} universities ranked No. 20 or better in the ${RANKING.publisher} ${RANKING.edition} ${RANKING.list} list (released ${RANKING.released}); three schools tie at No. 20. Figures are the latest each school has published as of ${DATA_AS_OF}. Policies are for the ${CYCLE}. "est." marks figures a school has not published.`;

  const head = `<thead><tr>
      <th scope="col">Rank</th><th scope="col">School</th><th scope="col">Admit rate</th><th scope="col">Applicants</th>
      <th scope="col">Early round</th><th scope="col">Regular</th><th scope="col">SAT mid-50%</th><th scope="col">ACT</th>
      <th scope="col">Testing 2026–27</th><th scope="col">Legacy</th><th scope="col">Interest</th></tr></thead>`;
  const rows = SCHOOLS.map((s) => {
    const est = (x) => (x?.estimated ? ' <span class="est">est.</span>' : '');
    return `<tr>
      <td class="n">${s.rank}</td>
      <td><a href="#school-${s.id}">${esc(s.short)}</a></td>
      <td class="n">${fmtRate(s.admit.rate)} <span class="est">${s.admit.cls ?? ''}</span></td>
      <td class="n">${fmtInt(s.admit.applicants)}</td>
      <td class="n">${s.early ? `${esc(s.early.plan)} ${fmtRate(s.early.rate)}${est(s.early)}` : '—'}</td>
      <td class="n">${s.residency ? `CA ${fmtRate(s.residency.ca)}` : `${fmtRate(s.rd.rate)}${est(s.rd)}`}</td>
      <td class="n">${s.tests.sat ? `${s.tests.sat[0]}–${s.tests.sat[1]}` : '—'}</td>
      <td class="n">${s.tests.act ? `${s.tests.act[0]}–${s.tests.act[1]}` : '—'}</td>
      <td>${esc(POLICY_LABEL[s.tests.policy])}</td>
      <td>${esc(LEGACY_LABEL[s.legacy])}</td>
      <td>${esc(interestLabel(s))}</td>
    </tr>`;
  }).join('');
  $('#schools-table').innerHTML = `${head}<tbody>${rows}</tbody>`;

  const verified = { true: 'Confirmed from the school\'s Common Data Set.', partial: 'Partly confirmed from the school\'s Common Data Set; other levels estimated from peer schools.', false: 'Estimated from peer schools; check the school\'s Common Data Set.' };
  $('#school-cards').innerHTML = SCHOOLS.map((s) => {
    const c7 = C7_FACTORS.map(([k, label]) => `<span class="l${s.c7[k]}" title="${esc(C7_LABELS[s.c7[k]])}">${esc(label)}</span>`).join('');
    const testNote = s.tests.note ? `<li>${esc(s.tests.note)}</li>` : '';
    const admitNote = s.admit.note ? `<li>${esc(s.admit.note)}</li>` : '';
    const earlyNote = s.early?.note ? `<li>${esc(s.early.plan)}: ${esc(s.early.note)}</li>` : '';
    return `
      <article class="card" id="school-${s.id}">
        <div class="card-top"><h3>${esc(s.name)}</h3><span class="num">No. ${s.rank}${SCHOOLS.filter((x) => x.rank === s.rank).length > 1 ? ' (tie)' : ''}</span></div>
        <p class="city">${esc(s.city)} · ${esc(s.early ? s.early.label : 'No early round')}</p>
        ${schoolFacts(s)}
        <ul class="fact-list">${s.facts.map((f) => `<li>${esc(f)}</li>`).join('')}${admitNote}${earlyNote}${testNote}</ul>
        <div>
          <p class="c7-key">Common Data Set C7 factors: solid = very important, green outline = important, grey outline = considered, struck through = not considered. ${esc(verified[String(s.c7Verified)])}</p>
          <div class="c7">${c7}</div>
        </div>
        <ol class="sources">${s.sources.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a></li>`).join('')}</ol>
      </article>`;
  }).join('');
}

// ------------------------------------------------------------ method view

function renderMethod() {
  const allSources = [...RESEARCH_SOURCES];
  for (const s of SCHOOLS) for (const src of s.sources) if (!allSources.some((x) => x.url === src.url)) allSources.push(src);
  $('#method-body').innerHTML = `
    <h2>How the estimate works</h2>
    <p class="callout">These are estimates built from published admissions data, not predictions. Many applicants with flawless files are turned away from every school on this list, so treat each one as a reach.</p>

    <h3>1. Your file becomes ten ratings</h3>
    <p>Each part of the application gets a 0–10 rating, where 5 is a typical applicant to a top-20 university and about 7.5 is a typical admit. The reader's card also shows each rating on the 1–6 scale Harvard's readers use (1 is best), as revealed in <i>SFFA v. Harvard</i>.</p>
    <ul>
      <li><b>Grades and rank.</b> Unweighted GPA (a 3.9 is typical of applicants; admits cluster at 3.95–4.0), blended with class rank when your school ranks. The UCs use your capped weighted UC GPA instead, estimated from your GPA and honors courses if you leave it blank.</li>
      <li><b>Course rigor.</b> Starts from the counselor's checkbox ("most demanding" through "below average"), then adjusts for how many AP, IB or dual-enrollment courses you take, courses beyond your school's curriculum, and AP exam scores. Students at schools with few advanced courses are not penalized for the count.</li>
      <li><b>Test scores.</b> Compared with each school's middle-50% range, so a 1500 counts for more at Notre Dame (1460–1540) than at MIT (1520–1570). Gains flatten near 1600. ACT scores are converted with the 2018 ACT/SAT concordance.</li>
      <li><b>Activities.</b> Each activity gets a tier: 1 for national or international distinction, 2 for state or regional distinction or major leadership, 3 for school or local leadership, 4 for membership. Years and weekly hours adjust it. Your top activity counts 60%, the next two 25% and the rest 15%, mirroring how readers look for depth over breadth.</li>
      <li><b>Honors.</b> Your highest honor counts most; a national award outweighs several school awards.</li>
      <li><b>Research, work and programs.</b> Mentored research, paid work and family responsibilities, internships, ventures, portfolios and selective summer programs. Pay-to-attend programs add almost nothing.</li>
      <li><b>Essays.</b> Your rubric scores for voice, specificity, insight and craft (60%) and school fit and supplements (40%).</li>
      <li><b>Recommendations.</b> The teacher evaluation's own scale, from "good (average)" to "one of the top few I have ever taught", with the counselor at 35%.</li>
      <li><b>Interview</b> (only where offered) and <b>personal qualities</b>, inferred from essays, recommendations, the interview, leadership and service.</li>
    </ul>

    <h3>2. Each school weights them differently</h3>
    <p>Weights come from each school's Common Data Set section C7, which rates factors as very important (3), important (2), considered (1) or not considered (0). MIT rates only character "very important"; Harvard and Princeton rate nearly every academic and personal factor "very important"; the UCs ignore test scores, and recommendations too unless Berkeley asks for them.</p>

    <h3>3. Calibrated to real admit rates</h3>
    <p>For each school the model assumes applicants' weighted ratings follow a bell curve, then solves for the logistic curve (slope ${MODEL.beta} log-odds per standard deviation) whose average across that pool equals the school's regular-decision admit rate after removing hooked applicants. In the Harvard trial data, recruited athletes, legacies, dean's-interest applicants and children of faculty were about 5% of applicants but 30% of admits, so the unhooked rate is set at ${Math.round(MODEL.hookShare.strong * 100)}–${Math.round(MODEL.hookShare.none * 100)}% of the published rate depending on how much the school weighs legacy. A ceiling keeps even a perfect file below roughly 40–60% at the most selective schools, because readers turn away many applicants with top marks in every category.</p>

    <h3>4. Odds adjustments</h3>
    <div class="tbl"><table>
      <thead><tr><th>Factor</th><th>Effect on the odds</th><th>Basis</th></tr></thead>
      <tbody>
        <tr><td>Early Decision (binding)</td><td>(ED odds ÷ RD odds)<sup>${MODEL.earlyExponent.binding}</sup>, up to ×${MODEL.earlyMultCap}</td><td>Published ED vs RD rates, discounted because early pools are full of recruited athletes and legacies</td></tr>
        <tr><td>Restrictive / single-choice EA</td><td>(EA odds ÷ RD odds)<sup>${MODEL.earlyExponent.restrictive}</sup></td><td>Harvard, Yale, Princeton, Stanford, Caltech, Notre Dame</td></tr>
        <tr><td>Non-restrictive EA</td><td>(EA odds ÷ RD odds)<sup>${MODEL.earlyExponent.open}</sup></td><td>MIT</td></tr>
        <tr><td>Legacy</td><td>×${MODEL.legacyMult.strong} / ×${MODEL.legacyMult.moderate} / ×${MODEL.legacyMult.light}, +25% when applying early</td><td>Harvard data showed about a five-fold effect; most schools have since reduced it. Not used at MIT, Caltech, Stanford, Johns Hopkins, Carnegie Mellon or the UCs</td></tr>
        <tr><td>Donor ties</td><td>×${MODEL.donorMult}</td><td>Dean's-interest list admitted at 42% in the Harvard data; banned at California private colleges by AB 1780</td></tr>
        <tr><td>Recruited athlete</td><td>Division I: at least 85%; Division III: ×${MODEL.athleteD3Mult}</td><td>86% admit rate for recruited athletes at Harvard</td></tr>
        <tr><td>First-generation / low-income</td><td>×${MODEL.firstGenMult} / ×${MODEL.lowIncomeMult}, combined at most ×${MODEL.contextMultCap}</td><td>Listed as considered in nearly every C7 grid</td></tr>
        <tr><td>Rural or underrepresented region</td><td>×${MODEL.geographyMult}</td><td>Geographical residence is considered</td></tr>
        <tr><td>International (private schools)</td><td>×${MODEL.internationalMult}</td><td>International admit rates run well below domestic rates; for the UCs the published residency rates are used directly</td></tr>
        <tr><td>Intended major</td><td>School-specific</td><td>UCLA CS admitted 3% and Berkeley CS 7% against roughly 10–11% overall; Carnegie Mellon's School of Computer Science turns away about 95%. Non-STEM interests at MIT and Caltech get a smaller fit discount (an estimate, not a published figure)</td></tr>
        <tr><td>Demonstrated interest</td><td>×${MODEL.interestMult.none}–×${MODEL.interestMult.high}</td><td>Only at Duke, Dartmouth, Northwestern, Rice and WashU, which list it as considered</td></tr>
      </tbody>
    </table></div>
    <p>The likely range shown with each estimate adds and subtracts ${MODEL.band} in log-odds, roughly the uncertainty in rating your own essays and recommendations.</p>

    <h3>What the research says</h3>
    <ul>
      <li>In the Harvard admissions data released in court, recruited athletes were admitted at 86%, children of faculty at 47%, dean's-interest applicants at 42% and legacies at 34%, against under 5.5% for everyone else. Applicants in the top academic-index decile were admitted at only 13–15%.</li>
      <li>Opportunity Insights found that a student from a top-1% family is more than twice as likely to attend an Ivy-Plus college as a middle-class student with the same SAT score, driven by legacy preference, non-academic ratings and athletic recruiting (recruits are 10–15% of each class).</li>
      <li>Early rounds admit two to five times the regular rate: Duke 13.8% vs 3.7%, Brown 16.5% vs 3.9%, Penn 13.3% vs 3.7%, Yale 10.9% vs about 2.9%. Caltech is the exception, reporting no meaningful difference.</li>
      <li>Testing is back. Ten of these schools require the SAT or ACT for 2026–27; Princeton, Columbia and Notre Dame return to requiring it in 2027–28 and Vanderbilt in 2028–29. The UCs remain test-blind.</li>
      <li>Across all U.S. colleges, NACAC's survey finds grades in college-prep courses (76.8% "considerable importance"), overall grades (74.1%) and curriculum strength (63.8%) matter most, well ahead of essays (18.9%) and activities (6.5%). At highly selective schools almost every applicant clears the academic bar, so essays, recommendations and activities decide far more cases.</li>
    </ul>

    <h3>What it can't see</h3>
    <ul>
      <li>Your self-assessment. Essays and recommendations are the hardest parts to judge from the inside; ask a teacher or counselor to check your ratings.</li>
      <li>Institutional priorities that change each year: the size of the engineering class, gender balance in specific majors, a new program a college wants to fill, or how many students in your region applied.</li>
      <li>Race and ethnicity. Since the 2023 SFFA decision colleges cannot consider them directly, so the calculator does not ask.</li>
      <li>Data schools withhold. Harvard, Princeton, Stanford, UChicago and others no longer publish round-level figures; those inputs are labeled as estimates.</li>
    </ul>

    <h3>Sources</h3>
    <ol class="sources">${allSources.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a></li>`).join('')}</ol>`;
}

// ------------------------------------------------------------ routing

function route() {
  const hash = (location.hash || '#calculator').slice(1);
  const schoolTarget = hash.startsWith('school-') ? hash : null;
  const view = schoolTarget ? 'schools' : ['schools', 'method'].includes(hash) ? hash : 'calculator';
  for (const v of $$('.view')) v.hidden = v.dataset.view !== view;
  for (const t of $$('.tab')) {
    if (t.dataset.view === view) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  if (schoolTarget) {
    const el = document.getElementById(schoolTarget);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  } else if (hash === 'results-panel') {
    requestAnimationFrame(() => $('#results-panel').scrollIntoView({ block: 'start' }));
  } else if (['schools', 'method'].includes(view)) {
    window.scrollTo(0, 0);
  }
}

// ------------------------------------------------------------ events

function bind() {
  const form = $('#profile-form');
  form.addEventListener('input', readForm);
  form.addEventListener('change', readForm);
  form.addEventListener('submit', (e) => e.preventDefault());

  form.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      state[rm.dataset.remove].splice(Number(rm.dataset.index), 1);
      state.example = false;
      renderLists();
      syncFormHints();
      scheduleRender();
    }
  });

  $('#add-activity').addEventListener('click', () => {
    if (state.activities.length >= MAX_ACTIVITIES) return;
    state.activities.push(act('', ACTIVITY_CATEGORIES[0], 4, 1, 2));
    renderLists();
    $(`#act-name-${state.activities.length - 1}`)?.focus();
    scheduleRender();
  });
  $('#add-honor').addEventListener('click', () => {
    if (state.honors.length >= MAX_HONORS) return;
    state.honors.push({ name: '', level: 'school' });
    renderLists();
    $(`#hon-name-${state.honors.length - 1}`)?.focus();
    scheduleRender();
  });

  $('#load-example').addEventListener('click', () => {
    state = clone(EXAMPLE);
    writeForm();
    scheduleRender();
  });
  $('#clear-form').addEventListener('click', () => {
    state = clone(BLANK);
    writeForm();
    scheduleRender();
  });

  $('#school-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-school]');
    if (!btn) return;
    const id = btn.dataset.school;
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    renderSchools(lastResults, state);
  });

  for (const b of $$('.seg')) {
    b.addEventListener('click', () => {
      sortMode = b.dataset.sort;
      for (const x of $$('.seg')) x.setAttribute('aria-pressed', String(x === b));
      renderSchools(lastResults, state);
    });
  }

  window.addEventListener('hashchange', route);
}

function init() {
  buildStaticControls();
  writeForm();
  renderSchoolData();
  renderMethod();
  bind();
  route();
  renderResults();
}

init();
