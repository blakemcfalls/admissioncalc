# Top 20 Admit Odds

An admission-chance calculator for the 22 universities ranked No. 20 or better in the
**U.S. News & World Report 2027 Best National Universities** list (released September 2026;
UC Berkeley, UCLA and Notre Dame tie at No. 20).

You enter your application the way an admissions reader sees it — grades and coursework, test
scores, a Common App–style activities list, honors, a resume of research/work/programs, essays,
recommendations, interview, background and ties to specific schools — and the calculator returns a
regular-decision and early-round chance for every school, a likely range, what moved your odds,
and strategy notes (where applying early helps most, where to apply test-optional).

You can also **upload files instead of typing**: drop a resume, Common App activities list, honors
list or essay (PDF, Word .docx, RTF or text) and the calculator fills in the activities, honors,
resume fields and personal statement. Essays are **graded** on a 1–5 rubric, and each school's
detail panel lets you add that school's **supplemental essays**; graded supplements feed that
school's estimate.

It also includes a **School data** section summarizing how hard each school is to get into, with
sources, and a **How it works** section documenting the model.

> These are estimates built from published admissions data, not predictions. Every school here
> admits fewer than 13% of applicants overall, so treat all of them as reaches.

## Run it

No dependencies or build step are needed to use the app.

```sh
npm start            # serves the folder at http://localhost:8000
```

Opening `index.html` straight from disk won't work because browsers block ES modules on `file://`.
For a single file you can open offline or host anywhere:

```sh
npm run build        # writes dist/top20-admit-odds.html (self-contained)
```

The folder can be published as-is with GitHub Pages.

```sh
npm test             # model unit tests (node:test, Node 18+)
```

## What it takes into account

| Part of the application | How it is entered | How it is rated |
|---|---|---|
| Grades & rank | Unweighted GPA (4.0 or 100-point), class rank, grade trend; optional UC capped weighted GPA | Against the applicant pool; blended with rank when your school ranks; UC GPA estimated from honors courses when blank |
| Course rigor | The counselor's school-report checkbox, number of AP/IB HL/dual-enrollment courses, AP exam average, courses beyond the curriculum | Count is not held against students whose schools offer few advanced courses |
| Test scores | SAT or ACT (converted with the 2018 concordance) | Against each school's middle-50% range; gains flatten near 1600; test-blind at the UCs; Yale accepts AP scores |
| Activities | Up to 10, with Common App category, impact tier (1 national → 4 member), years and hours/week | Top activity 60%, next two 25%, rest 15% — depth over breadth |
| Honors | Up to 5, by level (international → school) | Highest honor counts most |
| Resume | Research, selective summer programs, paid work/family duties, internships, ventures, portfolios | Pay-to-attend programs add almost nothing |
| Essays | Rubric for voice, specificity, insight, craft, school fit and supplements; optional local essay check | Self-assessment, with a local checker for length, clichés and vague writing |
| Recommendations | The teacher-evaluation scale ("good" → "top few in my career") for two teachers and the counselor | Not used at the UCs |
| Interview | Not done / weak / average / strong / exceptional | Only where the school offers interviews |
| Personal qualities | Derived from essays, recommendations, interview, leadership, service and work | Plus context for significant hardship |
| Context & hooks | Residency, intended major, first-gen, low-income, rural, demonstrated interest, legacy / recruited athlete / donor ties per school, early-round choice | Odds multipliers grounded in published data (below) |

## File import and essay grading

- Files are read in the browser. PDFs use [pdf.js](https://mozilla.github.io/pdf.js/) and Word files
  use [mammoth](https://github.com/mwilliamson/mammoth.js), both loaded from jsDelivr only when
  you upload that type of file.
- Activities lists laid out as a table (one row per activity with columns such as #, Type,
  Position, Organization, Description, Grades, Hours) are read row by row, from Word tables or
  tab/comma-separated text. The whole list replaces the current one in the file's order; types map
  to Common App categories, grade spans to years, and missing hours are estimated and flagged.
- Without Claude, a pattern-based parser ([`js/importer.js`](js/importer.js)) finds resume
  sections and infers each activity's tier, category, years and hours, each honor's level, and the
  research / summer program / work / internship / venture fields. A pattern-based grader
  ([`js/grader.js`](js/grader.js)) scores voice, specificity, insight, craft, school fit (school
  names, courses, programs; a different school's name scores 1) and how well a supplement uses the
  prompt's key words. It cannot judge meaning, so it labels itself an automatic estimate.
- When the page runs as a Claude artifact with the `sample` capability, files (including photos of
  a page) are read by Claude and essays are graded by Claude on the same rubric, using the viewer's
  Claude account. Anything Claude returns is clamped to the calculator's allowed values.
- Grading the personal statement sets the four personal-statement sliders. Graded supplements for a
  school replace the general "school fit" and "supplements" sliders for that school only.

## How the estimate works

1. **Ratings.** Each part becomes a 0–10 rating where 5 is a typical applicant to a top-20 school
   and about 7.5 is a typical admit. The reader's card also shows each one on the 1–6 scale
   Harvard's readers use (1 is best), as revealed in *SFFA v. Harvard*.
2. **School weights.** Each school weights the ratings by its Common Data Set section C7 grid
   (very important = 3, important = 2, considered = 1, not considered = 0). MIT rates only character
   "very important"; Harvard and Princeton rate nearly everything "very important"; the UCs ignore
   test scores and recommendations.
3. **Calibration.** For each school the model assumes the weighted ratings of its applicants follow
   a bell curve and solves for the logistic curve whose average across that pool equals the
   school's regular-decision admit rate with hooked applicants removed (recruited athletes,
   legacies and donor cases were ~5% of Harvard's applicants but ~30% of admits). A ceiling keeps
   even a perfect file below roughly 40–60% at the most selective schools. A grade gate adds a
   penalty when grades fall below the usual admit range.
4. **Odds adjustments.**
   - Early rounds: (early odds ÷ RD odds) raised to 0.55 for binding ED, 0.4 for restrictive EA and
     0.3 for open EA, capped at ×2.6, because early pools are full of recruited athletes and legacies.
   - Legacy ×3 / ×2 / ×1.4 by how much the school weighs it (+25% when applying early); none at MIT,
     Caltech, Stanford, Johns Hopkins, Carnegie Mellon or the UCs. Donor ties ×2.5 where allowed.
   - Recruited Division I athletes: at least 85%; Division III: ×4.
   - First-gen ×1.3, low-income ×1.25 (combined at most ×1.5), rural ×1.15, international ×0.6 at
     private schools (published residency rates at the UCs).
   - Intended major where admission is by program (UCLA CS 3%, Berkeley CS 7%, CMU SCS ~5%),
     plus a smaller fit estimate for non-STEM interests at MIT and Caltech.
   - Demonstrated interest only at Duke, Dartmouth, Northwestern, Rice and WashU.
5. **Range.** The likely range adds and subtracts 0.6 in log-odds for the uncertainty in rating
   your own essays and recommendations.

All parameters live in `MODEL` at the top of [`js/model.js`](js/model.js).

## How hard is each school to get into?

Latest published figures as of October 2026 (Class of 2030 where released, otherwise the
2025–26 Common Data Set for the Class of 2029). "est." marks figures a school has not published.

| Rank | School | Admit rate (class) | Early round | Regular decision | SAT middle 50% | Testing 2026–27 | Legacy |
|---:|---|---|---|---|---|---|---|
| 1 | Massachusetts Institute of Technology | 4.6% (2030) | EA 5.5% | 3.9% (est.) | 1520–1570 | Required | No |
| 2 | Princeton University | 4.0% (2030) | SCEA 14.0% (est.) | 3.1% (est.) | 1490–1560 | Optional | Yes, significant |
| 3 | Harvard University | 4.2% (2029) | REA 8.7% (est.) | 2.8% (est.) | 1510–1580 | Required | Yes, significant |
| 4 | Yale University | 4.2% (2030) | SCEA 10.9% | 2.9% (est.) | 1480–1560 | Test-flexible | Yes, significant |
| 5 | California Institute of Technology | 3.8% (2029) | REA 3.8% (est.) | 3.7% (est.) | 1550–1580 | Required | No |
| 5 | Stanford University | 3.8% (2029) | REA 7.5% (est.) | 3.1% (est.) | 1520–1570 | Required | No |
| 7 | University of Pennsylvania | 4.9% (2029) | ED 13.3% | 3.7% | 1510–1570 | Required | Yes, significant |
| 8 | Duke University | 4.7% (2030) | ED 13.8% | 3.7% | 1510–1570 | Optional | Yes, significant |
| 9 | Johns Hopkins University | 6.1% (2029) | ED 10.9% | 4.8% (est.) | 1530–1565 | Required | No |
| 9 | Northwestern University | 7.4% (2029) | ED 20% (est.) | 5.3% (est.) | 1510–1560 | Optional | Yes |
| 9 | University of Chicago | 4.5% (2029) | ED 20% (est.) | 2.5% (est.) | 1500–1560 | Optional | Yes |
| 12 | Columbia University | 4.2% (2030) | ED 14.0% | 3.2% (est.) | 1510–1560 | Optional | Yes |
| 12 | Dartmouth College | 5.9% (2030) | ED 17.1% | 4.4% | 1440–1550 | Required | Yes, significant |
| 14 | Carnegie Mellon University | 11.1% (2029) | ED 17.0% (est.) | 10.0% (est.) | 1500–1560 | Required | No |
| 14 | Cornell University | 9.2% (2030) | ED 18.8% | 6.7% | 1490–1550 | Required | Yes |
| 16 | Brown University | 5.3% (2030) | ED 16.5% | 3.9% | 1470–1550 | Required | Yes |
| 16 | Rice University | 7.7% (2030) | ED 13.2% | 7.3% | 1510–1560 | Optional | Yes, minor |
| 16 | Vanderbilt University | 4.1% (2030) | ED 11.9% | 3.0% (est.) | 1510–1560 | Optional | Yes |
| 16 | Washington University in St. Louis | 12.2% (2030) | ED 25% | 8.0% (est.) | 1500–1550 | Optional | Yes, minor |
| 20 | University of California, Berkeley | 10.5% (2030) | — | CA 12.4% · U.S. 10.0% · intl 5.4% | — | Test-blind | No |
| 20 | University of California, Los Angeles | 10.8% (2030) | — | CA 10.2% · U.S. 14.9% · intl 8.1% | — | Test-blind | No |
| 20 | University of Notre Dame | 9.0% (2030) | REA 11.8% | 7.3% (est.) | 1460–1540 | Optional | Yes, significant |

Highlights from the research:

- **Early rounds** admit two to five times the regular rate (Duke 13.8% vs 3.7%, Brown 16.5% vs
  3.9%, Penn 13.3% vs 3.7%, Yale 10.9% vs ~2.9%). Caltech reports no meaningful difference.
- **Testing is back.** Ten schools require the SAT/ACT for 2026–27; Princeton, Columbia and Notre
  Dame return to requiring it in 2027–28 and Vanderbilt in 2028–29. The UCs are test-blind.
- **Hooks matter.** In Harvard's court-released data, recruited athletes were admitted at 86%,
  children of faculty at 47%, dean's-interest applicants at 42% and legacies at 34%, against under
  5.5% for everyone else. Even the top academic-index decile was admitted at only ~13–15%.
- **Legacy is fading.** California's AB 1780 bans legacy and donor preferences at Stanford and
  Caltech; Johns Hopkins (2020) and Carnegie Mellon (2023) dropped it; MIT never used it.
- **Major matters at program-based schools**: UCLA CS 3%, Berkeley CS 7%, CMU's School of Computer
  Science turns away ~95%.
- **Demonstrated interest** counts at Duke, Dartmouth, Northwestern, Rice and WashU (reinstated for
  2026–27, along with a new Early Action round), not at Harvard, Yale, Princeton, Stanford, MIT,
  Vanderbilt or Carnegie Mellon.

Each school's profile in the app lists its sources.

## Limitations

- Essays and recommendations are self-assessed and are the hardest parts to judge from the inside.
- Several schools (Harvard, Princeton, Stanford, UChicago, Caltech) no longer publish round-level
  data; those inputs are third-party estimates and marked as such.
- Where a school's full C7 grid could not be confirmed, levels are estimated from peer schools and
  labeled in the app.
- Institutional priorities that shift each year (class size by major, gender balance, regional
  quotas, yield) are not modeled.
- Race and ethnicity cannot be considered since the 2023 SFFA decision, so the calculator does not
  ask.
- Not affiliated with any university or with U.S. News.

## Project layout

```
index.html            page markup
css/styles.css        styles (light and dark themes)
js/schools.js         school data, policies, C7 grids and sources
js/model.js           rating, calibration and odds model (pure, no DOM)
js/essay-check.js     essay length, cliché and detail checks
js/grader.js          essay and supplement grading (pattern-based, plus the Claude prompt)
js/importer.js        file reading (PDF, Word, RTF, text) and resume/activities parsing
js/app.js             form, results, school data and method views
scripts/build.mjs     bundles everything into dist/top20-admit-odds.html
tests/                unit tests (model, importer, grader) and fixtures
```

## Updating for a new cycle

Each fall, update `RANKING`, `CYCLE` and `DATA_AS_OF` in `js/schools.js`, replace the admit,
early and regular-decision figures and SAT/ACT ranges from the new Common Data Sets and
class-profile announcements, check each school's testing, legacy and early-round policies, and
run `npm test`.
