# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.
Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository.

Include what you found, how to reproduce it and, if possible, the impact. You will get an answer
as soon as the maintainer can read it, and the fix is published before details are shared.

## Supported version

Only the latest version on the default branch receives security fixes.

## Practices in this project

- No secrets in the repository: `.env` is ignored, `.env.example` holds placeholders only.
- Strict HTTP security headers (CSP, HSTS, `nosniff`, no framing, no referrer, minimal permissions).
- Access code checked in constant time, with limits on wrong attempts and on conversions.
- Everything that comes back from the AI service is validated and length-limited before use.
- All text is escaped before it reaches the page; share links are size-limited.
- No third-party scripts, fonts, cookies or analytics.
- No runtime dependencies, which keeps the supply-chain surface minimal.
- Automated tests run on every push and pull request.
