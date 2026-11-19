# Compliance guide (EU / Ireland)

> **This is a practical checklist, not legal advice.** The school (or whoever runs Vocabloom) is responsible for its own compliance and should have it reviewed by its data protection officer or adviser.

## 1. What data does Vocabloom handle?

| Data | Where it goes | Kept? |
|---|---|---|
| Teacher's PDF worksheet | Browser → Vocabloom server → AI provider | Not stored by Vocabloom. Handled by the AI provider under its own terms |
| School access code | Typed by the teacher; sent with each conversion | Only in the browser tab (session storage) |
| Worksheet (exercises) | Inside the share link | Lives in the link itself |
| Student name (optional) and answers | Student's own browser (local storage) | Only on the student's device. Never sent to a server |
| Request logs (IP address, time) | Hosting provider | According to the host's policy |

There are **no accounts, no cookies, no analytics, no advertising and no third-party scripts or fonts.**

## 2. Roles under the GDPR

- **Controller:** the school using Vocabloom (decides why and how data is used).
- **Processors:** the AI provider (receives PDFs) and the hosting provider (receives request logs). Each needs a **data processing agreement** (Art. 28).
- If you run Vocabloom for several schools, you may be a processor for them. Agree this in writing.

## 3. Checklist before using it with students

- [ ] Complete the privacy notice template in `public/privacy.html` (every `[square bracket]`) and have it reviewed.
- [ ] Choose and write down the **lawful basis** (for a school this is often "public task" or "legitimate interests"; confirm with your adviser).
- [ ] Sign or accept the **data processing agreements** with the AI provider and the hosting provider.
- [ ] Check **international transfers**. The functions run in Dublin (`vercel.json`: `dub1`), but the AI provider may process data elsewhere: make sure transfer safeguards (for example Standard Contractual Clauses) are in place.
- [ ] Add Vocabloom to the school's **record of processing activities** (Art. 30). A starting point is in section 5.
- [ ] Decide whether a **Data Protection Impact Assessment** is needed (section 4).
- [ ] Tell teachers: **never upload PDFs that contain personal data** (names, photos, marks).
- [ ] Tell students and parents or guardians how the tool is used (the notice and the school's usual communication).
- [ ] Keep `ACCESS_CODE` long and secret, and change it if it leaks. Keep `.env` out of Git.
- [ ] Name a contact for privacy questions and security reports (`SECURITY.md`, `security.txt`).

## 4. Do we need a DPIA?

A DPIA (Art. 35) is required when processing is likely to be high risk. Vocabloom is low risk by design: no profiling, no automated decisions, nothing stored about students, and only teaching material is processed. Still, **children** are a vulnerable group and **AI** is involved, so many schools will want a short DPIA anyway. Points to cover:

1. Description: PDFs go to an AI service; students answer in their own browser.
2. Necessity and proportionality: data minimisation is built in (nothing stored, no accounts).
3. Risks: a teacher uploads personal data by mistake; AI provider retention; leaked access code; wrong AI answers shown to students.
4. Measures: guidance to teachers, agreements with providers, teacher review step, rate limits, security headers, EU function region.
5. Residual risk and sign-off by the data protection officer.

## 5. Record of processing (starting point)

| Field | Suggested entry |
|---|---|
| Activity | Preparing interactive English worksheets (Vocabloom) |
| Purpose | Teaching: turning a teacher's worksheet into interactive exercises |
| Data subjects | Teachers (access code only); students (optional name, kept on their own device) |
| Categories of data | Worksheet text; optional student name and answers (device only) |
| Recipients | AI provider ([name]); hosting provider ([name]) |
| Transfers | [AI provider location and safeguards] |
| Retention | Not stored by Vocabloom; host logs per the host's policy ([period]) |
| Security | See `docs/ARCHITECTURE.md`, section "Security design" |

## 6. Children

Students may be minors. Vocabloom collects no email, account or identifier, and the optional name never leaves the device. The school stays responsible for how the link is shared and for informing students and guardians. Keep this in mind if a future version adds accounts or stores results: that changes the risk and needs a new assessment, including child-friendly privacy information.

## 7. Artificial intelligence (EU AI Act)

- **Transparency:** teachers are told the AI can make mistakes and must review the exercises. Student pages say that hints and explanations may be written with the help of AI.
- **Risk level:** Vocabloom gives practice feedback only. It does not decide admission, assessment results or progression, and it does not monitor students. If a future version used scores to grade or evaluate students, re-check the AI Act's rules for education systems.
- **Human oversight:** the review step exists so that a teacher approves the content before students see it.

## 8. Security law notes

- **GDPR Art. 32** asks for appropriate technical measures: see `docs/ARCHITECTURE.md` (security design) and `SECURITY.md`.
- **NIS2 / Cyber Resilience Act:** a small school tool is unlikely to be in scope on its own, but the practices here (no dependencies, tests in CI, a vulnerability reporting route, `security.txt`) are in line with them.
- **Breaches:** if personal data is ever exposed, the controller must assess it and, where required, notify the supervisory authority within 72 hours (in Ireland, the Data Protection Commission). Write down who decides this before you need it.

## 9. Accessibility

The interface uses labelled fields, live regions for feedback and large tap targets. Public bodies and many education services are expected to meet accessibility standards (WCAG 2.1 AA is the usual target). Test with a screen reader and keyboard before wide use.
