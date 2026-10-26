# Provider restore drill and containment — 2026-10-26

Refs #823 / #36 / #37. **Result: provider data/schema restoration observed; isolation acceptance FAILED; incident contained.** Do not claim a clean recovery or launch-readiness PASS from this drill.

## Intended and actual operation

The intended destination was a new disposable branch restored from manual snapshot `snap-snowy-forest-akbcedd9`, with the original application branch and compute left in place. The recovery agent invoked `restore_snapshot` without `target_branch_id` and explicitly passed `finalize: true`. This was the wrong finalization choice for an isolated drill.

The provider created `br-divine-lab-aknej8lm`, then finalized it as the source identity: the original compute moved to it, it became default/primary with the name `main`, and original `br-cold-field-akeoczpf` was preserved under a recovery name. The first returned object was still initializing/non-default; a later expiry attempt was refused because the branch had become default. Re-reading control-plane state exposed the cutover. The recovery agent stopped the drill and reversed the identity/compute changes. No branch or database was deleted.

## Observed timeline, UTC

| Time | Evidence |
| --- | --- |
| 19:48:05 | Source snapshot from #804 was created. |
| 20:39:51 | Restored branch and an extra idle compute were created; original branch was retained. |
| 20:39:54 | Original application compute was bound to restored snapshot state. |
| 20:42:01 | Extra unused compute was moved to a temporary parking branch, freeing the original branch's compute slot. |
| 20:42:02 | Original compute was rebound to original `br-cold-field-akeoczpf`. |
| 20:42:05–20:42:08 | Original default/primary flag and `main` name were restored. |
| 20:42:55 | Railway HTTP logs record `caliof.com/health` returning 502 during the affected restart/deployment period. |
| 20:44:22 | Railway HTTP logs record `caliof.com/health` returning 200; the observed application deployment is SUCCESS. |

Runtime logs during the overlapping deployment window included a schema-lock deadlock and container restarts. This record does not attribute every restart to a single cause. Browser/QA evidence from **20:39:51–20:44:22 UTC** must be reviewed or repeated. The incident and recovery interval were recorded in #823 and the shared #350 coordination thread.

## Verified containment state

| Resource | Verified state after containment |
| --- | --- |
| Original branch | `br-cold-field-akeoczpf`, name `main`, ready, default and primary. |
| Original application compute | `ep-dark-bonus-ak83oh8r`, active and bound to original branch; existing 0.25–8 CU sizing and suspend setting preserved. |
| Preserved restored branch | `br-divine-lab-aknej8lm`, name `recovery-823-restored-preserved`, non-default/non-primary; retained for impact review. |
| Extra inspection compute | `ep-icy-darkness-akyfdyxm`, bound only to the preserved restored branch, disabled/idle; its temporary inspection cap was 0.25 CU with a five-minute suspend setting. |
| Temporary parking branch | `br-sparkling-mode-akth868o`, non-default, no compute after reassignment, automatic expiry `2026-10-26T22:45:00Z`. |
| Application deployment observed | `223b7b94-b9ac-4518-9b78-a46f0aa83774`, SUCCESS; the `/health` 200 observation above is an HTTP smoke check, not a full authenticated role journey. |

The preserved restored branch deliberately has no expiry pending impact review. Automatically deleting a branch that could contain application writes would discard incident evidence. Its inspection compute is disabled. The temporary parking branch can expire without affecting the original or preserved restored branches.

## Read-only data checks and limits

All inspection SQL used explicit branch/compute/database identities and READ ONLY transactions. Neither application bootstrap nor corrective data writes were run by the drill. Application processes may have performed their own initialization while the original endpoint was temporarily on the restored state.

The original database and preserved restored database each had all required recovery columns and passed the eight existing checks: identity references, order references, item quantities, ledger/inventory business references, stock business scope, payment references, payment identity references and payment currency consistency. Both reported zero order-arithmetic, negative-inventory and unvalidated-constraint anomalies.

A scan of 213 timestamped tables on the preserved restored database found post-cutover timestamps only in seven reference/bootstrap tables:

- `payment_provider_configs`;
- `platform_admin_assignments`;
- `profiles`;
- `legal_documents`;
- `catalog_categories`;
- `legal_requirements`;
- `catalog_attribute_definitions`.

For each of those seven tables, full-table stable-payload digests and row counts matched the original database after excluding `created_at` and `updated_at`. No recent timestamped order, payment, inventory or service records were found in that scan. No raw private rows, credentials, session tokens or stable-payload digests are published here.

This is scoped evidence, **not proof that every possible write/deletion was absent**. Timestamp-free records, deletion history, transient transactions and concurrent writes need their own evidence. No independently captured pre-backup count manifest exists for this provider snapshot, so count completeness and full recovery remain HOLD. No branch merge or automatic data reconciliation was attempted.

## Daily backup schedule configured and read back

On original `main` branch `br-cold-field-akeoczpf`, the provider now returns:

```json
{
  "schedule": [
    {"frequency": "daily", "hour": 19, "retention_seconds": 604800}
  ]
}
```

This schedules snapshots at **19:00 UTC / 03:00 Asia/Manila**, retaining each for **seven days**. The existing six-hour PITR/history window was not changed; no provider plan, Railway variable or application connection string was changed. A read-back configuration is not evidence that the next scheduled snapshot has already executed. The first scheduled run and failure alerting still need verification. The earlier manual snapshot retains its recorded expiry of 2026-10-27T19:47:14Z.

## Blocker and next controlled step

Do not repeat a finalized provider restore as a validation action. Omission of an existing target did not prevent source replacement in the observed tool behavior. Before another attempt, require a verified non-finalizing operation that demonstrably leaves source identities, names, default flags and original compute bindings unchanged; the initial restore response is insufficient.

#823 stays open/blocked for that isolation gate and a complete incident-impact review. #36 also remains open for independent backup completeness, mapping, scheduled execution/alerting, object recovery, authenticated application acceptance and agreed RPO/RTO evidence. Documentation integration or passing application CI cannot close those operational gaps.
