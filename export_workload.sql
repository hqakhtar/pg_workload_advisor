\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
\pset pager off

SELECT jsonb_pretty(pg_workload_advisor.capture());