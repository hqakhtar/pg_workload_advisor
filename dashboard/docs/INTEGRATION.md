# PostgreSQL integration reference

Dynamic Node.js application with the existing dashboard and a server-side PostgreSQL connection. No cloud service is required. The dashboard folder is self-contained. See [README.md](../README.md) for Windows, Ubuntu and demo-mode setup.

On the first overview visit, a nine-step walkthrough explains the sections. Use **Help & guide** in the left menu to reopen it or read the reference guide. Help works even before connecting. Tour completion is remembered in browser storage; it does not store database details or dashboard data.

## Start on your laptop

Install Node.js 22 or later. In this directory run:

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4317**. The server listens only on IPv4 loopback. These commands work on Windows, macOS and Linux. In WSL, start the app inside WSL; localhost forwarding normally lets a Windows browser reach it. Use `PORT` to choose another port if needed.

Choose **PostgreSQL connection** in the **Data source** selector or use **Connect PostgreSQL**. Fill in host, port, database, username, password and TLS mode. Enter the password normally: the server encodes reserved characters for you. The selector shows **PostgreSQL · connected** once the connection succeeds. Use **Connection settings…** to switch servers.

Alternatively, select **Connection URI** in the form and enter a URI:

```text
postgresql://advisor_user:URL_ENCODED_PASSWORD@localhost:5432/mydb?sslmode=disable
postgresql://advisor_user:URL_ENCODED_PASSWORD@database.example:5432/mydb?sslmode=verify-full
```

In URI mode, percent-encode reserved characters in the username/password. URI options are limited to `sslmode`. Supported modes: `disable`, `require`, `verify-ca`, `verify-full`. For this app all TLS-enabled modes enforce both certificate trust and hostname verification; `require` does not bypass verification. The default is verified TLS. Use the optional PEM CA field for private certificate authorities. There is no “ignore certificate errors” setting. The dashboard makes no external font or CDN requests.

The password, URI and CA fields are cleared on submission, changing entry method, or closing the form. The server keeps credentials in memory, scoped to a browser session; it never writes connection strings to files or logs. Disconnect, restart the server, or leave the session inactive for 30 minutes to close its pool. Auto-refresh keeps the session active. Different tabs share the localhost session cookie. There is no arbitrary SQL endpoint.

## Database prerequisites

The target database must have PostgreSQL 17+, `pg_stat_statements`, and **pg_workload_advisor 1.0** installed. This app does not install extensions, run arbitrary uploaded SQL, or execute the three regression scripts. Those scripts create/drop objects and must not be used to refresh a production dashboard. Install the extension through its normal packaging and configuration first.

Compatibility is checked against [this repository's extension source](../../pg_workload_advisor--1.0.sql), maintained at [hqakhtar/pg_workload_advisor](https://github.com/hqakhtar/pg_workload_advisor). Test fixtures must match both the SQL and control files in the repository root. Connection checks verify the required function signatures, read access to latest advice, and that `pg_stat_statements` is actually preloaded. The dependency can be installed in a custom schema.

Use a database role with CONNECT, USAGE on `pg_workload_advisor`, SELECT on its capture/policy/event/telemetry/outbox/feedback tables, and EXECUTE on the advisor read functions and their underlying functions. The extension functions are invoker-security functions; `query_scores()` also needs visibility into statistics (`pg_read_all_stats` where appropriate), and underlying dependencies must be readable. The server checks version and basic identity on connection. Optional read failures are shown per section instead of hiding the whole dashboard.

The reader and collector must use the same server identity. In this extension, `_server_id()` uses `pg_control_system()` when allowed and otherwise falls back to the server address/port. If roles have different privileges, their identities can differ and the reader may not find the collector's captures. The dashboard detects existing captures under a different identity and explains the mismatch. Have a DBA align the roles or their EXECUTE privilege on `pg_catalog.pg_control_system()`; the app never grants privileges or merges unrelated server histories.

For **Collect & evaluate**, the role additionally needs the table and sequence privileges and function execution privileges required by `run_advisory_cycle()`, `capture()`, `evaluate_capture()`, and `resolve_stale_advisories()`. These update captures and events and may enqueue notifications. Grant the required permissions according to your operational role policy; the app never grants them automatically. A SELECT-only role can use Refresh data when a separate collector populates the tables.

## Refresh semantics

- **Refresh data** reads the latest saved advice and supporting records in a read-only, repeatable-read transaction. It does not create a new capture.
- **Collect & evaluate** calls `SELECT pg_workload_advisor.run_advisory_cycle($1)` with the selected policy, then refreshes all views. This writes captures/events and may enqueue Azure Monitor messages. It never resets PostgreSQL statistics, changes capacity, executes a rebalance, or changes settings.
- **Read every 30 seconds / every minute** only polls existing data.
- **Collect every 5 / 15 minutes** schedules real collection while the page remains open. The actual interval is at least the policy's minimum interval plus two seconds. The backend also checks the latest capture age and rejects early collection; it does not force invalid windows. Browser background throttling may delay scheduled work; use an external scheduler for continuous collection.
- One transaction advisory lock serializes collections made by instances of this dashboard. External collectors that do not use the same lock remain independent; coordinate capture scheduling operationally.

The first collection creates a baseline. Default policy needs at least 300 seconds between captures and sufficient samples for sustained pressure. The dashboard will accurately show LOW confidence / REVIEW_TELEMETRY until the extension has enough evidence.

## Live data mapping

The app retrieves latest advice, up to 120 captures, 100 top query scores, the selected policy, 50 events, 120 infrastructure samples, 50 outbox records, and feedback calibration. Queries are scoped by server identifier and current database OID, and policy where applicable. Numeric query fields are cast for rendering; query IDs remain text to avoid JavaScript integer precision loss.

The capture action and policy-evaluated action remain distinct. The policy action is attached only when a current event refers to the exact latest capture and selected policy, or when this page has just received the current cycle result. Older events never overwrite newer advice. When reading `latest_advice()` alone, “no policy event” does not prove a completed no-action evaluation; the UI says so.

CPU/memory/storage metrics require an external process to ingest `infrastructure_telemetry`; they cannot be inferred from PostgreSQL query counters. Missing sections are shown as unavailable, with no demo fallback. Query scores are read at refresh time and can be newer than the selected saved capture. The capture timestamp and read timestamp are both visible. Sample scenarios are available in the separate demo mode (npm run demo); PostgreSQL mode never fills missing sections with sample rows.

Infrastructure evidence from an exact matching event is preserved. Otherwise the resource panel only uses a sample at or before the capture within the selected policy's `telemetry_max_age`; older or future samples are not silently attached. The headline includes the exact extension action, alongside its relevant category tag. Capture tags and advice text come from the returned recommendation; a different policy action uses the corresponding category mapping. Raw capture details preserve the original JSON, and policy drill-downs use the selected policy's actual sample count and pressure window.

## Tests

```sh
npm test
```

The SQL integration tests install the repository-matched extension fixture into disposable PostgreSQL 17.5 and 18.3 WebAssembly instances with real `pg_stat_statements`, then exercise the production `pg` driver over TCP and the HTTP API. They check extension installation, custom dependency schemas, baseline capture, refresh without writes, interval enforcement, policy events, outbox reads, feedback, optional permission failures, stale telemetry and displayed output. A separate contract test checks every explicit scaling category against the extension SQL. TLS tests use an ephemeral TLS proxy and verify trusted, untrusted and mismatched certificates; they require OpenSSL. These engines use trust authentication and do not test native SCRAM authentication, backend concurrency or distributed Citus nodes.

To verify an actual PostgreSQL server using the same application functions, set `ADVISOR_DATABASE_URL` and run:

```sh
npm run verify-db
```

This performs read-only checks and reports section row counts and warnings without printing the URI, query text or password. Set `ADVISOR_CA_FILE` for a private CA and `ADVISOR_POLICY` for a non-default policy. Exit status is 0 for successful reads, 2 for section warnings, or 1 for a connection/query failure. To explicitly collect and evaluate a new capture as well, run `npm run verify-db -- --collect`; this writes advisor records and respects the policy interval. No credentials for the user's own PostgreSQL instance were supplied during development.

## Driver references

- [node-postgres connection URIs](https://node-postgres.com/features/connecting)
- [node-postgres SSL configuration](https://node-postgres.com/features/ssl)
