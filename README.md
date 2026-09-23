# PG Workload Advisor

`pg_workload_advisor` is a SQL-only PostgreSQL 17+ extension that turns
`pg_stat_statements` and PostgreSQL statistics views into a reset-safe,
operator-facing scaling advisory.

Source repository: [hqakhtar/pg_workload_advisor](https://github.com/hqakhtar/pg_workload_advisor).

It is installed in the fixed `pg_workload_advisor` schema and depends on
`pg_stat_statements`. Citus telemetry is optional and discovered at capture
time. It classifies query workloads, records resource-pressure evidence,
recommends tuning or scaling actions, and manages advisory events and an
optional Azure Monitor outbox. It does not automatically scale PostgreSQL,
rebalance Citus, or apply query/index changes.

## Install

On PostgreSQL installations that permit local extension files:

```bash
git clone https://github.com/hqakhtar/pg_workload_advisor.git
cd pg_workload_advisor
make USE_PGXS=1 PG_CONFIG=/path/to/pg_config install
```

Use the `pg_config` belonging to the target PostgreSQL 17+ installation.
For the local installation described below, it is
`$HOME/sources/postgres.17/inst/bin/pg_config`. The extension is SQL-only;
installation copies its control and SQL files without compiling a library.

Then, in a database with `pg_stat_statements` loaded through
`shared_preload_libraries`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION pg_workload_advisor;
SELECT pg_workload_advisor.capture();
```

Azure Database for PostgreSQL Flexible Server generally permits only extensions
deployed by the service. If it cannot load this package's control file, it cannot
run `CREATE EXTENSION pg_workload_advisor`; deployment requires an approved
service-supported packaging path.

## Renaming Existing Deployments

`pg_workload_advisor` replaces the former `fspg_ec_advisor` package. Version
`1.0` is retained, but the extension and fixed schema names have changed.
This is not an in-place `ALTER EXTENSION ... UPDATE` migration: existing
installations, capture history, feedback, policies, and queued deliveries are
not renamed or copied automatically.

Back up existing advisor data and plan its migration before retiring the old
installation. Install the new package and extension, then update callers and
validate the new deployment before removing anything from the old one:

- SQL functions, tables, grants, and views use the `pg_workload_advisor` schema.
- The opt-in reset setting is `pg_workload_advisor.reset_stats`.
- Reconfigure existing scheduler jobs to call
  `pg_workload_advisor.run_advisory_cycle()`. Newly scheduled default job names
  start with `pg_workload_advisor_`; existing jobs are not changed.
- Outbox listeners use `pg_workload_advisor_azure_monitor`, and event envelopes
  identify their `eventType` as `pg_workload_advisor.advisory`.
- Run [the renamed dispatcher](dispatcher/README.md) with
  `PG_WORKLOAD_ADVISOR_*` environment variables instead of the old
  `FSPG_EC_ADVISOR_*` prefix. Existing Azure DCR stream/table names can be retained
  by configuring the stream name explicitly.
- Update the [dashboard](dashboard/README.md) alongside the extension; it
  connects to `pg_workload_advisor` version `1.0`.

## Tests

The extension uses PostgreSQL's native `pg_regress` framework. Its test covers
extension creation, fingerprint scoring, JSON capture shape, capture history,
feedback/calibration, and reset-safe telemetry gating.

To test against the installed PostgreSQL 17 binaries in an isolated temporary
cluster, run from this repository root:

```bash
make USE_PGXS=1 PG_CONFIG="$HOME/sources/postgres.17/inst/bin/pg_config" install
make USE_PGXS=1 PG_CONFIG="$HOME/sources/postgres.17/inst/bin/pg_config" \
  WITH_CITUS_TESTS=0 \
  REGRESS_OPTS="--temp-instance=$PWD/tmp_check --temp-config=$PWD/test/pg_workload_advisor.conf" \
  installcheck
```

This requires `pg_stat_statements` to be installed in the same PostgreSQL
prefix. It does not connect to an existing database server. To include the
optional Citus scenario, install Citus in that prefix, set
`WITH_CITUS_TESTS=1`, and use `test/pg_workload_advisor_citus.conf` instead.

Alternatively, use PostgreSQL's in-tree temporary-install test suite. First
link this checkout into the configured PostgreSQL 17 source tree (if the link
does not already exist):

```bash
ln -s "$PWD" "$HOME/sources/postgres.17/contrib/pg_workload_advisor"
cd ~/sources/postgres.17/contrib/pg_workload_advisor
make check
```

When invoking through `make -C`, pass `PG_CONFIG` so the Makefile can locate
the PostgreSQL source root:

```bash
make -C ~/sources/postgres.17/contrib/pg_workload_advisor \
  PG_CONFIG=~/sources/postgres.17/inst/bin/pg_config check
```

The Makefile includes `contrib/pg_stat_statements` in the temporary install and
uses `test/pg_workload_advisor.conf` to preload it for regression tests. When the
local source tree contains Citus, `make check` also runs the Citus metadata
scenario with `test/pg_workload_advisor_citus.conf`. Set `WITH_CITUS_TESTS=0` to
skip that optional scenario or `WITH_CITUS_TESTS=1` to require it explicitly.
This path uses PostgreSQL's in-tree PGXS implementation through
`contrib-global.mk`.

The matrix has three fresh-install scenarios:

- `pg_workload_advisor`: core capture, feedback, reset-safe baseline, and reset
  GUC behavior.
- `pg_workload_advisor_config`: dependency enforcement, unset/off/invalid/on reset
  GUC states, invalid inputs, disabled/enabled policy settings, fresh/stale
  infrastructure telemetry, event lifecycle, Azure Monitor outbox claims,
  success, retry, terminal failure, suppression, and resolution.
- `pg_workload_advisor_citus`: optional Citus extension and metadata paths when
  Citus tests are enabled.

Run the non-Citus matrix explicitly with:

```bash
make WITH_CITUS_TESTS=0 check
```

Run the Azure Monitor dispatcher unit suite independently of PostgreSQL build
tools:

```bash
make python-test
```

The current local test matrix covers the default extension flow, 55 configured
and negative-path assertions, six Citus metadata assertions when enabled, and
eight dispatcher unit tests. It does not send a live request to Azure Monitor.

The [dashboard test suite](dashboard/README.md#6-development-and-verification)
also checks its extension fixtures against this repository's source package
and exercises the renamed extension on PostgreSQL 17 and 18 WebAssembly engines.

The PostgreSQL regression suite validates the durable outbox contract, not a
live Azure subscription. Test Managed Identity authentication, Logs Ingestion,
Data Collection Rules, scheduled query alerts, and action groups in an Azure
integration environment after those resources are configured.

To run against an already running test server instead, force installed-PGXS
mode and supply its connection settings through the usual `PGHOST`, `PGPORT`,
and `PGUSER` environment variables:

```bash
make USE_PGXS=1 PG_CONFIG=/path/to/pg_config install
make USE_PGXS=1 PG_CONFIG=/path/to/pg_config WITH_CITUS_TESTS=0 installcheck
```

## API

```sql
-- Store and return one advisor snapshot.
SELECT pg_workload_advisor.capture();

-- Tune capture evidence requirements.
SELECT pg_workload_advisor.capture(
  p_pressure_samples => 3,
  p_pressure_window_minutes => 60,
  p_min_window_seconds => 300
);

-- Reset only pg_stat_statements after saving a capture. It is opt-in.
SET pg_workload_advisor.reset_stats = on;
SELECT pg_workload_advisor.capture_and_reset();

-- Calling this while the GUC is off returns false and emits INFO.
RESET pg_workload_advisor.reset_stats;
SELECT pg_workload_advisor.reset_stats();

-- Query per-fingerprint workload classifications.
SELECT *
FROM pg_workload_advisor.query_scores()
ORDER BY total_exec_ms DESC;

-- Fetch the most recent persisted advisor result.
SELECT pg_workload_advisor.latest_advice();

-- Record an operator outcome and inspect calibration evidence.
SELECT pg_workload_advisor.record_feedback(
  '<capture_key>',
  'ADD_CONNECTION_POOLING',
  'improved',
  'Waiting-session share fell after pooling.'
);

SELECT * FROM pg_workload_advisor.recommendation_calibration;
```

The extension stores durable baselines and feedback in
`pg_workload_advisor.capture_history` and
`pg_workload_advisor.recommendation_feedback`. Its capture result is JSONB so
clients can evolve independently of a fixed CSV column contract.

## JSON Export

After installing the extension, run [export_workload.sql](export_workload.sql)
with `psql`. From the repository root:

```bash
psql -X -d benchmark \
  -f export_workload.sql \
  > workload_score.json
```

Replace `benchmark` with the target database and supply connection settings
through your usual PostgreSQL configuration. Output is one formatted JSON
object containing `capture_key`, `collected_at`, `server_id`, `database`,
`workload`, `resource`, `window`, and `recommendation`, with no CSV encoding,
column headings, or row count. The script stores a new capture but does not
reset statistics, evaluate policy, or queue notifications. Use `>` rather
than `>>`; appending objects would not produce a single valid JSON document.
SQL errors produce a nonzero exit status, not a successful export.

To export a policy-evaluated cycle, including `automatedAdvisory`, use:

```bash
psql -X -A -t -v ON_ERROR_STOP=1 -d benchmark \
  -c "SELECT jsonb_pretty(pg_workload_advisor.run_advisory_cycle());" \
  > workload_score.json
```

That alternative also updates advisory events and can queue notifications.

## Statistics Reset

`pg_workload_advisor.reset_stats` is a session-level custom GUC. It defaults to
off when unset. Explicit `off` and malformed values are also treated as off and
emit `INFO`. The reset APIs only reset `pg_stat_statements`; they never reset
database, I/O, or checkpointer statistics because those counters underpin the
advisor's reset-safe resource windows.

## Automated Advisory

Run one cycle from an external scheduler or `pg_cron` when it is available:

```sql
SELECT pg_workload_advisor.run_advisory_cycle();
```

When `pg_cron` is installed and preloaded, the extension can register a named
job directly:

```sql
SELECT pg_workload_advisor.schedule_advisory_cycle('*/15 * * * *');
SELECT pg_workload_advisor.unschedule_advisory_cycle(<job_id>);
```

If `pg_cron` is unavailable, these functions return `NULL` / `false` and emit
`INFO`; use an external scheduler instead. A SQL-only extension cannot schedule
itself without `pg_cron` or an external caller.

The cycle captures advisor data, evaluates the `default` policy, updates the
advisory event lifecycle, queues Azure Monitor delivery records, and resolves
stale events. A SQL-only extension cannot schedule itself, so the scheduler is
intentionally external to the extension.

Policies live in `pg_workload_advisor.advisory_policy`. They control confidence,
capture-window requirements, connection and rate thresholds, infrastructure
thresholds, cooldowns, auto-resolution, and Azure Monitor delivery.

See the [SQL decision guide](docs/sql-decision-guide.md) for the evidence,
confidence, workload-fit, policy, and event-lifecycle path behind each action.

Infrastructure monitoring is supplied externally rather than embedded with
cloud credentials in PostgreSQL:

```sql
SELECT pg_workload_advisor.ingest_infrastructure_telemetry(
  p_source => 'azure-monitor',
  p_cpu_pct => 92,
  p_memory_pct => 81,
  p_storage_latency_ms => 24,
  p_iops_utilization_pct => 89,
  p_slo_error_pct => 1.2
);
```

Use `acknowledge_advisory_event()` or `suppress_advisory_event()` to manage
open events. The extension emits durable delivery records through
`azure_monitor_outbox`; see [Azure Monitor delivery](docs/azure-monitor.md) for
the Managed Identity dispatcher contract and alert-rule flow.