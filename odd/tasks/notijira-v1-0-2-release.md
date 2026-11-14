# NotiJira v1.0.2 GitHub release
Objective: tag v1.0.2, link the README to its GitHub release, and publish Windows installer assets. Branch: main. Delivery strategy: ask-on-risk. Test runner: none; use structural checks and verify release/tag state.

## Specs

### S1 — Tag the version
- Authorized scope: create the local Git tag `v1.0.2` at the current release commit.
- Acceptance: the tag resolves to the selected release commit and does not overwrite an existing tag.
- Checks: inspect `git show-ref` and compare the tag target with the intended commit.
- User request (verbatim): "necesito que me crees el tag de la version v.1.0.2 y cambies el readme para vincularlo a la release y poder descargar la vesion en github"

### S2 — Link the README to the release
- Authorized scope: add a Spanish download link for the v1.0.2 GitHub release in `README.md`.
- Acceptance: the link targets `https://github.com/jlozanoDev/notiJira/releases/tag/v1.0.2`.
- Checks: read back the edited section and verify the URL and Markdown structure.

### S3 — Publish the GitHub release
- Authorized scope: publish release v1.0.2 for `jlozanoDev/notiJira` and upload the existing v1.0.2 Windows installer assets from `dist/` using the current authenticated GitHub CLI session.
- Acceptance: GitHub confirms the release URL and uploaded assets.
- Checks: inspect the confirmed release and asset list; do not infer success from command text alone.

## Tasks
- T1 — S1-S3; route: inline; status: partial (S1-S2 verified; S3 blocked); commit: pending (no commit requested).

## Log
- L1 — User request (verbatim): "necesito que me crees el tag de la version v.1.0.2 y cambies el readme para vincularlo a la release y poder descargar la vesion en github"
- L2 — User confirmation (verbatim): "si". The confirmed plan uses tag `v1.0.2` and publishes the GitHub release with installers through the current GitHub CLI session.
- L3 — Local inspection: package.json is already version 1.0.2; branch is main at `fad23ffe71f57e292b34c65f8976b6a87d579d70`; the worktree was clean and no local v1.0.2 tag was found. `dist/` contains v1.0.2 NSIS and portable installers. GitHub CLI (`gh`) is unavailable, so release lookup/publication cannot currently be performed through the authorized session.
- L4 — Added the README release-page link and created annotated local tag `v1.0.2` at `fad23ffe71f57e292b34c65f8976b6a87d579d70`. The README link/assets, tag target, and `git diff --check` passed. Both installer files exist in `dist/` (NSIS 76,547,448 bytes; portable 76,331,961 bytes).
- L5 — GitHub publication remains blocked because `gh` is not installed/available. No GitHub lookup, push, release creation, or asset upload was performed. Next: make the authorized GitHub CLI session available, then verify remote tag/release state and publish the release with both installer assets.
- Risk: item 5 (the requested release publication is still pending; no remote release operation has occurred).
