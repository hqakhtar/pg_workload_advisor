\set ECHO none

CREATE EXTENSION citus;
CREATE EXTENSION pg_stat_statements;
CREATE EXTENSION pg_workload_advisor;

CREATE TEMP TABLE pg_workload_advisor_citus_assertions (
    assertion_name text PRIMARY KEY,
    passed boolean NOT NULL
);

INSERT INTO pg_workload_advisor_citus_assertions
SELECT
    'citus_extension_is_installed',
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus');

INSERT INTO pg_workload_advisor_citus_assertions
SELECT
    'citus_stat_statements_view_is_available',
    to_regclass('pg_catalog.citus_stat_statements') IS NOT NULL;

INSERT INTO pg_workload_advisor_citus_assertions
SELECT
    'cross_node_metrics_executes_with_citus',
    (SELECT count(*) >= 0 FROM pg_workload_advisor._cross_node_metrics());

INSERT INTO pg_workload_advisor_citus_assertions
SELECT
    'cluster_fairness_executes_with_citus',
    pg_workload_advisor.cluster_fairness() IS NULL
    OR pg_workload_advisor.cluster_fairness() IS NOT NULL;

CREATE TABLE pg_workload_advisor_citus_probe (
    id integer PRIMARY KEY,
    value text NOT NULL
);

INSERT INTO pg_workload_advisor_citus_probe VALUES (1, 'probe');
SELECT * FROM pg_workload_advisor_citus_probe WHERE id = 1;

INSERT INTO pg_workload_advisor_citus_assertions
SELECT
    'query_scores_executes_with_citus',
    (SELECT count(*) > 0 FROM pg_workload_advisor.query_scores());

CREATE TEMP TABLE pg_workload_advisor_citus_capture AS
SELECT pg_workload_advisor.capture(
    p_pressure_samples => 1,
    p_pressure_window_minutes => 60,
    p_min_window_seconds => 0
) AS payload;

INSERT INTO pg_workload_advisor_citus_assertions
SELECT
    'capture_reports_citus_installed',
    coalesce((payload #>> '{workload,citus_installed}')::boolean, false)
FROM pg_workload_advisor_citus_capture;

SELECT assertion_name, passed
FROM pg_workload_advisor_citus_assertions
ORDER BY assertion_name;

DROP EXTENSION pg_workload_advisor CASCADE;
DROP EXTENSION pg_stat_statements;
DROP EXTENSION citus CASCADE;
\echo pg_workload_advisor_citus_regression_complete