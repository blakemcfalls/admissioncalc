// A quick, local read of a personal statement. It flags patterns admissions
// readers often mention (length, cliché openings, vague language) but does not
// score the essay; the calculator uses the self-assessment rubric for that.

const CLICHES = [
  'ever since i was',
  'since i was a child',
  'since i was young',
  'dictionary defines',
  "webster's",
  'according to the dictionary',
  'passion for',
  'passionate about',
  'make a difference',
  'change the world',
  'comfort zone',
  'hard work pays off',
  'at the end of the day',
  'the rest is history',
  'outside the box',
  'it was then that i realized',
  'never give up',
  'follow my dreams',
  "in today's society",
  'since the dawn of time',
  'everything happens for a reason',
  'life-changing',
  'life changing',
  'unique perspective',
  'well-rounded',
  'i have always wanted',
  'little did i know',
];

const REFLECTION = [
  'i realized',
  'i learned',
  'taught me',
  'i began to',
  'i understand',
  'i now',
  'i used to',
  'i wonder',
  'changed how i',
  'made me',
];

const count = (text, phrase) => {
  let n = 0;
  let i = text.indexOf(phrase);
  while (i !== -1) {
    n++;
    i = text.indexOf(phrase, i + phrase.length);
  }
  return n;
};

export function checkEssay(raw, { limit = 650 } = {}) {
  const text = (raw || '').trim();
  if (!text) return null;
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => /\w/.test(s));
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length;
  const lower = text.toLowerCase();

  const cliches = CLICHES.filter((c) => lower.includes(c));
  const reflection = REFLECTION.reduce((n, p) => n + count(lower, p), 0);

  // Concrete detail: numbers and capitalised words that do not start a sentence.
  const numbers = (text.match(/\b\d[\d,.:]*\b/g) || []).length;
  let properNouns = 0;
  for (const s of sentences) {
    const ws = s.split(/\s+/).slice(1);
    properNouns += ws.filter((w) => /^[A-Z][a-z]/.test(w) && !/^I('|$)/.test(w)).length;
  }
  const specificity = ((numbers + properNouns) / Math.max(words.length, 1)) * 100;

  const firstWords = words.slice(0, 12).join(' ').toLowerCase();
  const quoteOpening = /^["“']/.test(text);
  const iCount = (text.match(/\bI\b/g) || []).length;
  const avgSentence = words.length / Math.max(sentences.length, 1);

  const notes = [];
  if (words.length > limit) notes.push({ level: 'bad', text: `${words.length} words is over the ${limit}-word limit.` });
  else if (words.length < (limit >= 500 ? 400 : Math.round(limit * 0.6))) notes.push({ level: 'warn', text: `${words.length} words. Strong essays usually use most of the ${limit}-word limit.` });
  else notes.push({ level: 'good', text: `${words.length} words, within the ${limit}-word limit.` });

  if (quoteOpening) notes.push({ level: 'warn', text: 'Opens with a quotation. Readers see this often; starting inside a moment of your own is usually stronger.' });
  if (/dictionary|webster/.test(firstWords)) notes.push({ level: 'warn', text: 'Opens with a definition, one of the most common openings readers report.' });
  if (cliches.length) notes.push({ level: 'warn', text: `Stock phrases to rewrite: ${cliches.map((c) => `"${c}"`).join(', ')}.` });

  if (reflection === 0) notes.push({ level: 'warn', text: 'No clear reflection. Show what you think or do differently because of this story.' });
  else if (reflection > 6) notes.push({ level: 'warn', text: 'Lots of "I learned / I realized" statements. Let a few scenes carry the meaning instead.' });
  else notes.push({ level: 'good', text: 'Includes reflection on what the experience changed.' });

  if (specificity < 1.5) notes.push({ level: 'warn', text: 'Few names, places or numbers. Concrete details make an essay memorable.' });
  else notes.push({ level: 'good', text: 'Uses concrete names, places or numbers.' });

  if (avgSentence > 28) notes.push({ level: 'warn', text: `Average sentence is ${Math.round(avgSentence)} words. Vary length and break up the longest sentences.` });
  if (paragraphs <= 1 && words.length > 250) notes.push({ level: 'warn', text: 'One long block of text. Break it into paragraphs.' });

  return {
    words: words.length,
    sentences: sentences.length,
    paragraphs,
    avgSentence,
    cliches,
    reflection,
    specificity,
    iShare: iCount / Math.max(words.length, 1),
    notes,
  };
}
