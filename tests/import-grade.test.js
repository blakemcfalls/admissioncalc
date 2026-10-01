import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parseProfileText, classifyText, inferYears, inferHours, inferTier, inferHonorLevel,
  sanitizeImport, mergeList, mergeResume, rtfToText,
} from '../js/importer.js';
import { gradeEssay, normalizeGrade, otherSchoolsMentioned } from '../js/grader.js';
import { scoreAll, supplementDims } from '../js/model.js';

const resume = readFileSync(new URL('./fixtures/resume.txt', import.meta.url), 'utf8');
const essay = readFileSync(new URL('./fixtures/essay.txt', import.meta.url), 'utf8');

test('classifies resumes and essays', () => {
  assert.equal(classifyText(resume), 'list');
  assert.equal(classifyText(essay), 'essay');
});

test('parses activities, honors and resume fields from a resume', () => {
  const r = parseProfileText(resume);
  const names = r.activities.map((a) => a.name);
  assert.deepEqual(names, [
    'Debate Team Captain',
    'Founder, Math for All Tutoring Club',
    'Research Assistant, State University Neuroscience Lab',
    'Varsity Tennis',
    'Barista, Corner Bakery',
    'Hospital Volunteer, Springfield General',
  ]);
  const debate = r.activities[0];
  assert.equal(debate.category, 'Debate/Speech');
  assert.equal(debate.years, 4);
  assert.equal(debate.hours, 8);
  assert.equal(debate.tier, 2);
  assert.equal(r.activities.find((a) => a.name.startsWith('Barista')).category, 'Work (Paid)');
  assert.ok(!names.some((n) => /JORDAN|Springfield High/.test(n)), 'skips the header and education');
  assert.deepEqual(r.honors.map((h) => h.level), ['national', 'national', 'state', 'school']);
  assert.equal(r.resume.research, 'presented');
  assert.equal(r.resume.program, 'elite');
  assert.equal(r.resume.workHours, '6');
});

test('a forced kind still skips the name block above the first heading', () => {
  const r = parseProfileText(resume, 'resume');
  assert.ok(!r.activities.some((a) => /JORDAN/.test(a.name)));
});

test('a headingless list is read as the requested kind', () => {
  const honors = parseProfileText('USAMO Qualifier\nAll-State Orchestra\nHonor Roll', 'honors').honors;
  assert.deepEqual(honors.map((h) => h.level), ['national', 'state', 'school']);
});

test('field inference', () => {
  assert.equal(inferYears('Grades 10, 11, 12, 10 hrs/week'), 3);
  assert.equal(inferYears('2024–present'), new Date().getFullYear() - 2024 + 1 > 4 ? 4 : new Date().getFullYear() - 2024 + 1);
  assert.equal(inferHours('about 12 hours per week'), 12);
  assert.equal(inferTier('National champion, USA Debate'), 1);
  assert.equal(inferTier('Member, chess club'), 4);
  assert.equal(inferTier('Treasurer, Key Club'), 3);
  assert.equal(inferHonorLevel('National Merit Commended Student'), 'regional');
  assert.equal(inferHonorLevel('AP Scholar with Distinction'), 'school');
  assert.equal(rtfToText('{\\rtf1\\ansi Hello\\par World}'), 'Hello\nWorld');
});

test('imported data is kept inside allowed values and merged without duplicates', () => {
  const clean = sanitizeImport({
    activities: [{ name: 'Robotics captain', category: 'Made up', tier: 9, years: 12, hours: 300 }, { name: '' }],
    honors: [{ name: 'Gold Key', level: 'galactic' }],
    resume: { research: 'national', program: 'bogus' },
  });
  assert.equal(clean.activities.length, 1);
  assert.equal(clean.activities[0].category, 'Robotics');
  assert.equal(clean.activities[0].years, 4);
  assert.equal(clean.activities[0].hours, 60);
  assert.equal(clean.honors[0].level, 'school');
  assert.equal(clean.resume.program, 'none');
  const merged = mergeList([{ name: 'Robotics Captain' }], clean.activities, 10);
  assert.equal(merged.length, 1);
  assert.deepEqual(mergeResume({ research: 'presented', program: 'none' }, { research: 'project', program: 'open' }), { research: 'presented', program: 'open' });
});

test('essay grading returns rubric scores', () => {
  const g = gradeEssay(essay, { limit: 650 });
  for (const k of ['voice', 'specificity', 'reflection', 'craft', 'overall']) assert.ok(g[k] >= 1 && g[k] <= 5, k);
  assert.equal(g.fit, null);
  const weak = gradeEssay('Ever since I was young I had a passion for science and I want to change the world. '.repeat(6), { limit: 650 });
  assert.ok(weak.overall < g.overall);
});

test('supplement grading checks school fit and wrong-school mentions', () => {
  const why = "At Columbia I want to take Literature Humanities in the Core Curriculum and join a research lab with Professor Lee. The Columbia seminar on urban ecology and the Morningside Heights garden program would let me continue the soil project I began. I would bring my notebook of 40 bakery experiments to the Columbia culinary club.";
  const good = gradeEssay(why, { limit: 150, schoolId: 'columbia', prompt: 'Why Columbia?' });
  const wrong = gradeEssay(why.replace(/Columbia/g, 'Brown University'), { limit: 150, schoolId: 'columbia' });
  assert.ok(good.fit >= 4);
  assert.equal(wrong.fit, 1);
  assert.deepEqual(otherSchoolsMentioned('I love brown rice.', 'columbia'), []);
});

test('graded supplements change only that school', () => {
  const profile = {
    gpaScale: '4', gpa: 3.95, rigor: 'most', collegeCourses: 10, testType: 'sat', testScore: 1540,
    activities: [{ name: 'Debate', tier: 2, years: 4, hours: 8, category: 'Debate/Speech' }], honors: [],
    essay: { voice: 4, specificity: 4, reflection: 4, craft: 4, fit: 2, supplements: 2 },
    recs: {}, interview: 'none', residency: 'us', major: 'undecided', legacy: [], athlete: [], donor: [],
  };
  const strong = normalizeGrade({ fit: 5, quality: 5, responsiveness: 5, source: 'claude' });
  const withSupp = { ...profile, supplements: { columbia: [{ text: 'x', grade: strong }] } };
  const a = scoreAll(profile);
  const b = scoreAll(withSupp);
  const col = (r) => r.find((x) => x.school.id === 'columbia').rd.p;
  const duke = (r) => r.find((x) => x.school.id === 'duke').rd.p;
  assert.ok(col(b) > col(a));
  assert.equal(duke(b), duke(a));
  assert.equal(supplementDims([{ grade: null }]), null);
});
