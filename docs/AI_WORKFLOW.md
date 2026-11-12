# AI collaboration workflow

## Human approval and agent boundaries
Claude Code is the implementation agent. ChatGPT reviews pull requests independently. Neither agent has automatic access to the other's private conversations or tools. The repository owner decides whether a reviewed PR is merged. GitHub branch protection/rulesets must be enabled separately in repository settings; these documents do not enforce permissions.

## Task lifecycle
1. Create a GitHub issue with context, observable acceptance criteria, out-of-scope items, privacy impact and test scenarios. Use synthetic data.
2. Claude reads README, AGENTS.md, CLAUDE.md, source and CI. Start `claude/<issue>-<slug>` from updated `main`. Keep one concern per branch.
3. Claude adds tests, implements the change and opens a **draft** PR. Report exact commands and outcomes, including tests not run; provide screenshots only if they contain no sensitive data.
4. ChatGPT reviews the actual diff, architecture and evidence. Classify findings as blocker / important / suggestion; cite affected paths and explain reproduction or risk. An AI review is advisory, not a formal GitHub approval unless explicitly submitted as one.
5. Claude fixes findings on the same PR branch. ChatGPT re-reviews. The owner makes the final merge decision after required checks pass.
6. After merge, confirm the GitHub Pages deployment and test installed PWA cache refresh. Retain rollback instructions and backup guidance.

## Definition of ready
- Scope and non-goals explicit; acceptance criteria observable
- Data, authentication, sync and offline implications assessed
- Existing behavior and test commands identified

## Definition of done
- Diff reviewed; automated checks green or exceptions explicitly accepted by owner
- Regression and mobile/offline checks reported accurately
- No secrets or sensitive production data in diff, logs, fixtures or screenshots
- Backward compatibility, data migration and rollback documented
- Owner explicitly authorized merge

## Reviewer checklist
- Correctness, edge cases, race conditions, date/timezone handling
- Data isolation, authorization, XSS, dependency supply-chain and token exposure
- Storage format, backups, conflict resolution, cache invalidation
- Accessibility, mobile touch targets and keyboard behavior
- Test coverage, untested paths, and safe failure modes

## Important limitations
- A draft PR is not a deployment gate by itself; check branch rules and GitHub Actions.
- Repository docs cannot automatically invoke Claude or ChatGPT. Start Claude Code with the repo checked out and provide the issue/PR; request ChatGPT review separately.
- Do not publish real HR records, time entries, encrypted vault exports, access tokens or private backups to a public repository.
