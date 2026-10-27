# PostgreSQL recovery verification

Refs #795, #804, #823, #36 and #37. The offline archive tool does not change provider configuration; live provider actions and their evidence are recorded separately below.

This offline tool verifies a custom-format PostgreSQL archive in a fresh local cluster. It does not connect to an application database, initialize the application, run application migrations, publish records, call payment providers or deploy a release. Its source and destination databases are never selected from `DATABASE_URL` or other inherited libpq settings. The supplied archive is copied into private temporary storage; the original is unchanged.

## Current evidence boundary

A synthetic PASS proves the drill mechanism against the included schema subset and fixture. A supplied-archive PASS proves only that those archived bytes restored, passed the documented schema/integrity checks, and matched the supplied count manifest. The tool always leaves `launch_recovery_gate=HOLD`: provider retention/PITR policy, real backup provenance/completeness, private object availability and application acceptance are separate evidence.

Provider backup scheduling and retention were not inspected by #795. Absence of a repository restore report does not mean provider backups do not exist. Do not close the parent recovery/launch gates using the synthetic test.

Follow-up #804 records a dated provider inspection and a newly saved expiring manual snapshot in [provider evidence, 2026-10-26](RECOVERY_PROVIDER_EVIDENCE_2026-10-26.md). It also extends the dedicated CI to PostgreSQL 18, the observed provider major, while retaining PostgreSQL 16. These are separate results: a saved provider snapshot is not a tested snapshot restore, and synthetic compatibility is not an application recovery result.

Follow-up #823 configured/read back daily snapshots at 19:00 UTC with seven-day retention. Its provider restore attempt also caused an unintended source cutover, which was reversed: see [the incident and containment record](RECOVERY_PROVIDER_DRILL_823_2026-10-26.md). The original branch/endpoint are restored and integrity checks pass, but the provider drill **did not pass isolation**. Scheduled execution, backup-failure alerting, an independently evidenced baseline and full application/object recovery remain separate gates.

## Provider restore safety boundary

Do not use `restore_snapshot` with `finalize: true` for a validation drill. The #823 invocation omitted `target_branch_id`, yet finalization replaced the source branch identity, moved the original compute and swapped the default flag. The initial returned branch object still showed non-default/initializing state, so that response alone was insufficient evidence of isolation.

Further provider restore/finalize attempts are blocked until a documented new-destination operation with explicitly verified `finalize: false` is shown to preserve source identity, names, default/primary flags and every existing compute binding. Merely omitting `target_branch_id` or relying on defaults is not an adequate guard. Finalization is a production cutover operation and requires its own explicit cutover scope; it is not a step in this offline tool or an automatic cleanup action.

For future provider validation, capture source/default identities and endpoint bindings before any operation, require non-finalizing arguments, wait for operations to settle, and re-read both branch and compute mappings before connecting or setting expiry. If any original identity/binding changes, stop validation and contain the incident; never label it an isolated PASS. Do not expire/delete a branch that may contain application writes. Preserve both copies until read-only impact review is complete.

## Operator and prerequisites

The recovery operator needs access to the approved backup and its matching manifest, a clean disposable Linux/POSIX host with adequate disk space, Node 20+, and a single matching PostgreSQL toolchain containing `initdb`, `pg_ctl`, `psql`, `pg_dump` and `pg_restore`. Use maintained PostgreSQL binaries at least as new as the archive producer; cross-version/extension compatibility must be reviewed separately. Run as an unprivileged OS user. Root and Windows are rejected.

Use a disposable host with no cloud/application credentials and restricted network egress when restoring private backups. PostgreSQL archives can execute SQL chosen by the source superuser; only restore archives from an authorized trusted source. `--trusted-archive` records the operator's acknowledgement, not an automatic safety certification. The restore role is not a database superuser, which deliberately rejects superuser-only extension/event-trigger content instead of weakening isolation.

The destination is always a tool-created `/tmp/abl-recovery-*` cluster with a mode-0700 private Unix socket, TCP listening disabled, and a new `recovered` database. There is no host/port/URL/destination argument. Ambient `PGHOST`, `PGSERVICE`, `PGOPTIONS`, `.pgpass`, loader hooks, Railway variables and provider secrets are not forwarded to PostgreSQL processes. No existing database is dropped or cleaned.

## Synthetic acceptance

From the repository root, with the PostgreSQL path adjusted for the installed version:

```bash
node scripts/recovery/restore-drill.js --synthetic --pg-bin /usr/lib/postgresql/16/bin --report /secure-output/synthetic-recovery.json
```

The output directory must already exist. The report is created with mode 0600 and exclusive creation; an existing file/symlink is never overwritten. The synthetic mode creates its own source fixture, makes a real `pg_dump --format=custom` archive, restores it with `pg_restore`, and compares known counts. It uses no company-test account or application secret.

Focused guard tests run with `node --test tests/recovery-*.test.js`. Real PostgreSQL integration is mandatory in the **Recovery Drill** GitHub workflow, which sets `ABL_RECOVERY_INTEGRATION=1` and `ABL_RECOVERY_PG_BIN`. The normal application test suite runs the guard tests and skips only the environment-dependent PostgreSQL integration group. Setting the integration flag without an installed/unprivileged toolchain fails the test; it cannot silently skip.

The dedicated job runs both PostgreSQL 16 on pinned Ubuntu 24.04 and PostgreSQL 18 on pinned Ubuntu 26.04. Each matrix entry checks out the exact PR head (or the actual push SHA after merge), prints that SHA and its PostgreSQL tool version, and runs the same real integration acceptance. No production connection string, archive or secret is supplied to either entry.

## Supplied backup acceptance

Only custom-format files beginning with `PGDMP` are supported. Plain SQL, directory dumps, server URLs and remote destinations are rejected. Archive listing and a manifest checksum mismatch fail before destination initialization. The archive is staged and hashed once so the restored bytes match the reported checksum.

An independently recorded count manifest must refer to the **same consistent snapshot** as the archive. It is not a set of counts measured from the restored database. Counts from a later production snapshot cannot be treated as an exact backup baseline. During an approved backup capture, the backup operator can keep a read-only repeatable-read transaction open, export its snapshot, record the required counts from that transaction, and pass that snapshot to `pg_dump --snapshot`. Record the snapshot's capture time, then the finished archive's SHA-256. Provider-exported backups need equivalent provider/backup-time evidence; without a matching baseline this drill returns HOLD.

The manifest has this shape; all table names below are required and counts are decimal strings, including zero:

```json
{
  "format": "abl-recovery-manifest-v1",
  "archive_sha256": "<64 lowercase hexadecimal characters>",
  "backup_created_at": "2026-10-01T12:00:00Z",
  "expected_counts": {
    "accounts": "2", "businesses": "2", "profiles": "2",
    "business_memberships": "2", "orders": "2", "order_items": "2",
    "inventory": "2", "transactions": "2", "order_stock_consumptions": "1",
    "order_payments": "2", "payment_intents": "1",
    "payment_allocations": "2", "refunds": "1"
  }
}
```

The illustrated counts are synthetic examples, not production measurements. Keep manifests and reports private; aggregate business volumes can still be sensitive.

```bash
node scripts/recovery/restore-drill.js --archive /secure-input/approved.dump --trusted-archive --manifest /secure-input/approved.manifest.json --pg-bin /usr/lib/postgresql/16/bin --report /secure-output/backup-recovery.json
```

No production archive export or real backup drill was authorized or performed by the initial #795 implementation. Those operations require a separately scoped source-access and data-handling plan. The tool does not retrieve credentials, change Neon/Railway settings, or create a remote database.

## Verified checks and interpretation

The tool requires canonical tables/columns before any domain query. Unsupported schema produces HOLD, never invented zero violations. It records a schema signature, integrity-query checksum, archive checksum, PostgreSQL/Node versions, aggregate counts, restore duration, result and cleanup state. This is a schema contract fingerprint, not a claim that the application has a numbered migration history.

The read-only integrity query checks account/profile/membership references, order/item references, positive item quantities, business-scoped ledger/inventory references, cross-business stock consumption, payment/refund/allocation references and allocation currency consistency. Counts detect otherwise self-consistent partial-data loss. NULL counter-order customers and historical payments without a payment-intent link remain valid. Historical items are not joined to current Catalog products. Payment allocations are not added together as if gross/fees/net were disjoint cash amounts.

Exact PostgreSQL NUMERIC order arithmetic, negative legacy inventory and unvalidated constraints are reported as anomalies requiring review. They produce HOLD rather than a claim that restoration introduced corruption. This drill does not rewrite or repair the evidence. It does not recompute historical prices, declare order value to be received money, or infer settlement.

| Result | Exit | Meaning |
| --- | --- | --- |
| PASS | 0 | This database drill and its baseline/checks passed; parent launch recovery remains HOLD. |
| FAIL | 1 | Invalid input, failed command/restore, failed integrity/count check, report failure or cleanup failure. |
| HOLD | 2 | Unsupported schema, missing independent baseline or data/constraint anomaly needs investigation. |

Errors expose fixed codes, not PostgreSQL stderr, object names, row contents, archive paths or credentials. `PG_RESTORE_FAILED` can mean an unsupported extension/privilege requirement as well as bad archive contents; inspect a trusted copy only in the private disposable recovery environment. Never paste private SQL/logs into GitHub.

## Cleanup, incidents and completing real recovery

The tool stops its own cluster and removes temporary data on success, failure and handled SIGINT/SIGTERM. A stop/removal failure forces FAIL; if shutdown cannot be proved safe it keeps the private directory rather than removing a running server's data. Abrupt host loss/SIGKILL cannot execute cleanup. The recovery operator must inspect only that disposable host's owned `abl-recovery-*` directories, stop the exact owned cluster before removal, and securely dispose of the host/storage after private-data testing. Do not apply a broad wildcard cleanup to other workloads.

For a real outage, the recovery owner first freezes the incident scope and records current application SHA/deployment, database/provider state and the last known good backup. Preserve the original evidence before any approved rollback/restore. Restore into isolated infrastructure first, run this verification, then separately validate private evidence objects/scanner access, authentication/session handling, business isolation, orders/stock/finance and critical provider references with all live external side effects disabled. A database dump cannot restore private S3 objects, provider-side payment records, DNS or Railway secrets.

Compare actual backup capture time, restoration duration and business validation completion against agreed RPO/RTO; this tool records timing but cannot invent those targets or provider retention guarantees. A production cutover is a separate release decision with an exact revision, rollback point, access/secret review, scoped smoke checks, monitoring and incident communications. This drill never promotes the restored database.

Record a sanitized evidence summary in #795/#36: exact code SHA and CI run, archive checksum and capture time, synthetic/supplied distinction, PASS/FAIL/HOLD, baseline source, tested checks, cleanup, restore time and unresolved object/provider/application evidence. Only authorized reviewers receive the private archive/manifest/report.

PostgreSQL references: [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html), [initdb](https://www.postgresql.org/docs/current/app-initdb.html), [synchronized snapshots](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION).
