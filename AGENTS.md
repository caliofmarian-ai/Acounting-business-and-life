# Business & Life — Agent Coordination

GitHub `main` is canonical. Before changing anything, inspect the current `main`, open pull requests, the target issue, and active branches.

All implementation/reconciliation work MUST follow [docs/operations/ISSUE_LIFECYCLE.md](docs/operations/ISSUE_LIFECYCLE.md).

Minimum coordination rules:

1. Do not start work on an issue already marked `status:in-progress`, `status:review`, `status:preview-qa` or `status:ready-to-merge` unless the existing owner/handoff is reconciled first.
2. Claim a leaf issue by moving it to `status:in-progress`, then create one branch from current `main` whose name ends in `-<issue-number>`.
3. Keep one coherent scope per issue/branch/PR. Do not create duplicate issues for the same accepted scope.
4. Pull requests must reference the issue. Use `Closes #N` only when that PR fully satisfies the issue acceptance criteria. Use `Refs #N` for parent/program issues or partial slices.
5. Product/runtime changes must pass exact-head checks and the applicable isolated Preview acceptance before merge.
6. Move the issue to `status:preview-qa` only while exact-head Preview acceptance is actually being executed. Move it to `status:ready-to-merge` only after the required evidence passes.
7. If blocked, use `status:blocked` and record the concrete blocker in the issue.
8. A merged PR does not automatically mean a parent/program issue is complete. Parent issues remain open until all acceptance criteria are satisfied.
9. After merge, verify the exact deployed revision and production smoke evidence when the change affects runtime. Close only after acceptance is complete.
10. Preview is a temporary validation surface, not a second release branch. An exact-head Preview divergence is allowed only for an open PR time-slice; after merge/close, reconcile the shared Preview pointer back to current `main`.
11. Never claim Preview success as production success. Record both the exact Preview SHA/deployment and the exact production `main` SHA/deployment for runtime changes.
12. Keep intentional QA-only differences (isolated QA database, QA geography context, test credentials/providers) separate from code parity; never copy QA secrets or bypasses into production to make the environments look identical.
13. Never store secrets, private evidence, raw credentials or personal sensitive data in GitHub issues, PRs, comments, logs or repository files.

The common milestone `Business & Life — Active Work` is the repository-native active-work grouping. The lifecycle labels are the canonical workflow state even if a visual GitHub Projects board is later added as a mirror.
