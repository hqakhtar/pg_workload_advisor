# PG Workload Advisor SQL Decision Guide

This two-page guide explains how the SQL-only extension turns PostgreSQL and
optional Citus signals into an operator action. It separates the provisional
recommendation returned by `capture()` from the policy-controlled event created
by `run_advisory_cycle()`.

## Reader's Map

| Section | What it is | What it decides |
| --- | --- | --- |
| Score query fingerprints | A heuristic classification of individual normalized statements | Which workload patterns consume observed execution time |
| Catalogs and why they are read | An inventory of PostgreSQL and optional Citus evidence sources | Where each metric comes from and why it is trusted for that purpose |
| Reset-safe window | A comparison interval between two compatible captures | Whether counter deltas and rates are safe to use |
| Evidence and workload fit | A quality grade plus a scale-readiness assessment | Whether the capture has enough evidence and which prerequisite comes first |
| Default policy | The mutable threshold row in `advisory_policy` | What the deployment considers pressure, freshness, persistence, and notification behavior |
| Policy gates | Ordered safety checks in `evaluate_capture()` | Whether evidence is credible and sustained enough to create or update an event |
| Events and delivery | The deduplicated advisory lifecycle and durable outbox | How an accepted action is retained, suppressed, resolved, and delivered |

A **policy gate** is not another measurement. It is a required condition that
turns existing measurements into an operator action. For example, a high CPU
sample can indicate infrastructure pressure, but it cannot create an event
until the policy accepts the capture's confidence, valid time window, and
sustained-pressure evidence.

## Page 1: Evidence And Capture

### 1. Score Query Fingerprints

`query_scores()` reads top-level statements from `pg_stat_statements` for the
current database. It excludes advisor, Citus statistics, transaction-control,
and maintenance statements so its own collection work does not influence the
result.

Each fingerprint receives four heuristic scores. The scores are not a query
label; one query can contribute evidence to more than one profile. `capture()`
then weights those scores by total execution time, so the stored percentages
describe where observed execution time is concentrated.

| Profile | Main evidence | Interpretation |
| --- | --- | --- |
| OLTP | Fast, small-row, frequent DML; simple shapes; planning or lock waits | Many short transactional operations |
| OLAP | Long scans, large result sets, joins, aggregates, temp I/O, I/O waits | Scan and analytical pressure |
| HTAP | A meaningful overlap of transactional and analytical signals | Mixed operational and analytical work |
| Time series | Inserts plus time functions, time-like columns, intervals, or recent-window queries | Ingest and time-window access patterns |

#### How A Raw Score Is Calculated

Each matching condition adds its listed weight; a condition that does not match
adds zero. The SQL does not force a fingerprint into one exclusive category.

| Profile | Weighted conditions in `query_scores()` |
| --- | --- |
| OLTP | `2.0` mean execution under 20 ms; `1.5` fewer than 100 rows/call; `1.2` DML; `1.0` no grouping, `DISTINCT`, window, or `HAVING`; `0.8` temp I/O below 2 percent; `0.8` at least 100 calls; `0.8` planning above 15 percent; `0.4` `LIMIT`; `0.6` lock waits above 30 percent. |
| OLAP | `2.0` mean execution above 200 ms; `1.5` more than 1,000 rows/call; `1.2` grouping, `DISTINCT`, window, or `HAVING`; `1.0` join; `1.0` temp I/O above 5 percent; `0.8` more than 1,000 shared blocks/call; `0.8` planning below 5 percent; `0.4` `SELECT`; `0.6` I/O waits above 30 percent; `1.0` cross-node Citus execution. |
| HTAP | `2.0` times the smaller of the normalized transactional core and analytical core; plus `0.8` planning between 5 and 30 percent; `0.8` at least 10 calls at 5 ms or more; `0.6` a join, grouping, or DML; and `0.5` IPC waits above 20 percent. |
| Time series | `2.0` insert; `1.4` a time function or time-like column; `1.0` interval; `1.0` descending recent-window query with `LIMIT`; `0.8` 1 to 100,000 rows/call; `0.6` grouping with time evidence. |

The HTAP transactional core is `2.0` for a fast query, `1.5` for a small result,
and `1.2` for DML. Its analytical core is `2.0` for a slow query, `1.5` for a
large result, and `1.2` for an analytical query shape. Each core has a maximum
of `4.7`, so HTAP receives its largest overlap contribution only when both
transactional and analytical evidence exist. Optional planning and wait terms
contribute only when those source metrics are available.

#### How Fingerprint Scores Become Workload Shares

For profile $c$ and fingerprint $i$, let $E_i$ be cumulative execution time and
$S_{i,c}$ be that fingerprint's raw score. `capture()` computes:

$$
P_c = 100 \times
\frac{\sum_i E_i S_{i,c}}
{\sum_i E_i\left(S_{i,\mathrm{OLTP}} + S_{i,\mathrm{OLAP}} + S_{i,\mathrm{HTAP}} + S_{i,\mathrm{TS}}\right)}
$$

This has two important consequences:

- A costly fingerprint matters more than a frequent but cheap fingerprint.
- A fingerprint can add to several profiles, but the final profile shares use
   one common denominator and therefore sum to approximately 100 percent after
   rounding.

The mix reflects the current cumulative `pg_stat_statements` window. Reset-safe
capture-to-capture deltas are used separately for pressure rates, not to
recalculate the workload percentages.

Optional sources make the classification more informative: wait sampling adds
I/O, lock, and IPC fractions; Citus statistics identify cross-node work. For
Citus, a routed query with a partition key is treated as local. Other observed
Citus execution is treated as cross-node.

### 2. Catalogs And Why They Are Read

| Relation or API | Signals read | Why the decision uses it |
| --- | --- | --- |
| `pg_stat_statements` | Query ID, calls, execution and planning time, rows, block counters, and normalized query text | Scores each fingerprint and weights the workload profile by execution time. The installer resolves the extension schema dynamically. |
| `pg_stat_statements_info` | `stats_reset` | Invalidates a comparison window after a statement-statistics reset. |
| `pg_database` | Current database OID | Limits statement and database statistics to the current database and keys captures correctly. |
| `pg_settings` | Connection limits, reserved slots, and `track_io_timing` | Calculates usable connection capacity and records whether I/O timing improves coverage. |
| `pg_stat_activity` | Client backend count, active state, waits, idle-in-transaction state | Detects connection saturation and waiting-session pressure. |
| `pg_stat_database` | Cache counters, temp bytes, deadlocks, I/O time, and `stats_reset` | Produces per-database rates and rejects windows after a database-statistics reset. |
| `pg_stat_io` | Client-backend reads, writes, and `stats_reset` | Adds reset-safe client I/O rates. |
| `pg_stat_checkpointer` | Timed/requested checkpoints and `stats_reset` | Detects checkpoint-request pressure and reset boundaries. |
| `query_store.pgms_wait_sampling_view` when installed | I/O, lock, and IPC wait samples by query ID | Adds optional wait fractions to fingerprint scoring; absence lowers coverage but does not fail capture. |
| `pg_extension` plus `to_regclass()` | Whether Citus and its optional relations exist | Keeps the extension usable on PostgreSQL without Citus. |
| `pg_catalog.citus_stat_statements` when available | Executor, partition key, and query ID | Marks execution as local router work or cross-node work for locality and OLAP evidence. |
| `pg_catalog.pg_dist_node` and `pg_catalog.citus_shards` when available | Active primary workers and shard bytes per worker | Calculates shard-byte fairness before recommending more Citus workers. |

The Citus relations are optional. The SQL checks their existence before reading
them; missing Citus telemetry becomes a coverage limitation, not a query error.

### 3. Create A Reset-Safe Window

`resource_snapshot()` gathers connection occupancy and wait state from
`pg_stat_activity`, counters from `pg_stat_database`, client I/O from
`pg_stat_io`, and checkpoint counters from `pg_stat_checkpointer`. `capture()`
persists cumulative values, then compares them with the prior capture for the
same server and database.

A window is valid only when it has a prior capture, meets the minimum duration,
has no statistics reset, and no counter regresses. The default minimum is 300
seconds. Only a valid window produces rates such as temp bytes per second,
deadlocks per hour, client I/O per second, and checkpoint requests per hour.

The capture's connection-pressure signal is one of:

- `SATURATED_CONNECTIONS`
- `HIGH_CONNECTION_PRESSURE`
- `HIGH_CONNECTION_UTILIZATION`
- `NO_CONNECTION_PRESSURE_SIGNAL`

For its provisional recommendation, `capture()` requires the current valid
window plus three pressure observations in the last 60 minutes by default.
This avoids treating one short spike or a reset as capacity evidence.

### 4. Grade Evidence And Workload Fit

Telemetry coverage starts at 30 percent. It gains 30 points for a valid window,
10 for `track_io_timing`, 10 for optional wait sampling, and 20 when Citus is
not installed or both Citus fairness and statement telemetry are available.
Coverage and capture history determine confidence:

| Confidence | Requirement |
| --- | --- |
| High | Valid window, required capture count, and at least 80 percent coverage |
| Medium | Valid window and at least 60 percent coverage |
| Low | Anything else |

Workload fit is evaluated in a safety-first order. If active Citus worker shard
bytes have fairness below `0.85`, the result is `REBALANCE_FIRST`. If cross-node
execution is at least 40 percent or routability is below `0.60`, it is
`OPTIMIZE_LOCALITY_FIRST`. Only after those blockers are clear does the advisor
consider horizontal scale: OLAP plus HTAP at least 40 percent, or OLTP at least
50 percent, becomes `SCALE_OUT` on Citus or `CITUS_MIGRATION_CANDIDATE` without
Citus.

#### How The Advisor Reaches A Scale-Out Decision

`SCALE_OUT` is a workload-fit result, not an instruction to add capacity. The
capture path first applies this precedence:

1. No scored workload produces `NO_DATA`.
2. Citus fairness below `0.85` produces `REBALANCE_FIRST`; adding workers before
   balancing existing shard bytes is blocked.
3. Cross-node execution of at least 40 percent or routability below `0.60`
   produces `OPTIMIZE_LOCALITY_FIRST`; reducing scatter/gather work is blocked
   ahead of capacity growth.
4. With those blockers absent, `OLAP + HTAP >= 40%` is a horizontal-scale fit.
5. Otherwise, `OLTP >= 50%` is also a horizontal-scale fit.
6. A horizontal-scale fit becomes `SCALE_OUT` only when Citus is installed;
   without Citus it becomes `CITUS_MIGRATION_CANDIDATE`. Other mixes are
   `REVIEW`.

The capture's provisional action still requires confidence and sustained
pressure. A low-confidence capture becomes `REVIEW_TELEMETRY`; a valid but
not-sustained capture becomes `MONITOR`. With Citus installed, a sustained
scale-out fit becomes `ADD_CITUS_WORKERS_CANDIDATE`; without Citus it remains a
migration candidate. A Citus worker recommendation is therefore a candidate
for operator review, never an automatic scale operation.

Time-series score contributes to the workload-share denominator, but it is not
currently an independent scale-out threshold. A time-series-heavy system reaches
`SCALE_UP_CANDIDATE`, `TUNE_QUERY_OR_INDEX`, or a review outcome unless its OLTP
or OLAP-plus-HTAP shares meet one of the explicit horizontal-scale conditions.

`capture()` stores all source values, rates, blockers, confidence, workload fit,
expected benefit, and verification step in `capture_history.payload`. Its action
is an evidence summary, not yet a notification decision.

## Page 2: Policy And Event Decisions

`run_advisory_cycle()` calls `capture()` using the selected policy's sample
count, pressure window, and minimum window. It then calls `evaluate_capture()`.
This is the point where the extension decides whether an operator-facing event
should exist.

### 5. The Default Policy

`advisory_policy` holds mutable thresholds, so tuning does not require changing
the extension SQL. The `default` row starts with these values:

| Concern | Default policy |
| --- | --- |
| Confidence and persistence | At least `MEDIUM`; 3 samples in 60 minutes; 300-second minimum window |
| Connection pressure | 85 percent utilization and 20 percent waiting active sessions |
| Database rates | 16 MiB/s temp data, 1 deadlock/hour, 1,000 client reads/s, 1,000 client writes/s, 6 checkpoint requests/hour |
| Infrastructure | 85 percent CPU, memory, or IOPS; 20 ms storage latency; queue depth 5; 1 percent SLO errors; optional application-latency limit |
| External telemetry | Must be no more than 15 minutes old |
| Event behavior | 30-minute notification cooldown; auto-resolve after 2 hours; Azure Monitor delivery enabled |

Fresh infrastructure telemetry is stored separately by
`ingest_infrastructure_telemetry()`. The evaluator does not silently treat a
missing or stale infrastructure sample as proof of infrastructure pressure.

### 6. Apply The Policy Gates

`evaluate_capture()` is the enforcement layer between a recorded capture and an
operator event. A policy gate is an ordered check that must pass before the
next check is considered; it prevents one incomplete, stale, reset-affected, or
short-lived signal from becoming an alert. It proceeds in this order:

1. Reject a disabled or unknown policy.
2. Reject a capture whose confidence is below `minimum_confidence`.
3. Calculate connection pressure, rate pressure, and fresh infrastructure
   pressure against the policy thresholds.
4. Require the current capture to have a valid window and enough valid captures
   in the pressure window.
5. Require either enough database-pressure captures or enough pressured,
   fresh infrastructure samples.
6. Select one action using the following precedence.

For a scale-out event specifically, the evaluator requires an enabled policy,
capture confidence at or above `minimum_confidence`, a valid current window,
and sustained pressure across the policy sample count. It then accepts
`SCALE_OUT` only with Citus installed and creates
`ADD_CITUS_WORKERS_CANDIDATE`; the equivalent non-Citus workload fit creates
`CITUS_MIGRATION_CANDIDATE` instead. A connection-pressure OLTP workload takes
the earlier `ADD_CONNECTION_POOLING` branch, and fairness or locality blockers
take precedence over both scale-out branches.

| First matching condition | Policy action |
| --- | --- |
| Capture says rebalance or locality must come first | `REBALANCE_FIRST` or `OPTIMIZE_LOCALITY_FIRST` |
| Pressure is not sustained | No event |
| Connection pressure and at least 50 percent OLTP | `ADD_CONNECTION_POOLING` |
| Citus scale-out fit | `ADD_CITUS_WORKERS_CANDIDATE` |
| Non-Citus scale-out fit | `CITUS_MIGRATION_CANDIDATE` |
| Connection, rate, or infrastructure pressure | `SCALE_UP_CANDIDATE` |
| Remaining sustained case | `TUNE_QUERY_OR_INDEX` |

This means a capture may say `MONITOR` while policy evaluation emits no event;
it also means an event is not created merely because one counter crosses a
threshold. Confidence, a reset-safe time window, and sustained evidence are
all required first.

### 7. Manage Events And Delivery

Active events are deduplicated by server, database, policy, and action. A later
matching capture updates the same event and increments its occurrence count.
An acknowledged or suppressed event remains the same event; a suppression
expires automatically. A changed or absent action resolves older active events.

When Azure Monitor delivery is enabled and the notification cooldown has
elapsed, the event is written to the durable `azure_monitor_outbox`. The Python
dispatcher, not PostgreSQL, delivers that record. A failed delivery is retried
with backoff; a resolved event also receives an outbox record.

To tune the default policy, update the row rather than editing the installer:

```sql
UPDATE pg_workload_advisor.advisory_policy
SET
    minimum_pressure_samples = 4,
    pressure_window = interval '90 minutes',
    notification_cooldown = interval '45 minutes',
    updated_at = clock_timestamp()
WHERE policy_name = 'default';
```

Use `latest_advice()` to inspect the most recent evidence payload and
`recommendation_calibration` to compare recorded operator outcomes by action
and confidence. Tune thresholds from that feedback, not from a single event.