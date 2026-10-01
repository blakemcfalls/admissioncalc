// Admission-chance model.
//
// 1. Every part of the application is turned into a 0–10 rating, where 5 is a
//    typical applicant to a top-20 university and 7–8 is a typical admit.
// 2. Each school weights those ratings using its Common Data Set (C7) grid.
// 3. The weighted rating is placed on the school's applicant pool, and a
//    logistic curve calibrated to the school's published admit rate turns it
//    into a probability. Early rounds, hooks, major and residency then shift
//    the odds by amounts derived from published round-level data.
//
// The module is pure (no DOM) so it can be unit-tested with node --test.

import { SCHOOLS, CO } from './schools.js';

export const MODEL = {
  beta: 1.6, // log-odds per pool standard deviation
  poolSd: 1.25, // spread of composite ratings across a school's applicant pool
  band: 0.6, // ± log-odds used for the likely range
  testOptionalPenalty: 0.12, // composite cost of applying without scores
  // Grades act as a gate: below a rating of 4.5 (about a 3.82 unweighted GPA)
  // each rating point costs this much extra log-odds, more at the UCs.
  gradeGate: { threshold: 4.5, slope: 0.9, ucSlope: 1.1 },
  ucGpaWeight: 1.5,
  hookShare: { strong: 0.82, moderate: 0.86, light: 0.9, none: 0.93 },
  // No legacy preference but a large Division I recruiting class (Stanford):
  // recruits are 10–15% of Ivy-Plus classes (Opportunity Insights).
  hookShareNoLegacyD1: 0.88,
  ucHookShare: 0.97,
  earlyExponent: { binding: 0.55, restrictive: 0.4, open: 0.3 },
  earlyMultCap: 2.6,
  legacyMult: { strong: 3.0, moderate: 2.0, light: 1.4, none: 1 },
  legacyEarlyBonus: 1.25,
  donorMult: 2.5,
  contextMultCap: 1.5,
  firstGenMult: 1.3,
  lowIncomeMult: 1.25,
  ucContextMult: { firstGen: 1.2, lowIncome: 1.15 },
  geographyMult: 1.15,
  internationalMult: 0.6,
  interestMult: { high: 1.12, some: 1.0, none: 0.85 },
  athleteD1Remaining: 0.15, // recruited D1 athlete keeps 15% of the rejection risk
  athleteD3Mult: 4,
  minP: 0.002,
  maxP: 0.95,
};

export const MAJORS = [
  ['undecided', 'Undecided / exploring'],
  ['cs', 'Computer science'],
  ['engineering', 'Engineering'],
  ['business', 'Business'],
  ['natsci', 'Natural sciences / pre-med'],
  ['socsci', 'Social sciences / economics'],
  ['humanities', 'Humanities'],
  ['arts', 'Fine or performing arts'],
];

export const ACTIVITY_CATEGORIES = [
  'Academic', 'Art', 'Athletics: Club', 'Athletics: JV/Varsity', 'Career Oriented',
  'Community Service (Volunteer)', 'Computer/Technology', 'Cultural', 'Dance',
  'Debate/Speech', 'Environmental', 'Family Responsibilities', 'Foreign Exchange',
  'Internship', 'Journalism/Publication', 'Junior R.O.T.C.', 'LGBT', 'Music: Instrumental',
  'Music: Vocal', 'Religious', 'Research', 'Robotics', 'School Spirit', 'Science/Math',
  'Social Justice', 'Student Govt./Politics', 'Theater/Drama', 'Work (Paid)',
  'Other Club/Activity',
];

// ---------------------------------------------------------------- helpers

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const odds = (p) => p / (1 - p);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function interp(x, points) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
// Average over a fixed number of slots, counting empty slots as zero.
const slotAvg = (xs, from, to) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += xs[i] ?? 0;
  return sum / (to - from);
};

// 2018 ACT/SAT concordance (single-score estimates).
const ACT_TO_SAT = {
  36: 1590, 35: 1540, 34: 1500, 33: 1460, 32: 1430, 31: 1400, 30: 1370, 29: 1340,
  28: 1310, 27: 1280, 26: 1240, 25: 1210, 24: 1180, 23: 1140, 22: 1110, 21: 1080,
  20: 1040, 19: 1010, 18: 970, 17: 930, 16: 890, 15: 850,
};

export function actToSat(act) {
  const a = clamp(Math.round(act), 15, 36);
  return ACT_TO_SAT[a];
}

// Scores on the SAT scale, or null when no usable score was entered.
export function satEquivalent(profile) {
  const s = Number(profile.testScore);
  if (profile.testType === 'sat' && isNum(s) && s >= 400 && s <= 1600) return s;
  if (profile.testType === 'act' && isNum(s) && s >= 1 && s <= 36) return actToSat(s);
  return null;
}

// Convert a 100-point average to the 4.0 scale used by the model.
export function gpaOn4(profile) {
  const g = Number(profile.gpa);
  if (!isNum(g)) return null;
  if (profile.gpaScale === '100') {
    if (g >= 85) return clamp(3.2 + (g - 85) * (0.8 / 12), 0, 4);
    return clamp(3.2 - (85 - g) * 0.1, 0, 4);
  }
  return clamp(g, 0, 4);
}

export function ucGpaEstimate(profile) {
  const given = Number(profile.ucGpa);
  if (isNum(given) && given > 0) return clamp(given, 0, 4.6);
  const uw = gpaOn4(profile);
  if (uw == null) return null;
  const courses = Number(profile.collegeCourses) || 0;
  return uw + Math.min(8, courses * 1.2) / 22;
}

// ---------------------------------------------------------------- ratings

const GPA_POINTS = [[2.8, 0], [3.2, 0.8], [3.4, 1.6], [3.5, 2.2], [3.6, 2.9], [3.7, 3.6], [3.8, 4.3], [3.85, 4.8], [3.9, 5.4], [3.95, 6.5], [4.0, 7.6]];
const RANK_POINTS = [[0.5, 9], [1, 8.5], [2, 7.6], [3, 7], [5, 6], [10, 4.6], [15, 3.6], [25, 2.2], [50, 0.8], [100, 0]];
const UC_GPA_POINTS = [[3.4, 0.5], [3.6, 1.2], [3.8, 2.2], [3.9, 2.9], [4.0, 3.6], [4.1, 4.6], [4.15, 5.3], [4.2, 6.0], [4.25, 6.8], [4.3, 7.6], [4.35, 8.3], [4.4, 8.9]];
const AP_SCORE_POINTS = [[3, 2], [3.5, 3.5], [4, 5], [4.5, 6.5], [5, 7.6]];

export const RIGOR_LEVELS = {
  most: { label: 'Most demanding', rating: 7.5 },
  very: { label: 'Very demanding', rating: 5.5 },
  demanding: { label: 'Demanding', rating: 3.8 },
  average: { label: 'Average', rating: 2.2 },
  below: { label: 'Below average', rating: 1 },
};

export const ACTIVITY_TIERS = {
  1: { label: 'Tier 1 · National or international distinction', base: 10 },
  2: { label: 'Tier 2 · State or regional distinction, major leadership', base: 7.5 },
  3: { label: 'Tier 3 · School or local leadership', base: 5 },
  4: { label: 'Tier 4 · Member or participant', base: 2.5 },
};

export const HONOR_LEVELS = {
  intl: { label: 'International', points: 10 },
  national: { label: 'National', points: 8 },
  state: { label: 'State', points: 6 },
  regional: { label: 'Regional', points: 4.5 },
  school: { label: 'School', points: 3 },
};

export const REC_LEVELS = {
  top: { label: 'One of the top few I have ever taught', rating: 9.5 },
  outstanding: { label: 'Outstanding (top 5%)', rating: 8 },
  excellent: { label: 'Excellent (top 10%)', rating: 6.5 },
  verygood: { label: 'Very good (above average)', rating: 4.5 },
  good: { label: 'Good (average)', rating: 2.5 },
  unsure: { label: 'Not sure', rating: 5 },
};

export const INTERVIEW_LEVELS = {
  none: { label: 'No interview', rating: null },
  weak: { label: 'Went poorly', rating: 2.5 },
  average: { label: 'Pleasant, unremarkable', rating: 5 },
  strong: { label: 'Strong connection', rating: 7 },
  exceptional: { label: 'Interviewer was clearly impressed', rating: 9 },
};

export const RESUME_OPTIONS = {
  research: { none: 0, project: 1.5, mentored: 3, presented: 4.5, national: 6 },
  program: { none: 0, open: 0.3, selective: 1.5, elite: 3.5 },
  internship: { none: 0, short: 1.2, substantial: 2 },
  venture: { none: 0, started: 1.5, traction: 3.5 },
  portfolio: { none: 0, submitted: 0.8, distinguished: 2.5 },
};

function gpaRating(profile) {
  const g = gpaOn4(profile);
  if (g == null) return null;
  let r = interp(g, GPA_POINTS);
  if (profile.trend === 'down') r -= 0.8;
  if (profile.trend === 'up' && g < 3.9) r += 0.2;
  const rank = Number(profile.rankPct);
  if (isNum(rank) && rank > 0) r = 0.7 * r + 0.3 * interp(rank, RANK_POINTS);
  return clamp(r, 0, 10);
}

function ucGpaRating(profile) {
  const g = ucGpaEstimate(profile);
  if (g == null) return null;
  let r = interp(g, UC_GPA_POINTS);
  if (profile.trend === 'down') r -= 0.8;
  return clamp(r, 0, 10);
}

function rigorRating(profile) {
  let r = RIGOR_LEVELS[profile.rigor]?.rating ?? RIGOR_LEVELS.demanding.rating;
  const n = Number(profile.collegeCourses) || 0;
  let adj = n >= 12 ? 0.8 : n >= 9 ? 0.5 : n >= 6 ? 0.1 : n >= 3 ? -0.4 : -1.0;
  if (profile.limitedOfferings) adj = Math.max(adj, 0);
  r += adj;
  if (profile.beyondCurriculum) r += 0.6;
  const ap = Number(profile.apAvg);
  if (isNum(ap) && ap > 0 && n >= 2) r += ap >= 4.8 ? 0.3 : ap >= 4.4 ? 0.15 : ap < 3.5 ? -0.3 : 0;
  return clamp(r, 0, 10);
}

// Test rating relative to a school's middle-50% range.
export function testRatingFor(sat, range) {
  if (sat == null || !range) return null;
  const [p25, p75] = range;
  const mid = (p25 + p75) / 2;
  const sd = Math.max(p75 - p25, 40) / 1.349;
  let r = 7 + 1.25 * ((sat - mid) / sd);
  if (r > 8) r = 8 + (r - 8) * 0.5; // little extra credit near the ceiling
  return clamp(r, 0, 9.5);
}

function activityScore(a) {
  const tier = ACTIVITY_TIERS[a.tier] ? Number(a.tier) : 4;
  const years = clamp(Number(a.years) || 1, 1, 4);
  const hours = Number(a.hours) || 0;
  const yearMult = [0, 0.75, 0.88, 1.0, 1.05][years];
  const hourMult = hours >= 10 ? 1.05 : hours >= 5 ? 1.0 : hours >= 2 ? 0.92 : 0.82;
  return clamp(ACTIVITY_TIERS[tier].base * yearMult * hourMult, 0, 10);
}

function activitiesRating(profile) {
  const scores = (profile.activities || []).filter(isFilled).map(activityScore).sort((a, b) => b - a).slice(0, 10);
  const raw = 0.6 * (scores[0] ?? 0) + 0.25 * slotAvg(scores, 1, 3) + 0.15 * slotAvg(scores, 3, 10);
  return { rating: clamp(0.6 + 1.1 * raw, 0, 10), top: scores[0] ?? 0, count: scores.length };
}

function honorsRating(profile) {
  const pts = (profile.honors || [])
    .filter(isFilled)
    .map((h) => HONOR_LEVELS[h.level]?.points ?? 0)
    .sort((a, b) => b - a)
    .slice(0, 5);
  const raw = 0.6 * (pts[0] ?? 0) + 0.25 * (pts[1] ?? 0) + 0.15 * slotAvg(pts, 2, 5);
  return { rating: clamp(1.5 + 1.15 * raw, 0, 10), top: pts[0] ?? 0 };
}

function workPoints(hours) {
  const h = Number(hours) || 0;
  return h >= 15 ? 2.5 : h >= 6 ? 1.5 : h >= 1 ? 0.8 : 0;
}

function resumeRating(profile) {
  const o = RESUME_OPTIONS;
  const research = o.research[profile.research] ?? 0;
  const raw =
    research +
    (o.program[profile.program] ?? 0) +
    workPoints(profile.workHours) +
    (o.internship[profile.internship] ?? 0) +
    (o.venture[profile.venture] ?? 0) +
    (o.portfolio[profile.portfolio] ?? 0);
  return { rating: clamp(2.5 + 7.5 * (1 - Math.exp(-raw / 5)), 0, 10), research };
}

// Graded supplements for one school, mapped to the rubric's 1–5 "fit" and
// "supplements" dimensions; null when none are graded.
export function supplementDims(list) {
  const graded = (Array.isArray(list) ? list : []).map((s) => s && s.grade).filter(Boolean);
  if (!graded.length) return null;
  const num = (x) => (isNum(Number(x)) && x != null ? clamp(Number(x), 1, 5) : null);
  const overall = graded.map((g) => num(g.overall) ?? num(g.quality) ?? 3);
  const fits = graded.map((g) => num(g.fit)).filter((x) => x != null);
  const quality = graded.map((g, i) => {
    const q = num(g.quality) ?? overall[i];
    const r = num(g.responsiveness);
    return r == null ? q : (q + r) / 2;
  });
  return { fit: fits.length ? avg(fits) : avg(overall), supplements: avg(quality), count: graded.length };
}

function essayRating(profile, schoolId = null) {
  const e = profile.essay || {};
  const ps = avg(['voice', 'specificity', 'reflection', 'craft'].map((k) => clamp(Number(e[k]) || 3, 1, 5)));
  const graded = schoolId ? supplementDims(profile.supplements?.[schoolId]) : null;
  const supp = graded
    ? avg([graded.fit, graded.supplements])
    : avg(['fit', 'supplements'].map((k) => clamp(Number(e[k]) || 3, 1, 5)));
  return clamp(2 * (0.6 * ps + 0.4 * supp) - 1, 0, 10);
}

function recsRating(profile) {
  const r = profile.recs || {};
  const val = (k) => REC_LEVELS[r[k]]?.rating ?? REC_LEVELS.unsure.rating;
  return clamp(0.65 * avg([val('teacher1'), val('teacher2')]) + 0.35 * val('counselor'), 0, 10);
}

function interviewRating(profile) {
  return INTERVIEW_LEVELS[profile.interview]?.rating ?? null;
}

function personalRating(profile, parts) {
  const acts = (profile.activities || []).filter(isFilled);
  const leaders = acts.filter((a) => Number(a.tier) <= 3).length;
  const service = acts.some((a) => /Service|Social Justice|Religious|Environmental/.test(a.category || ''));
  const work = acts.some((a) => /Work|Family/.test(a.category || '')) || workPoints(profile.workHours) > 0;
  const signal = clamp(2.5 + 1.2 * Math.min(3, leaders) + (service ? 1.5 : 0) + (work ? 1 : 0), 0, 10);
  const r =
    0.35 * parts.essays +
    0.35 * parts.recs +
    0.15 * (parts.interview ?? parts.essays) +
    0.15 * signal +
    (profile.hardship ? 0.6 : 0);
  return clamp(r, 0, 10);
}

// Rows count once they have a name; blank rows the user added are ignored.
function isFilled(item) {
  return !!item && String(item.name ?? '').trim() !== '';
}

// Ratings that do not depend on the school.
export function profileRatings(profile) {
  const acts = activitiesRating(profile);
  const hon = honorsRating(profile);
  const res = resumeRating(profile);
  const parts = {
    gpa: gpaRating(profile),
    ucGpa: ucGpaRating(profile),
    rigor: rigorRating(profile),
    activities: acts.rating,
    honors: hon.rating,
    resume: res.rating,
    essays: essayRating(profile),
    recs: recsRating(profile),
    interview: interviewRating(profile),
  };
  parts.personal = personalRating(profile, parts);
  parts.spike = Math.max(acts.top, hon.top, res.research * 1.6);
  return parts;
}

// ---------------------------------------------------------------- school model

export const COMPONENTS = [
  ['gpa', 'Grades & rank'],
  ['rigor', 'Course rigor'],
  ['tests', 'Test scores'],
  ['activities', 'Activities'],
  ['honors', 'Honors & awards'],
  ['resume', 'Research, work & programs'],
  ['essays', 'Essays'],
  ['recs', 'Recommendations'],
  ['interview', 'Interview'],
  ['personal', 'Personal qualities'],
];

const isUC = (school) => school.tests?.policy === 'blind';

function schoolWeights(school, opts) {
  const c = school.c7;
  const uc = isUC(school);
  return {
    gpa: uc ? MODEL.ucGpaWeight * c.gpa : c.gpa + (opts.hasRank ? 0.5 * c.rank : 0),
    rigor: c.rigor,
    tests: opts.testUsed ? (opts.testFromAP ? 0.8 : 1) * c.tests : 0,
    activities: c.ecs + 0.4 * c.talent,
    honors: 0.6 * c.talent + 0.3,
    resume: 0.4 * c.talent + 0.6 * Math.max(c.work, c.volunteer) + 0.5,
    essays: c.essay,
    recs: uc ? 0 : c.recs,
    interview: opts.hasInterview && school.interview !== 'none' ? Math.max(c.interview, 1) : 0,
    personal: 0.8 * c.character,
  };
}

function composite(ratings, weights) {
  let sw = 0;
  let sum = 0;
  for (const [k] of COMPONENTS) {
    const w = weights[k] || 0;
    const r = ratings[k];
    if (w > 0 && r != null) {
      sw += w;
      sum += w * r;
    }
  }
  return { R: sw ? sum / sw : 5, totalWeight: sw };
}

// Standard-normal quadrature grid for calibrating each school's curve.
const GRID = (() => {
  const pts = [];
  let total = 0;
  for (let z = -5; z <= 5.0001; z += 0.1) {
    const w = Math.exp(-(z * z) / 2);
    pts.push([z, w]);
    total += w;
  }
  return pts.map(([z, w]) => [z, w / total]);
})();

export function ceilingFor(rate) {
  return clamp(0.3 + 2.6 * rate, 0.4, 0.85);
}

// Find alpha so that the average applicant-pool probability equals `target`.
export function calibrateAlpha(target, ceiling, beta = MODEL.beta) {
  const goal = Math.min(target, ceiling * 0.98);
  let lo = -30;
  let hi = 15;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    let mean = 0;
    for (const [z, w] of GRID) mean += w * ceiling * sigmoid(mid + beta * z);
    if (mean > goal) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function earlyMultiplier(school) {
  const e = school.early;
  if (!e || !school.rd) return 1;
  const or = odds(e.rate) / odds(school.rd.rate);
  const exp = e.binding ? MODEL.earlyExponent.binding : e.restrictive ? MODEL.earlyExponent.restrictive : MODEL.earlyExponent.open;
  return clamp(Math.pow(Math.max(or, 1), exp), 1, MODEL.earlyMultCap);
}

function baseRdRate(school, profile) {
  if (school.residency) return school.residency[profile.residency] ?? school.rd.rate;
  return school.rd.rate;
}

const calibrationCache = new Map();
function calibration(school, profile) {
  const rate = baseRdRate(school, profile);
  const key = `${school.id}:${rate}`;
  if (!calibrationCache.has(key)) {
    const share = school.residency
      ? MODEL.ucHookShare
      : school.legacy === 'none' && school.athletics === 'D1'
        ? MODEL.hookShareNoLegacyD1
        : MODEL.hookShare[school.legacy] ?? 0.9;
    const ceiling = Math.min(ceilingFor(rate), school.maxChance ?? 1);
    calibrationCache.set(key, { rate, ceiling, alpha: calibrateAlpha(rate * share, ceiling), unhooked: rate * share });
  }
  return calibrationCache.get(key);
}

const has = (list, id) => Array.isArray(list) && list.includes(id);

// Odds adjustments outside the reader's ratings, as [label, multiplier] pairs.
function adjustments(school, profile, round) {
  const out = [];
  const uc = isUC(school);
  const legacy = school.legacy || 'none';

  if (round === 'early') out.push([`${school.early.plan} round`, earlyMultiplier(school)]);

  if (has(profile.legacy, school.id)) {
    if (legacy === 'none') out.push(['Legacy (not considered here)', 1]);
    else {
      let m = MODEL.legacyMult[legacy];
      if (round === 'early' && legacy !== 'light') m *= MODEL.legacyEarlyBonus;
      out.push([round === 'early' ? 'Legacy, applying early' : 'Legacy', m]);
    }
  }
  if (has(profile.donor, school.id)) {
    out.push(legacy === 'none' ? ['Donor ties (not considered here)', 1] : ['Development interest', MODEL.donorMult]);
  }

  let ctx = 1;
  if (profile.firstGen) ctx *= uc ? MODEL.ucContextMult.firstGen : MODEL.firstGenMult;
  if (profile.lowIncome) ctx *= uc ? MODEL.ucContextMult.lowIncome : MODEL.lowIncomeMult;
  if (ctx > 1) out.push(['First-gen / income context', Math.min(ctx, MODEL.contextMultCap)]);

  if (profile.rural && school.c7.geography >= CO) out.push(['Underrepresented region', MODEL.geographyMult]);
  if (profile.residency === 'intl' && !school.residency) out.push(['International applicant pool', MODEL.internationalMult]);

  const major = school.majors?.[profile.major];
  if (major && major !== 1) out.push([`Intended major`, major]);

  if (school.c7.interest === CO && profile.interest && profile.interest !== 'some') {
    out.push(['Demonstrated interest', MODEL.interestMult[profile.interest]]);
  }
  return out;
}

function probability({ alpha, ceiling }, z, logOdds, roundCeiling) {
  // Early rounds use a higher ceiling but keep the same low-end odds ratio.
  const c = roundCeiling ?? ceiling;
  const shift = Math.log(ceiling / c);
  const f = (d) => clamp(c * sigmoid(alpha + MODEL.beta * z + logOdds + shift + d), MODEL.minP, MODEL.maxP);
  return { p: f(0), low: f(-MODEL.band), high: f(MODEL.band) };
}

function applyAthlete(result, school, profile) {
  if (!has(profile.athlete, school.id)) return result;
  const bump = (p) => {
    if (school.athletics === 'D1') return 1 - (1 - p) * MODEL.athleteD1Remaining;
    const o = odds(p) * MODEL.athleteD3Mult;
    return o / (1 + o);
  };
  return { p: clamp(bump(result.p), 0, MODEL.maxP), low: clamp(bump(result.low), 0, MODEL.maxP), high: clamp(bump(result.high), 0, MODEL.maxP) };
}

export function categoryFor(p) {
  if (p >= 0.35) return { key: 'strong', label: 'Strong odds' };
  if (p >= 0.15) return { key: 'within', label: 'Within reach' };
  if (p >= 0.05) return { key: 'reach', label: 'Reach' };
  return { key: 'long', label: 'Long shot' };
}

// Score one school for one profile.
export function scoreSchool(school, profile, base = profileRatings(profile)) {
  const uc = isUC(school);
  const sat = satEquivalent(profile);
  const policy = school.tests?.policy;
  const hasRank = isNum(Number(profile.rankPct)) && Number(profile.rankPct) > 0;
  const hasInterview = base.interview != null;

  const ratings = { ...base, gpa: uc ? base.ucGpa : base.gpa, tests: null };
  const supplementGrades = supplementDims(profile.supplements?.[school.id]);
  if (supplementGrades) ratings.essays = essayRating(profile, school.id);

  // Work out which testing scenario applies.
  let testUsed = false;
  let testFromAP = false;
  let testAdvice = null;
  let missingTest = false;
  if (!uc) {
    if (sat != null) {
      ratings.tests = testRatingFor(sat, school.tests.sat);
      testUsed = true;
    } else if (policy === 'flexible' && Number(profile.collegeCourses) >= 3 && Number(profile.apAvg) > 0) {
      ratings.tests = interp(Number(profile.apAvg), AP_SCORE_POINTS);
      testUsed = true;
      testFromAP = true;
    } else if (policy === 'required' || policy === 'flexible') {
      missingTest = true;
    }
  }

  const weightsWith = schoolWeights(school, { hasRank, hasInterview, testUsed, testFromAP });
  let { R } = composite(ratings, weightsWith);
  let weights = weightsWith;

  if (policy === 'optional') {
    const weightsWithout = schoolWeights(school, { hasRank, hasInterview, testUsed: false });
    const without = composite(ratings, weightsWithout).R - MODEL.testOptionalPenalty;
    // Counselors' rule of thumb: send scores at or above the middle of the
    // range, or above the 25th percentile when they help the overall read.
    const [p25, p75] = school.tests.sat;
    const worthSending = testUsed && (sat >= (p25 + p75) / 2 || (sat >= p25 && R >= without));
    if (!worthSending) {
      testAdvice = testUsed ? 'withhold' : 'none';
      R = without;
      weights = weightsWithout;
      ratings.tests = testUsed ? ratings.tests : null;
    } else {
      testAdvice = 'submit';
    }
  }

  const cal = calibration(school, profile);
  const z = (R - 5) / MODEL.poolSd + (school.poolShift || 0);

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const contributions = COMPONENTS.map(([key, label]) => {
    const w = weights[key] || 0;
    const r = ratings[key];
    const used = w > 0 && r != null;
    return {
      key,
      label: key === 'essays' && supplementGrades ? 'Essays + your supplements' : label,
      rating: r,
      weight: used ? w / totalWeight : 0,
      logOdds: used ? (MODEL.beta * (w / totalWeight) * (r - 5)) / MODEL.poolSd : 0,
      used,
    };
  });

  const gate = MODEL.gradeGate;
  const gpaShortfall = ratings.gpa == null ? 0 : Math.max(0, gate.threshold - ratings.gpa);
  const gradeGate = gpaShortfall > 0 ? Math.exp(-(uc ? gate.ucSlope : gate.slope) * gpaShortfall) : 1;

  const round = (which) => {
    const adj = adjustments(school, profile, which);
    if (gradeGate < 1) adj.unshift(['Grades below the usual admit range', gradeGate]);
    const logOdds = adj.reduce((s, [, m]) => s + Math.log(m), 0);
    const roundCeiling = which === 'early' ? ceilingFor(school.early.rate) : undefined;
    const res = applyAthlete(probability(cal, z, logOdds, roundCeiling), school, profile);
    return { ...res, adjustments: adj, category: categoryFor(res.p) };
  };

  const zero = { p: 0, low: 0, high: 0, adjustments: [], category: { key: 'blocked', label: 'Test required' } };
  const rd = missingTest ? zero : round('rd');
  const early = school.early ? (missingTest ? zero : round('early')) : null;

  return {
    school,
    R,
    z,
    rd,
    early,
    ratings,
    weights,
    contributions,
    testAdvice,
    missingTest,
    testFromAP,
    calibration: cal,
    earlyMult: earlyMultiplier(school),
    athlete: has(profile.athlete, school.id),
    supplementGrades,
  };
}

export function scoreAll(profile, schools = SCHOOLS) {
  const base = profileRatings(profile);
  return schools.map((s) => scoreSchool(s, profile, base));
}

// ---------------------------------------------------------------- profile summary

const REFERENCE_SCHOOL = {
  id: 'reference',
  tests: { policy: 'required', sat: [1490, 1560] },
  c7: { rigor: 3, rank: 1, gpa: 3, tests: 2, essay: 3, recs: 3, interview: 1, ecs: 3, talent: 2, character: 3, firstGen: 1, alumni: 1, geography: 1, volunteer: 1, work: 1, interest: 0 },
  interview: 'informational',
};

export function describeRating(r) {
  if (r == null) return '—';
  if (r >= 9) return 'Exceptional';
  if (r >= 7.5) return 'Outstanding';
  if (r >= 6) return 'Strong';
  if (r >= 4.5) return 'Typical for this pool';
  if (r >= 3) return 'Below this pool';
  return 'Weak for this pool';
}

const TIPS = {
  gpa: 'Grades carry the most weight everywhere. Protect senior-year grades; colleges see first-semester senior marks before deciding.',
  rigor: 'Take the most demanding courses your school offers in your strongest areas. Counselors check a box comparing your schedule to what was available.',
  tests: 'A higher SAT/ACT moves you most at test-required schools. Retesting is worth it if you are below a school\'s middle-50% range.',
  activities: 'Depth beats breadth. Grow one or two activities into state-level results or leadership with measurable impact instead of adding new clubs.',
  honors: 'Enter competitions with real selection (olympiads, Scholastic Art & Writing, science fairs, all-state ensembles) in your strongest area.',
  resume: 'A mentored research project, a meaningful job, or a highly selective free summer program (RSI, TASP, SSP, PROMYS, Ross) strengthens your file.',
  essays: 'Revise for specific scenes and honest reflection. Readers remember one vivid story, not a list of accomplishments.',
  recs: 'Ask teachers who have seen you lead discussion or go beyond the assignment, and give them a short brag sheet with concrete examples.',
  interview: 'Prepare two or three stories about what you would do on campus; ask the interviewer about their own experience.',
  personal: 'Character shows up in essays, recommendations and sustained service. Show how you treat people, not only what you have achieved.',
};

export function profileSummary(profile) {
  const base = profileRatings(profile);
  const ref = scoreSchool({ ...REFERENCE_SCHOOL, rd: { rate: 0.05 }, legacy: 'none', majors: {} }, profile, base);
  const comps = ref.contributions.filter((c) => c.rating != null && (c.used || c.key === 'tests'));
  const improvements = comps
    .filter((c) => c.used && c.rating < 9.3)
    .map((c) => ({ ...c, gain: c.weight * (Math.min(c.rating + 1.5, 9.5) - c.rating) }))
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3)
    .map((c) => ({ key: c.key, label: c.label, tip: TIPS[c.key] }));
  return { R: ref.R, components: ref.contributions, improvements, spike: base.spike };
}

// Overall reader-style band for a composite rating.
export function readerBand(R) {
  if (R >= 8.3) return { label: 'Exceptional file', detail: 'Reads like a top-tier admit at every school on this list.' };
  if (R >= 7.2) return { label: 'Highly competitive', detail: 'Matches or exceeds the typical admit at most top-20 schools.' };
  if (R >= 6.2) return { label: 'Competitive', detail: 'Stronger than most applicants, close to the typical admit.' };
  if (R >= 5) return { label: 'Typical applicant', detail: 'In line with the large pool of qualified applicants these schools turn away.' };
  return { label: 'Below the usual pool', detail: 'Most admits to these schools present a noticeably stronger file.' };
}

// Early-round strategy notes for the chosen early school.
export function earlyPlanNotes(results, earlyId) {
  const notes = [];
  const gains = results
    .filter((r) => r.early && !r.missingTest)
    .map((r) => ({ id: r.school.id, short: r.school.short, plan: r.school.early.plan, gain: r.early.p - r.rd.p, p: r.early.p }))
    .sort((a, b) => b.gain - a.gain);
  const chosen = results.find((r) => r.school.id === earlyId);
  if (chosen && chosen.school.early) {
    const e = chosen.school.early;
    if (e.binding) notes.push(`${chosen.school.short} Early Decision is binding: if admitted you must withdraw other applications. You may still apply to non-binding Early Action schools such as MIT.`);
    else if (e.restrictive) notes.push(`${chosen.school.short} ${e.plan} is restrictive: you generally may not apply early to other private colleges. Non-binding early action at public universities is usually allowed; check each school's rules.`);
    if (chosen.school.id === 'caltech') notes.push('Caltech reports almost no difference between early and regular admit rates.');
  }
  return { bestGains: gains.slice(0, 3), notes };
}
