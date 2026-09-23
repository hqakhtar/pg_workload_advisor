# Extension fixture provenance

The SQL and control files in `pg_workload_advisor/` are byte-for-byte copies of
the current [extension SQL](../../../pg_workload_advisor--1.0.sql) and
[control file](../../../pg_workload_advisor.control) in this repository:

https://github.com/hqakhtar/pg_workload_advisor

The extension remains version 1.0. `pg_workload_advisor.tar.gz` packages these
two files under `share/postgresql/extension/` for installation by the test
PostgreSQL engine. It contains no replacement statistics views or stub advisor
functions. The integration tests compare the fixture SQL and control files
with the source package so changes cannot silently leave those copies stale.

After changing the extension, refresh the copies and archive from the repository
root using GNU tar and gzip:

```bash
cp pg_workload_advisor--1.0.sql pg_workload_advisor.control \
  dashboard/test/fixtures/pg_workload_advisor/
tar --format=ustar --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  --transform='s,^,share/postgresql/extension/,' -cf - \
  pg_workload_advisor--1.0.sql pg_workload_advisor.control \
  | gzip -n > dashboard/test/fixtures/pg_workload_advisor.tar.gz
```

These files are test fixtures only. The application never installs extensions or runs these installation scripts against a user database. The tests install them in a disposable PostgreSQL WebAssembly instance with its real pg_stat_statements module, then exercise the application over local TCP and HTTP. Native backend concurrency, SCRAM authentication, and a distributed Citus cluster require separate native testing.

The PostgreSQL 17 engine comes from `@electric-sql/pglite` 0.4.0. Its compatible PostgreSQL 17.5 `pg_stat_statements` bundle is copied unchanged from the published `@electric-sql/pglite` 0.3.14 package into `pg_stat_statements-pg17.tar.gz` (SHA-256 `7112b78d2c5566b9ed4c3df6601b1050d599ee3252373077f3270eb3dca578b7`). The PostgreSQL 18 engine and extension bundle come from `@electric-sql/pglite` 0.5.8. These are test dependencies only; the application uses node-postgres to connect to the user's native PostgreSQL server.
