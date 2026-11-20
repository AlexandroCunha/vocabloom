# Compliance guide (EU / Ireland)

> **This is a practical checklist, not legal advice.** The school (or whoever runs Vocabloom) is responsible for its own compliance and should have it reviewed by its data protection officer or adviser.

## 1. What data does Vocabloom handle?

Vocabloom works with or without an optional shared database (Upstash Redis). The table says what each piece of data is and where it lives. Rows marked **database** exist only if the school switches the database on.

| Data | Where it goes | Kept? |
|---|---|---|
| Teacher's PDF worksheet | Browser → Vocabloom server → AI provider | Not stored by Vocabloom. Handled by the AI provider under its own terms |
| Converted worksheet (exercises as text, never the PDF) | **Database** (or, without one, the memory of a running server instance), under a fingerprint (SHA-256) of the PDF | `CACHE_TTL_DAYS` (7 by default), so converting the same PDF again is free. Can be switched off with `0` |
| Short link and QR code | **Database**, only when a teacher presses "Create short link and QR code" | `SHARE_TTL_DAYS` (90 by default), then deleted |
| Usage counters (requests, wrong codes, conversions per day) | **Database** or the server's memory. Labelled with a keyed hash of the visitor's IP address, never the address, and for daily counts with the teacher's name (for example `anna`) | At most two days |
| School access codes | Set by the school as server settings. Each teacher types theirs; it is sent with each request | In the server's settings; in the teacher's browser tab only (session storage) |
| Worksheet (exercises) in a normal share link | Inside the link itself, after the `#` | Lives in the link. Browsers do not send that part to a server |
| Student name (optional) and answers | Student's own browser (local storage) | Only on the student's device. Never sent to a server |
| Review deck | Student's own browser, **only if the student chooses "Save to my review deck"** | Until the student deletes it. Never sent to a server |
| Recently opened worksheets (title and link) | Student's own browser | Last 8, until the student clears them |
| Offline copy of the app and of worksheets opened through short links | Student's browser (service worker cache) | Until the student clears the site's data |
| Read-aloud | The phone's or browser's voices | See "Read-aloud" below |
| Request logs (IP address, time) | Hosting provider | According to the host's policy |

There are **no accounts, no cookies, no analytics, no advertising and no third-party scripts or fonts.** The database never receives a student's name, answers, score, review deck or reading history.

### Read-aloud

The listen buttons use the voices built into the student's phone or browser, and speak only the worksheet's own text. Vocabloom prefers voices that run on the device. Some browsers also offer an online voice run by the browser's maker; if the student's browser picks one, the text of that question is processed by that company. The privacy notice says so. A school that does not want this can tell students to use a device voice (most phones have one), or ask the maintainer to remove the listen buttons.

## 2. Roles under the GDPR

- **Controller:** the school using Vocabloom (decides why and how data is used).
- **Processors:** the AI provider (receives PDFs), the hosting provider (receives request logs) and, if the database is switched on, the storage provider (keeps cached worksheets, short links and counters). Each needs a **data processing agreement** (Art. 28).
- If you run Vocabloom for several schools, you may be a processor for them. Agree this in writing.

## 3. Checklist before using it with students

- [ ] Complete the privacy notice template in `public/privacy.html` (every `[square bracket]`) and have it reviewed. Check that the retention periods in it match your settings.
- [ ] Choose and write down the **lawful basis** (for a school this is often "public task" or "legitimate interests"; confirm with your adviser).
- [ ] Sign or accept the **data processing agreements** with the AI provider, the hosting provider and, if used, the storage provider.
- [ ] Check **international transfers**. The functions run in Dublin (`vercel.json`: `dub1`); create the database in an EU region too. The AI provider may process data elsewhere: make sure transfer safeguards (for example Standard Contractual Clauses) are in place.
- [ ] Decide whether to switch the **database** on. Without it nothing is stored on a server, but limits are weaker and there are no short links or QR codes. With it, add it to the privacy notice and to the record of processing (section 5).
- [ ] Add Vocabloom to the school's **record of processing activities** (Art. 30). A starting point is in section 5.
- [ ] Decide whether a **Data Protection Impact Assessment** is needed (section 4).
- [ ] Tell teachers: **never upload PDFs that contain personal data** (names, photos, marks).
- [ ] Give each teacher **their own access code** (`ACCESS_CODES`), so one can be withdrawn when someone leaves, without changing the others.
- [ ] Set a **monthly spend limit** in the AI provider's console. The limits in Vocabloom reduce the risk of surprise bills; the provider's limit is the one nothing can bypass.
- [ ] Tell students and parents or guardians how the tool is used (the notice and the school's usual communication). Mention the optional review deck and that it stays on the phone.
- [ ] On **shared or school computers**, tell students to use **Clear everything on this device** (on the home page) when they finish, because answers and a review deck are kept in that browser.
- [ ] Keep `.env` and every access code secret, and out of Git. Change a code if it leaks.
- [ ] Name a contact for privacy questions and security reports (`SECURITY.md`, `security.txt`).

## 4. Do we need a DPIA?

A DPIA (Art. 35) is required when processing is likely to be high risk. Vocabloom is low risk by design: no profiling, no automated decisions, nothing stored about students on a server, and only teaching material is processed. Still, **children** are a vulnerable group and **AI** is involved, so many schools will want a short DPIA anyway. Points to cover:

1. Description: PDFs go to an AI service; worksheets may be cached or stored for short links; students answer in their own browser, which may keep a review deck.
2. Necessity and proportionality: data minimisation is built in (no accounts, the server learns nothing about students, every stored item expires, the review deck is the student's choice).
3. Risks: a teacher uploads personal data by mistake (it could then sit in the cache for its retention period); AI provider retention; a leaked access code; wrong AI answers shown to students; a shared computer keeping a student's answers and review deck.
4. Measures: guidance to teachers, agreements with providers, the teacher review step, per-teacher codes, limits and daily budgets, security headers, EU region, expiry on everything stored, a "clear everything" button for students.
5. Residual risk and sign-off by the data protection officer.

## 5. Record of processing (starting point)

| Field | Suggested entry |
|---|---|
| Activity | Preparing interactive English worksheets (Vocabloom) |
| Purpose | Teaching: turning a teacher's worksheet into interactive exercises, and helping students practise |
| Data subjects | Teachers (an access code and its label); students (optional name, answers and review deck, kept on their own device) |
| Categories of data | Worksheet text. Usage counters labelled with a keyed hash of an IP address. On the student's device only: optional name, answers, review deck, recently opened worksheets |
| Recipients | AI provider ([name]); hosting provider ([name]); storage provider ([name], only if the database is on) |
| Transfers | [AI provider location and safeguards]; [storage region] |
| Retention | PDF: not stored. Converted worksheet: [7] days. Short link: [90] days. Counters: at most 2 days. Host logs: [period]. Student's device: until the student deletes it |
| Security | See `docs/ARCHITECTURE.md`, section "Security design" |

## 6. Children

Students may be minors. Vocabloom collects no email, account or identifier, and the optional name, the answers and the review deck never leave the device. The school stays responsible for how the link is shared and for informing students and guardians. Keep this in mind if a future version adds accounts or stores results: that changes the risk and needs a new assessment, including child-friendly privacy information.

The review deck (spaced repetition) is only a study aid on the student's own phone. It is not used to rank, grade or report on students, and nothing about it is visible to the teacher or the school.

## 7. Artificial intelligence (EU AI Act)

- **Transparency:** teachers are told the AI can make mistakes and must review the exercises. Student pages say that hints and explanations may be written with the help of AI.
- **Risk level:** Vocabloom gives practice feedback only. It does not decide admission, assessment results or progression, and it does not monitor students. The review deck schedules practice questions on the device; it does not evaluate the student. If a future version used scores to grade or evaluate students, re-check the AI Act's rules for education systems.
- **Human oversight:** the review step exists so that a teacher approves the content before students see it. A worksheet converted earlier is shown again as such, with a **Convert again** button.

## 8. Security law notes

- **GDPR Art. 32** asks for appropriate technical measures: see `docs/ARCHITECTURE.md` (security design) and `SECURITY.md`.
- **NIS2 / Cyber Resilience Act:** a small school tool is unlikely to be in scope on its own, but the practices here (no dependencies, tests in CI, a vulnerability reporting route, `security.txt`) are in line with them.
- **Breaches:** if personal data is ever exposed, the controller must assess it and, where required, notify the supervisory authority within 72 hours (in Ireland, the Data Protection Commission). Write down who decides this before you need it.

## 9. Accessibility

The interface uses labelled fields, live regions for feedback and large tap targets. The listen buttons have text labels for screen readers, and the tappable words in a word bank can be reached and used with a keyboard. Public bodies and many education services are expected to meet accessibility standards (WCAG 2.1 AA is the usual target). Test with a screen reader and keyboard before wide use.
