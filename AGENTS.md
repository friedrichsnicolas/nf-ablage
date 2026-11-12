# AGENTS.md — AI development and review contract

## Roles and authority
- **Claude Code** is the primary implementer: investigates, writes code and tests, and opens feature pull requests.
- **ChatGPT** is the independent reviewer: checks requirements, architecture, security, regressions and evidence; may request changes but must not silently rewrite Claude's work.
- **Repository owner** approves releases and merges. Neither agent may merge or push directly to `main` without explicit authorization.
- GitHub issues, pull requests, commits and tracked docs are the shared handoff; the agents do **not** directly exchange private chat state.

## Mandatory workflow
1. Read README, this file, CLAUDE.md, existing workflows and relevant source files. Confirm actual behavior; do not assume README is fully current.
2. Describe scope, acceptance criteria, risks and a verification plan in an issue or PR.
3. Work on a new branch `claude/<issue>-<short-topic>` based on up-to-date `main`. Never modify `main` directly.
4. Keep diffs focused. Do not introduce unrelated redesigns, dependencies, data migrations or destructive changes.
5. Run existing automated tests plus relevant manual tests; disclose anything not run. For browser PWAs check mobile, offline/cache and keyboard behavior.
6. Open a **draft** PR targeting `main` with change summary, linked issue, tests/results, security/data impact, screenshots where relevant, and rollback notes.
7. Request ChatGPT review. Address comments with new commits; keep review history. Owner approves merge. Do not self-approve or auto-merge.

## Review checklist
- Requirements and acceptance criteria met; no regression or data loss
- Authentication, access control, secrets, input validation, XSS and dependency changes checked
- Local persistence, sync, offline cache and migrations handled where relevant
- Accessibility and responsive mobile behavior verified
- Tests and limitations documented; no fabricated test results
- PR stays draft until reviewed and owner explicitly authorizes readiness/merge

## Security and privacy
Never commit credentials, access tokens, personal records, real HR forms, private backups or decrypted documents. Public source repositories are not secure data stores. Keep secrets in appropriate runtime configuration and use least privilege. Do not send sensitive production data to AI tools. Avoid logging personal information.

## Project-specific rules
- Encrypted local document vault. Treat js/crypto.js, js/db.js, OAuth-PKCE, Dropbox sync and backup format as security-critical. Do not weaken CSP, export plaintext keys, log secrets or commit real documents. Cryptographic changes require explicit threat-model review, regression tests and user approval.
