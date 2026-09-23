\set ECHO none

CREATE EXTENSION pg_stat_statements;
CREATE EXTENSION pg_workload_advisor;

SELECT extname, extnamespace::regnamespace
FROM pg_extension
WHERE extname = 'pg_workload_advisor';

SELECT 1 AS pg_workload_advisor_regression_probe;

SELECT
    count(*) > 0 AS query_scores_return_rows,
    bool_and(queryid IS NOT NULL) AS query_scores_have_queryids,
    bool_and(total_exec_ms >= 0) AS query_scores_have_execution_time
FROM pg_workload_advisor.query_scores();

CREATE TEMP TABLE pg_workload_advisor_capture_assertions (
    payload jsonb NOT NULL
);

INSERT INTO pg_workload_advisor_capture_assertions (payload)
SELECT pg_workload_advisor.capture(
    p_pressure_samples => 1,
    p_pressure_window_minutes => 60,
    p_min_window_seconds => 0
);

SELECT
    payload ? 'capture_key' AS has_capture_key,
    payload ? 'workload' AS has_workload,
    payload ? 'resource' AS has_resource,
    payload ? 'window' AS has_window,
    payload ? 'recommendation' AS has_recommendation,
    payload -> 'recommendation' ? 'action' AS has_action,
    payload -> 'recommendation' ? 'confidence' AS has_confidence
FROM pg_workload_advisor_capture_assertions;

SELECT
    count(*) = 1 AS history_has_capture,
    bool_and(recommended_action IS NOT NULL) AS history_has_action,
    bool_and(payload ? 'recommendation') AS history_has_payload
FROM pg_workload_advisor.capture_history;

SELECT pg_workload_advisor.record_feedback(
    payload ->> 'capture_key',
    payload -> 'recommendation' ->> 'action',
    'improved',
    'pg_regress feedback'
) > 0 AS feedback_recorded
FROM pg_workload_advisor_capture_assertions;

SELECT
    count(*) = 1 AS calibration_has_group,
    max(feedback_count) = 1 AS calibration_has_feedback,
    max(positive_outcome_count) = 1 AS calibration_has_positive_outcome
FROM pg_workload_advisor.recommendation_calibration;

UPDATE pg_workload_advisor.advisory_policy
SET
    minimum_confidence = 'LOW',
    minimum_pressure_samples = 1,
    minimum_window_seconds = 0,
    cpu_pct = 90,
    notification_cooldown = interval '0 seconds'
WHERE policy_name = 'default';

SELECT pg_workload_advisor.ingest_infrastructure_telemetry(
    p_source => 'pg_regress',
    p_cpu_pct => 99
) > 0 AS infrastructure_telemetry_ingested;

CREATE TEMP TABLE pg_workload_advisor_event_assertions (
    payload jsonb NOT NULL
);

INSERT INTO pg_workload_advisor_event_assertions (payload)
SELECT pg_workload_advisor.run_advisory_cycle('default');

SELECT
    payload ? 'automatedAdvisory' AS cycle_has_automation,
    payload -> 'automatedAdvisory' ? 'eventId' AS cycle_has_event,
    payload -> 'automatedAdvisory' ? 'outboxId' AS cycle_queues_outbox
FROM pg_workload_advisor_event_assertions;

CREATE TEMP TABLE pg_workload_advisor_outbox_assertions AS
SELECT *
FROM pg_workload_advisor.claim_azure_monitor_outbox(10, 60);

SELECT
    count(*) = 1 AS outbox_has_event,
    bool_and(event_type = 'activated') AS outbox_is_activation,
    bool_and(attempts = 1) AS outbox_claimed_once
FROM pg_workload_advisor_outbox_assertions;

SELECT pg_workload_advisor.complete_azure_monitor_delivery(
    (SELECT outbox_id FROM pg_workload_advisor_outbox_assertions LIMIT 1),
    true
) AS azure_monitor_delivery_completed;

SELECT pg_workload_advisor.acknowledge_advisory_event(
    (SELECT event_id FROM pg_workload_advisor_outbox_assertions LIMIT 1)
) AS advisory_event_acknowledged;

SELECT pg_workload_advisor.suppress_advisory_event(
    (SELECT event_id FROM pg_workload_advisor_outbox_assertions LIMIT 1),
    60
) AS advisory_event_suppressed;

UPDATE pg_workload_advisor.advisory_event
SET last_seen_at = clock_timestamp() - interval '3 hours'
WHERE event_id = (SELECT event_id FROM pg_workload_advisor_outbox_assertions LIMIT 1);

SELECT pg_workload_advisor.resolve_stale_advisories() = 1 AS stale_event_resolved;

CREATE TEMP TABLE pg_workload_advisor_resolution_outbox_assertions AS
SELECT *
FROM pg_workload_advisor.claim_azure_monitor_outbox(10, 60);

SELECT
    count(*) = 1 AS resolution_outbox_has_event,
    bool_and(event_type = 'resolved') AS resolution_outbox_is_resolved
FROM pg_workload_advisor_resolution_outbox_assertions;

SELECT pg_workload_advisor.complete_azure_monitor_delivery(
    (SELECT outbox_id FROM pg_workload_advisor_resolution_outbox_assertions LIMIT 1),
    false,
    'pg_regress retry test',
    2
) AS azure_monitor_delivery_requeued;

SELECT
    count(*) = 1 AS retry_outbox_has_event,
    bool_and(status = 'pending') AS retry_outbox_is_pending,
    bool_and(last_error = 'pg_regress retry test') AS retry_outbox_has_error
FROM pg_workload_advisor.azure_monitor_outbox
WHERE outbox_id = (SELECT outbox_id FROM pg_workload_advisor_resolution_outbox_assertions LIMIT 1);

SELECT pg_workload_advisor.reset_stats() AS reset_when_disabled;

SET pg_workload_advisor.reset_stats = on;

SELECT pg_workload_advisor.capture_and_reset(
    p_pressure_samples => 1,
    p_pressure_window_minutes => 60,
    p_min_window_seconds => 0
) ? 'recommendation' AS capture_and_reset_returns_capture;

SELECT
    pg_workload_advisor.capture(
        p_pressure_samples => 1,
        p_pressure_window_minutes => 60,
        p_min_window_seconds => 0
    ) -> 'window' ->> 'blocker' AS reset_blocker;

SELECT
    pg_workload_advisor.latest_advice() -> 'recommendation' ->> 'action'
        AS latest_action_is_available;

DROP EXTENSION pg_workload_advisor CASCADE;
DROP EXTENSION pg_stat_statements;
\echo pg_workload_advisor_regression_complete