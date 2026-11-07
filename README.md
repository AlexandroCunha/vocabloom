# Vocabloom

Upload any PDF worksheet. Claude reads it, turns it into interactive exercises, and gives the teacher a link students can open and answer on a phone.

**Exercise types:** fill in the blanks, short answer, multiple choice, true/false, matching, open writing (with word banks and reading texts).

## How it works
1. Teacher uploads a PDF and types the school access code.
2. `POST /api/convert` sends the PDF to the Claude API (PDF input) and receives structured exercises via a tool call.
3. Teacher reviews and edits answers (important when the PDF has no answer key).
4. Teacher shares a link. The worksheet data lives inside the link itself (compressed), so no database is needed. A downloadable single-file `.html` is also offered.
5. Students answer on their phone; progress is saved in their browser; "Copy my results" gives them text to send back.

## Run locally
```
cp .env.example .env      # add your ANTHROPIC_API_KEY and ACCESS_CODE
node server.js            # http://localhost:3000   (Node 18+, no npm install needed)
```
Try it without an API key: `MOCK=1 node server.js` returns the demo worksheet for any PDF.

## Deploy on Vercel (free plan is enough to start)
1. Push this folder to a GitHub repo.
2. In Vercel: Add New > Project > import the repo (no build settings needed).
3. Settings > Environment Variables: add `ANTHROPIC_API_KEY` and `ACCESS_CODE`, then redeploy.
4. Share the Vercel URL and the access code with your teachers.

## Security and privacy (EU)
- **GDPR by design:** no database, no cookies, no analytics, no third-party fonts or scripts. Student answers stay in the student's own browser. See [`public/privacy.html`](public/privacy.html): a privacy notice **template** that the school must complete and have reviewed.
- **Do not upload personal data.** The PDF is sent to the AI provider to be converted. Before use with students, the school needs a data processing agreement and a lawful basis, and should check where the provider processes data.
- **Hardening:** strict security headers (CSP, HSTS, `nosniff`, no framing), access code compared in constant time, limits on wrong codes and on conversions, validated AI output, escaped HTML, size-limited share links, no runtime dependencies. Details in [`SECURITY.md`](SECURITY.md).
- **Rate limits are best effort.** They live in server memory, so on Vercel each instance counts separately. For a hard limit, add Vercel's firewall / rate limiting.
- Keep `ACCESS_CODE` long and secret, and change it if it leaks.

## Tests
```
npm test        # Node's built-in test runner, no install needed
```

## Limits to know
- PDFs up to about 3 MB (Vercel request limit). Very long PDFs may be refused; split them.
- Without `ACCESS_CODE`, anyone with the URL can spend your API credits. Always set one.
- Each conversion costs a small amount of API usage (typically cents).
- Student results are not stored on a server (by design for this version). A platform with classes and teacher dashboards needs a database: that is the next project.

## Licence
MIT. See [`LICENSE`](LICENSE).
