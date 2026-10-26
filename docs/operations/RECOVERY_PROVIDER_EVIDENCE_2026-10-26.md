# Provider recovery evidence — 2026-10-26

Refs #804 / #36 / #37. This is a dated operational observation, not a continuously current backup status.

## Verified observations

Read-only Neon metadata for the existing **Accounting Business and Life** project showed:

| Item | Observed evidence |
| --- | --- |
| Database engine | PostgreSQL major 18; database `accounting` reported `18.6 (fd34222)` at `2026-10-26T19:47:14Z`. |
| Recovery schema preflight | All 13 tables in the #795 recovery contract were present. No private rows were read/exported by this preflight. |
| Project retained history setting | `21600` seconds, or **6 hours**. This configuration value is not a tested recovery duration or availability guarantee. |
| Existing branch | One listed branch, `main`, marked default/primary and ready. |
| Saved snapshots before this work | Snapshot API returned an empty list. |
| Automatic snapshot schedule | Main-branch schedule API returned an empty schedule. |

The matching Railway project and production application service were inspected by read tools only. `DATABASE_URL` was present, but OAuth withheld its value. This inspection therefore does not independently prove the service-to-Neon-endpoint mapping. No secret was retrieved, changed or copied into this report.

## Manual snapshot created and read back

One provider-managed snapshot was saved in the same existing Neon project and verified by a second snapshot-list read:

| Field | Provider-returned value |
| --- | --- |
| ID | `snap-snowy-forest-akbcedd9` |
| Name | `recovery-evidence-804-2026-10-26` |
| Source | Existing `main` branch, `br-cold-field-akeoczpf` |
| Created | `2026-10-26T19:48:05Z` |
| Expires | `2026-10-27T19:47:14Z` |
| Classification | Manual snapshot; no automatic schedule was enabled. |

The snapshot expiration is intentional. This snapshot is not ongoing daily-backup protection, and it must not be reported as available after its expiration without a fresh provider read. No production database was restored, replaced, migrated or repointed. No database dump or private data file was exported. The active connection, history-retention setting, snapshot schedule and Railway settings were unchanged.

## Toolchain compatibility

The observed PostgreSQL 18 database exposed a validation gap: #795's dedicated CI exercised PostgreSQL 16 only. #804 expands that existing job to both majors, with pinned host images and explicit exact-head checkout. Both entries use synthetic data, actual `pg_dump`/`pg_restore`, independently expected counts and the same integrity/failure/isolation/interrupt-cleanup scenarios. The PostgreSQL 16 baseline stays in place.

Passing this matrix establishes compatibility of the offline mechanism with those tested toolchains. It does not establish that the full provider schema, managed extensions, roles, policies or a real provider snapshot can be restored by the local archive tool. Those require their own accepted evidence.

## Remaining recovery gate: HOLD

The following evidence is still required under #36 before full recovery can be claimed:

- A controlled restore of the saved provider snapshot or a real approved backup into an explicitly isolated destination, with an independently justified baseline and integrity checks.
- Verified production-to-provider mapping without exposing credentials.
- Agreed RPO/RTO and reviewed ongoing snapshot/backup retention and failure alerting; the existing 6-hour history and temporary manual snapshot do not define that policy.
- Private object/scanner recovery and authorization checks; database snapshots do not prove external object availability.
- Application authentication, business isolation, Orders/Inventory/Finance acceptance and release/cutover/rollback evidence with live side effects disabled.

Snapshot creation and metadata inspection do not activate public listings, payments, dispatch, account eligibility or application features. Shared Preview remained available to the agents validating their own runtime changes.
