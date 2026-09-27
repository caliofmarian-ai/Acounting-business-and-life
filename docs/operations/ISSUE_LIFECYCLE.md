# Issue Lifecycle Control Tower

Status: **CANONICAL OPERATING RULE**
Repository: `caliofmarian-ai/Acounting-business-and-life`

## Purpose

This workflow prevents duplicate work and makes every active issue visibly traceable from discovery through implementation, Preview QA, merge and closure.

The repository-native source of truth is:

- one common milestone: **Business & Life — Active Work**;
- exactly one lifecycle label on each tracked issue;
- one issue-numbered branch for active implementation;
- one linked PR per coherent slice;
- acceptance evidence in the issue/PR before closure.

A future GitHub Projects v2 board may mirror these states visually, but it must not become a second authority.

## Lifecycle states

| State | Meaning | Exit condition |
| --- | --- | --- |
| `status:open` | Known work, not actively claimed | Agent claims a coherent scope |
| `status:in-progress` | Active implementation/reconciliation | Linked PR is opened and ready for review |
| `status:review` | PR/code/evidence review | Exact-head Preview QA begins or work returns to implementation |
| `status:preview-qa` | Exact-head isolated Preview acceptance in progress | Required tests and acceptance evidence pass |
| `status:ready-to-merge` | Required checks passed and merge is authorized by the issue contract | PR merges |
| `status:blocked` | Concrete external dependency/decision/credential blocks progress | Blocker is removed and work is reclaimed |
| `status:done` | Issue is closed with its acceptance criteria satisfied | Reopen only on regression/new evidence |

Only one `status:*` lifecycle label may exist on an issue. The automation preserves unrelated labels.

## Agent claim protocol

Before writing code:

1. Refresh `main` and record the exact SHA.
2. Check open PRs.
3. Read the target issue and its recent comments.
4. Search active branches for the same issue/scope.
5. If another agent is already active, coordinate/handoff instead of creating a parallel branch.
6. Add `status:in-progress`.
7. Use a branch whose final suffix is the issue number, for example:
   `payments/local-services-v2-571`.
8. Keep the branch scoped to that issue.

The branch suffix lets GitHub Actions automatically recognize the claim for future work.

## Pull request contract

For a leaf issue that the PR fully completes:

```text
Closes #123
```

For a parent/program issue or a partial slice:

```text
Refs #123
```

Opening or synchronizing a linked non-draft PR returns the issue to `status:review`. A draft PR remains `status:in-progress`.

Never use `Closes #N` on a parent tracker unless the complete parent acceptance contract is actually satisfied.

## Preview and merge gates

For runtime/product changes, the normal sequence is:

1. `status:review`
2. deploy the exact PR head to isolated Preview;
3. `status:preview-qa`
4. run the applicable automated suite, authorization negatives, database invariants, Android/browser journeys and logs;
5. fix any defect on the same branch and repeat the invalidated gates;
6. when the required evidence passes, set `status:ready-to-merge`;
7. merge using the exact reviewed head;
8. verify the exact production revision when runtime is affected;
9. close the issue only when its acceptance criteria are complete.

Repository-only documentation/coordination changes do not need an application runtime Preview if they cannot affect the deployed application, but their GitHub CI/syntax checks must still pass.

## Blocked work

Use `status:blocked` only with a concrete issue comment that names:

- the dependency or decision;
- why work cannot safely continue;
- what evidence/action will unblock it.

Do not use blocked work as a substitute for prioritization.

## Parent issues and programme trackers

Large trackers such as architecture, Trust & Safety or pilot roadmaps may remain open across many merged child slices.

When a child PR for a parent issue merges:

- the parent returns to `status:in-progress` if acceptance remains;
- the parent moves to `status:done` only when the parent issue itself closes.

This avoids the false rule “merged code = whole programme complete.”

## Automatic reconciliation

`.github/workflows/issue-lifecycle.yml` maintains the repository metadata:

- creates/reuses all lifecycle labels;
- creates/reopens the common active-work milestone;
- seeds currently open issues without overwriting an explicit milestone;
- assigns new/reopened issues to `status:open`;
- recognizes issue-number branch suffixes as `status:in-progress`;
- moves linked non-draft PR work to `status:review`;
- preserves manual `status:preview-qa`, `status:ready-to-merge` and `status:blocked` transitions;
- marks closed issues `status:done`;
- enforces one lifecycle status label at a time.

## Existing open issues

On initial rollout, all existing open issues are enrolled safely as `status:open` unless they already have a lifecycle state. After the seed completes, active agents must immediately reconcile their actual claimed issues to `status:in-progress` or the applicable later gate.

Do not infer completion from age, old branches or old merged PRs. Reconcile against current `main`, current runtime and issue-specific acceptance evidence first.

## GitHub Projects v2 boundary

GitHub documents that repository `GITHUB_TOKEN` is repository-scoped and cannot access Projects v2. Therefore this repository does not make correctness depend on a separate Projects credential.

If a visual Projects v2 board is later connected with a GitHub App or user token that has Projects write permission, map its Status field directly to these canonical lifecycle labels rather than inventing a second workflow.
