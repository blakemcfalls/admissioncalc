import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCHOOLS, C7_FACTORS } from '../js/schools.js';
import {
  MODEL, scoreAll, scoreSchool, profileSummary, actToSat, satEquivalent, gpaOn4,
  testRatingFor, calibrateAlpha, ceilingFor, earlyMultiplier, categoryFor,
} from '../js/model.js';
import { checkEssay } from '../js/essay-check.js';

const act = (tier, years = 3, hours = 6, category = 'Other Club/Activity') => ({ name: 'Activity', tier, years, hours, category });

const TYPICAL = {
  gpaScale: '4', gpa: 3.88, rankPct: 10, rigor: 'very', collegeCourses: 8, apAvg: 4.2, trend: 'steady',
  testType: 'sat', testScore: 1470,
  activities: [act(3), act(4), act(4), act(4, 2, 3), act(4, 2, 2), act(4, 1, 2), act(3, 2, 3, 'Community Service (Volunteer)')],
  honors: [{ name: 'Honor', level: 'school' }, { name: 'Honor', level: 'school' }, { name: 'Honor', level: 'regional' }],
  research: 'none', program: 'open', workHours: 0, internship: 'none', venture: 'none', portfolio: 'none',
  essay: { voice: 3, specificity: 3, reflection: 3, craft: 3, fit: 3, supplements: 3 },
  recs: { teacher1: 'excellent', teacher2: 'verygood', counselor: 'verygood' },
  interview: 'average', interest: 'some', residency: 'us', major: 'undecided',
  legacy: [], athlete: [], donor: [],
};

const STRONG = {
  ...TYPICAL, gpa: 4.0, rankPct: 2, rigor: 'most', collegeCourses: 12, apAvg: 4.8, testScore: 1560,
  activities: [act(2, 4, 10), act(2, 3, 6), act(3, 4, 5, 'Community Service (Volunteer)'), act(3, 3, 4), act(3, 2, 4), act(4), act(4), act(4)],
  honors: [{ name: 'Honor', level: 'national' }, { name: 'Honor', level: 'state' }, { name: 'Honor', level: 'state' }, { name: 'Honor', level: 'school' }],
  research: 'mentored', program: 'selective',
  essay: { voice: 4, specificity: 4, reflection: 4, craft: 4, fit: 4, supplements: 4 },
  recs: { teacher1: 'outstanding', teacher2: 'outstanding', counselor: 'excellent' },
  interview: 'strong',
};

const byId = (results, id) => results.find((r) => r.school.id === id);

test('covers the 22 schools ranked No. 20 or better', () => {
  assert.equal(SCHOOLS.length, 22);
  assert.equal(new Set(SCHOOLS.map((s) => s.id)).size, 22);
  for (const s of SCHOOLS) {
    assert.ok(s.rank >= 1 && s.rank <= 20, `${s.id} rank`);
    assert.ok(s.admit.rate > 0 && s.admit.rate < 0.15, `${s.id} admit rate`);
    assert.ok(s.rd.rate > 0 && s.rd.rate < 0.2, `${s.id} RD rate`);
    if (s.early) assert.ok(s.early.rate > 0 && s.early.rate < 0.4, `${s.id} early rate`);
    for (const [k] of C7_FACTORS) assert.ok([0, 1, 2, 3].includes(s.c7[k]), `${s.id} c7.${k}`);
    assert.ok(s.sources.length > 0, `${s.id} sources`);
    assert.ok(['required', 'optional', 'flexible', 'blind'].includes(s.tests.policy), `${s.id} policy`);
  }
  assert.equal(SCHOOLS.filter((s) => s.rank === 20).length, 3);
});

test('2026–27 testing policies match the published counts', () => {
  const count = (p) => SCHOOLS.filter((s) => s.tests.policy === p).length;
  assert.equal(count('required'), 10);
  assert.equal(count('flexible'), 1);
  assert.equal(count('optional'), 9);
  assert.equal(count('blind'), 2);
});

test('ACT concordance and score parsing', () => {
  assert.equal(actToSat(36), 1590);
  assert.equal(actToSat(34), 1500);
  assert.equal(satEquivalent({ testType: 'act', testScore: 35 }), 1540);
  assert.equal(satEquivalent({ testType: 'sat', testScore: 1500 }), 1500);
  assert.equal(satEquivalent({ testType: 'sat', testScore: 2400 }), null);
  assert.equal(satEquivalent({ testType: 'none', testScore: 1500 }), null);
});

test('100-point averages convert to the 4.0 scale', () => {
  assert.equal(gpaOn4({ gpaScale: '100', gpa: 97 }), 4);
  assert.ok(Math.abs(gpaOn4({ gpaScale: '100', gpa: 91 }) - 3.6) < 1e-9);
  assert.equal(gpaOn4({ gpaScale: '4', gpa: 4.3 }), 4);
});

test('test rating is relative to each school range', () => {
  assert.ok(testRatingFor(1500, [1460, 1540]) > testRatingFor(1500, [1520, 1570]));
  assert.ok(testRatingFor(1600, [1520, 1570]) <= 9.5);
  assert.ok(testRatingFor(1545, [1520, 1570]) === 7);
});

test('calibration reproduces each school base rate across its applicant pool', () => {
  for (const rate of [0.025, 0.05, 0.1]) {
    const c = ceilingFor(rate);
    const alpha = calibrateAlpha(rate, c);
    let mean = 0;
    let total = 0;
    for (let z = -5; z <= 5; z += 0.01) {
      const w = Math.exp(-(z * z) / 2);
      mean += w * c / (1 + Math.exp(-(alpha + MODEL.beta * z)));
      total += w;
    }
    assert.ok(Math.abs(mean / total - rate) < rate * 0.02, `rate ${rate}: got ${mean / total}`);
  }
});

test('probabilities are valid and ranges bracket the estimate', () => {
  for (const profile of [TYPICAL, STRONG]) {
    for (const r of scoreAll(profile)) {
      for (const round of [r.rd, r.early].filter(Boolean)) {
        assert.ok(round.p >= 0 && round.p <= 1);
        assert.ok(round.low <= round.p + 1e-12 && round.p <= round.high + 1e-12, `${r.school.id} range`);
      }
    }
  }
});

test('a typical applicant is near or below each school base rate; a strong one is well above', () => {
  const typical = scoreAll(TYPICAL);
  const strong = scoreAll(STRONG);
  assert.ok(byId(typical, 'harvard').rd.p < 0.02);
  const h = byId(strong, 'harvard').rd.p;
  assert.ok(h > 0.08 && h < 0.3, `strong Harvard RD ${h}`);
  for (const s of SCHOOLS) {
    assert.ok(byId(strong, s.id).rd.p > byId(typical, s.id).rd.p, s.id);
  }
});

test('better inputs never lower a chance', () => {
  const variants = [
    { gpa: 3.97 },
    { testScore: 1540 },
    { essay: { ...TYPICAL.essay, voice: 5, specificity: 5 } },
    { recs: { ...TYPICAL.recs, teacher1: 'top' } },
    { honors: [...TYPICAL.honors, { name: 'Olympiad', level: 'national' }] },
    { research: 'presented' },
    { rigor: 'most' },
  ];
  const base = scoreAll(TYPICAL);
  for (const v of variants) {
    const better = scoreAll({ ...TYPICAL, ...v });
    for (const s of SCHOOLS) {
      assert.ok(byId(better, s.id).rd.p >= byId(base, s.id).rd.p - 1e-12, `${JSON.stringify(v)} at ${s.id}`);
    }
  }
});

test('lower grades trigger the grade gate', () => {
  const low = scoreAll({ ...STRONG, gpa: 3.5, rankPct: '' });
  const h = byId(low, 'harvard');
  assert.ok(h.rd.adjustments.some(([label]) => /Grades below/.test(label)));
  assert.ok(h.rd.p < byId(scoreAll(STRONG), 'harvard').rd.p / 2);
});

test('early rounds help, except at Caltech where they are neutral', () => {
  for (const r of scoreAll(STRONG)) {
    if (!r.early) continue;
    assert.ok(r.early.p >= r.rd.p, r.school.id);
    assert.ok(earlyMultiplier(r.school) <= MODEL.earlyMultCap);
  }
  const caltech = SCHOOLS.find((s) => s.id === 'caltech');
  assert.ok(earlyMultiplier(caltech) < 1.05);
});

test('legacy only counts where the school considers it', () => {
  const ids = SCHOOLS.map((s) => s.id);
  const base = scoreAll(TYPICAL);
  const legacy = scoreAll({ ...TYPICAL, legacy: ids });
  for (const s of SCHOOLS) {
    const before = byId(base, s.id).rd.p;
    const after = byId(legacy, s.id).rd.p;
    if (s.legacy === 'none') assert.equal(after, before, s.id);
    else assert.ok(after > before, s.id);
  }
});

test('recruited Division I athletes land at 85% or more', () => {
  const r = byId(scoreAll({ ...TYPICAL, athlete: ['harvard', 'mit'] }), 'harvard');
  assert.ok(r.rd.p >= 0.85);
  const mit = byId(scoreAll({ ...TYPICAL, athlete: ['mit'] }), 'mit');
  assert.ok(mit.rd.p < 0.85 && mit.rd.p > byId(scoreAll(TYPICAL), 'mit').rd.p);
});

test('missing scores block test-required schools only', () => {
  const results = scoreAll({ ...TYPICAL, testType: 'none', testScore: '', apAvg: '' });
  for (const r of results) {
    const policy = r.school.tests.policy;
    assert.equal(r.missingTest, policy === 'required' || policy === 'flexible', r.school.id);
  }
});

test('Yale accepts AP scores in place of the SAT', () => {
  const yale = byId(scoreAll({ ...TYPICAL, testType: 'none', testScore: '', apAvg: 4.6 }), 'yale');
  assert.equal(yale.missingTest, false);
  assert.equal(yale.testFromAP, true);
});

test('test-optional advice withholds low scores and sends strong ones', () => {
  assert.equal(byId(scoreAll({ ...TYPICAL, testScore: 1400 }), 'duke').testAdvice, 'withhold');
  assert.equal(byId(scoreAll({ ...TYPICAL, testScore: 1570 }), 'duke').testAdvice, 'submit');
});

test('UC campuses ignore test scores and use residency admit rates', () => {
  const a = byId(scoreAll({ ...TYPICAL, testScore: 1200 }), 'ucla');
  const b = byId(scoreAll({ ...TYPICAL, testScore: 1600 }), 'ucla');
  assert.equal(a.rd.p, b.rd.p);
  const ca = byId(scoreAll({ ...TYPICAL, residency: 'ca' }), 'berkeley');
  const intl = byId(scoreAll({ ...TYPICAL, residency: 'intl' }), 'berkeley');
  assert.ok(ca.rd.p > intl.rd.p);
  assert.equal(a.early, null);
});

test('competitive majors lower the odds where admission is by program', () => {
  const und = byId(scoreAll(TYPICAL), 'cmu').rd.p;
  const cs = byId(scoreAll({ ...TYPICAL, major: 'cs' }), 'cmu').rd.p;
  assert.ok(cs < und * 0.6);
  const uclaCs = byId(scoreAll({ ...TYPICAL, major: 'cs' }), 'ucla').rd.p;
  assert.ok(uclaCs < byId(scoreAll(TYPICAL), 'ucla').rd.p);
});

test('demonstrated interest matters only where it is considered', () => {
  const none = scoreAll({ ...TYPICAL, interest: 'none' });
  const some = scoreAll(TYPICAL);
  assert.ok(byId(none, 'duke').rd.p < byId(some, 'duke').rd.p);
  assert.equal(byId(none, 'harvard').rd.p, byId(some, 'harvard').rd.p);
});

test('blank activity rows are ignored', () => {
  const withBlank = { ...TYPICAL, activities: [...TYPICAL.activities, { name: '', tier: 1, years: 4, hours: 20 }] };
  assert.equal(scoreSchool(SCHOOLS[0], withBlank).rd.p, scoreSchool(SCHOOLS[0], TYPICAL).rd.p);
});

test('profile summary lists the biggest levers', () => {
  const s = profileSummary(TYPICAL);
  assert.ok(s.R > 4 && s.R < 6, `typical R ${s.R}`);
  assert.equal(s.improvements.length, 3);
  assert.ok(profileSummary(STRONG).R > 7);
});

test('categories', () => {
  assert.equal(categoryFor(0.01).key, 'long');
  assert.equal(categoryFor(0.1).key, 'reach');
  assert.equal(categoryFor(0.2).key, 'within');
  assert.equal(categoryFor(0.5).key, 'strong');
});

test('essay check flags length, clichés and missing reflection', () => {
  const essay = 'Ever since I was young I had a passion for science. '.repeat(10);
  const r = checkEssay(essay);
  assert.equal(r.words, 110);
  assert.ok(r.cliches.includes('ever since i was'));
  assert.ok(r.notes.some((n) => /Stock phrases/.test(n.text)));
  assert.ok(r.notes.some((n) => /No clear reflection/.test(n.text)));
  assert.equal(checkEssay(''), null);
  const long = checkEssay('word '.repeat(700));
  assert.ok(long.notes.some((n) => n.level === 'bad'));
});
