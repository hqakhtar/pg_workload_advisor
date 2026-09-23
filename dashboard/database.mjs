import pg from 'pg';
import { checkServerIdentity } from 'node:tls';
import { isIP } from 'node:net';

export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function connectionUriFromSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new AppError(400, 'Enter PostgreSQL connection settings.');
  const host = typeof settings.host === 'string' ? settings.host.trim().replace(/^\[|\]$/g, '') : '';
  if (!host || host.length > 253 || (!isIP(host) && !/^[a-zA-Z0-9_.-]+$/.test(host))) throw new AppError(400, 'Enter a hostname or IP address without a protocol or port.');
  const port = String(settings.port ?? '5432');
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new AppError(400, 'Port must be between 1 and 65535.');
  for (const [key, label] of [['database', 'Database'], ['username', 'Username']]) {
    if (typeof settings[key] !== 'string' || !settings[key].trim() || settings[key].length > 1024 || settings[key].includes('\0')) throw new AppError(400, `${label} is required and must be valid text.`);
  }
  const password = settings.password ?? '';
  if (typeof password !== 'string' || password.length > 8192 || password.includes('\0')) throw new AppError(400, 'Enter a valid password or leave it blank.');
  const mode = settings.sslmode ?? 'verify-full';
  if (!['disable', 'require', 'verify-ca', 'verify-full'].includes(mode)) throw new AppError(400, 'Choose a supported TLS mode.');
  return `postgresql://${encodeURIComponent(settings.username)}:${encodeURIComponent(password)}@${isIP(host) === 6 ? '[' + host + ']' : host}:${Number(port)}/${encodeURIComponent(settings.database)}?sslmode=${mode}`;
}

export function connectionOptions(connectionString, ca = '') {
  if (typeof connectionString !== 'string' || connectionString.length > 16384) throw new AppError(400, 'Enter a PostgreSQL connection URI.');
  let uri;
  try { uri = new URL(connectionString); } catch { throw new AppError(400, 'Use postgresql://user:password@host:5432/database.'); }
  if (!['postgres:', 'postgresql:'].includes(uri.protocol) || !uri.hostname) throw new AppError(400, 'Use a PostgreSQL connection URI with a hostname.');
  // Do not permit connection-string options that cause local file reads or override timeouts.
  for (const key of uri.searchParams.keys()) if (!['sslmode'].includes(key)) throw new AppError(400, 'Only sslmode is supported as a URI option. Use the CA certificate field for custom trust.');
  const mode = uri.searchParams.get('sslmode') || 'verify-full';
  if (!['disable', 'require', 'verify-ca', 'verify-full'].includes(mode)) throw new AppError(400, 'sslmode must be disable, require, verify-ca, or verify-full.');
  if (typeof ca !== 'string' || ca.length > 100000 || (ca && !ca.includes('-----BEGIN CERTIFICATE-----'))) throw new AppError(400, 'Provide a PEM CA certificate or leave it blank.');
  const hostname = uri.hostname.replace(/^\[|\]$/g, '');
  let credentials;
  try {
    credentials = { user: decodeURIComponent(uri.username) || undefined, password: decodeURIComponent(uri.password), database: decodeURIComponent(uri.pathname.slice(1)) || undefined };
  } catch { throw new AppError(400, 'Connection URI contains invalid percent-encoding. Use connection settings or encode each URI field correctly.'); }
  // Pass decoded fields directly: pg's URI parser retains IPv6 brackets and some
  // encoded database-name characters, and URI SSL options can override TLS checks.
  return { ...credentials, host: hostname, port: Number(uri.port || 5432), ssl: mode === 'disable' ? false : { rejectUnauthorized: true, checkServerIdentity: (_name, cert) => checkServerIdentity(hostname, cert), ...(ca ? { ca } : {}) }, max: 2, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, statement_timeout: 20000, query_timeout: 25000, application_name: 'pg_workload_advisor_dashboard' };
}

export function safeError(error) {
  if (error instanceof AppError) return { status: error.status, error: error.message };
  if (error.message === 'The server does not support SSL connections') return { status: 502, error: 'This server does not support TLS. Enable TLS on PostgreSQL, or explicitly use sslmode=disable for a trusted local connection.' };
  if (error.message === 'SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string') return { status: 400, error: 'PostgreSQL requires a password. Enter it in the password field, or include it URL-encoded in the connection URI.' };
  const messages = {
    '28P01': 'PostgreSQL rejected the username or password.', '28000': 'PostgreSQL authentication or pg_hba.conf rejected the connection.',
    '3D000': 'The requested database does not exist.', '42501': 'The database role lacks permission for this advisor operation. Check schema, table, and function privileges.',
    '42883': 'An expected advisor function is missing. Install the supplied pg_workload_advisor 1.0 extension.',
    '42P01': 'An advisor table or dependency is missing. Verify the extension installation.', '3F000': 'The advisor schema is missing. Install the extension in this database.',
    '55000': 'PostgreSQL statistics are not ready. Ensure pg_stat_statements is in shared_preload_libraries and restart PostgreSQL.',
    '57014': 'The database query timed out or was cancelled.', '25006': 'This PostgreSQL connection is read-only. Refresh can read existing data; collection requires a writable server and role.',
    ECONNREFUSED: 'PostgreSQL refused the connection. Check its host, port and listener.', ENOTFOUND: 'The database hostname could not be resolved.',
    ECONNRESET: 'The PostgreSQL connection was interrupted. Check server availability and reconnect.',
    ETIMEDOUT: 'The database connection timed out.', SELF_SIGNED_CERT_IN_CHAIN: 'TLS certificate is not trusted. Supply the database CA certificate.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS certificate is self-signed. Supply the database CA certificate.', ERR_TLS_CERT_ALTNAME_INVALID: 'The TLS certificate does not match the database hostname.',
    CERT_HAS_EXPIRED: 'The database TLS certificate has expired.', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The database TLS certificate chain could not be verified.'
  };
  // Never return driver error text: it can contain usernames, hosts, SQL or secrets.
  return { status: 502, error: messages[error.code] || 'Database operation failed. Check connectivity, TLS, advisor installation and role permissions.', code: /^[A-Z0-9_]{2,48}$/.test(error.code || '') ? error.code : undefined };
}

export async function openDatabase(connectionString, ca, Pool = pg.Pool) {
  const pool = new Pool(connectionOptions(connectionString, ca));
  pool.on('error', () => {});
  try {
    const { rows } = await pool.query(`SELECT current_setting('server_version_num')::int AS version,
      current_database() AS database, (SELECT extversion FROM pg_extension WHERE extname='pg_workload_advisor') AS advisor_version,
      EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements') AS pgss,
      (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_stat_statements') AS pgss_schema`);
    const info = rows[0];
    if (info.version < 170000) throw new AppError(409, 'The supplied advisor requires PostgreSQL 17 or later.');
    if (info.advisor_version !== '1.0' || !info.pgss) throw new AppError(409, 'Install pg_workload_advisor version 1.0 and pg_stat_statements in this database first. No installation scripts are executed automatically.');
    const requiredFunctions = ['_server_id()', 'latest_advice()', 'query_scores()', 'resource_snapshot()', 'run_advisory_cycle(text)'];
    const missing = (await pool.query(`SELECT signature FROM unnest($1::text[]) AS signature WHERE to_regprocedure(signature) IS NULL`,
      [requiredFunctions.map(signature => 'pg_workload_advisor.' + signature)])).rows;
    if (missing.length) throw new AppError(409, 'The advisor installation is incomplete. Reinstall the matching pg_workload_advisor 1.0 package before connecting.');
    // An installed pg_stat_statements extension is not necessarily preloaded.
    const pgssSchema = '"' + info.pgss_schema.replaceAll('"', '""') + '"';
    await pool.query(`SELECT stats_reset FROM ${pgssSchema}.pg_stat_statements_info`);
    await pool.query('SELECT pg_workload_advisor.latest_advice() AS payload');
    const identity = await pool.query(`SELECT pg_workload_advisor._server_id() AS server_id,
      (SELECT oid::integer FROM pg_database WHERE datname=current_database()) AS database_oid`);
    return { pool, info: { ...info, ...identity.rows[0] } };
  } catch (error) { await pool.end(); throw error; }
}

export async function readDashboard(pool, policyName = 'default') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query(`SELECT pg_workload_advisor._server_id() AS server_id,
      (SELECT oid::integer FROM pg_database WHERE datname=current_database()) AS database_oid,
      pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS all_statistics_visible`)).rows[0];
    const scope = [identity.server_id, identity.database_oid];
    const capture = (await client.query('SELECT pg_workload_advisor.latest_advice() AS payload')).rows[0]?.payload ?? null;
    const warnings = [];
    if (identity.all_statistics_visible === false) warnings.push({ section: 'statistics visibility', message: 'This role cannot see every user’s query statistics. Use the collector role or have your DBA grant pg_read_all_stats for complete workload evidence.' });
    const optional = async (name, sql, args = []) => {
      await client.query('SAVEPOINT section_read');
      try { const result = await client.query(sql, args); await client.query('RELEASE SAVEPOINT section_read'); return result.rows; }
      catch (error) { await client.query('ROLLBACK TO SAVEPOINT section_read'); await client.query('RELEASE SAVEPOINT section_read'); warnings.push({ section: name, message: safeError(error).error }); return []; }
    };
    const policies = await optional('policies', 'SELECT *, extract(epoch FROM telemetry_max_age)::float8 AS telemetry_max_age_seconds FROM pg_workload_advisor.advisory_policy ORDER BY policy_name');
    const selectedPolicy = policies.find(p => p.policy_name === policyName) ?? null;
    const history = await optional('history', `SELECT capture_key,collected_at,resource_pressure_status,recommended_action,recommendation_confidence,payload
      FROM pg_workload_advisor.capture_history WHERE server_id=$1 AND database_oid=$2 ORDER BY collected_at DESC LIMIT 120`, scope);
    if (!capture) {
      const otherScopes = await optional('server identity', `SELECT EXISTS(SELECT 1 FROM pg_workload_advisor.capture_history WHERE database_oid=$1 AND server_id<>$2) AS found`, [identity.database_oid, identity.server_id]);
      if (otherScopes[0]?.found) warnings.push({ section: 'server identity', message: 'Captures exist for this database under a different server identity. The extension’s identity depends on access to pg_control_system(). Use the collector role or ask your DBA to align that function privilege; records from another identity are not combined automatically.' });
    }
    const queries = await optional('queries', `SELECT queryid::text,calls::float8,total_exec_ms::float8,mean_exec_ms::float8,
      rows_per_call::float8,io_weight::float8,oltp_raw::float8,olap_raw::float8,htap_raw::float8,timeseries_raw::float8,is_cross_node,query_sample
      FROM pg_workload_advisor.query_scores() ORDER BY total_exec_ms DESC LIMIT 100`);
    const events = await optional('events', `SELECT event_id::text,policy_name,capture_key,action,severity,state,first_seen_at,last_seen_at,occurrence_count,payload
      FROM pg_workload_advisor.advisory_event WHERE server_id=$1 AND database_oid=$2 AND policy_name=$3 ORDER BY last_seen_at DESC LIMIT 50`, [...scope, policyName]);
    // Tie recommendation evidence to this exact capture. Never overlay an older event onto new advice.
    const matchingEvent = events.find(e => e.capture_key === capture?.capture_key && ['open', 'acknowledged', 'suppressed'].includes(e.state)) ?? null;
    const infrastructure = await optional('infrastructure', `SELECT collected_at,source,cpu_pct::float8,memory_pct::float8,storage_latency_ms::float8,
      storage_queue_depth::float8,iops_utilization_pct::float8,application_latency_ms::float8,slo_error_pct::float8
      FROM pg_workload_advisor.infrastructure_telemetry WHERE server_id=$1 AND database_oid=$2 ORDER BY collected_at DESC LIMIT 120`, scope);
    const captureTime = Date.parse(capture?.collected_at);
    const maxAge = Number(selectedPolicy?.telemetry_max_age_seconds);
    const captureTelemetry = Number.isFinite(captureTime) && Number.isFinite(maxAge) ? infrastructure.find(row => {
      const age = (captureTime - Date.parse(row.collected_at)) / 1000;
      return age >= 0 && age <= maxAge;
    }) ?? null : null;
    const outbox = await optional('outbox', `SELECT o.outbox_id::text,o.event_id::text,o.event_type,o.status,o.attempts,o.created_at,o.delivered_at
      FROM pg_workload_advisor.azure_monitor_outbox o JOIN pg_workload_advisor.advisory_event e USING(event_id)
      WHERE e.server_id=$1 AND e.database_oid=$2 AND e.policy_name=$3 ORDER BY o.created_at DESC LIMIT 50`, [...scope, policyName]);
    const calibration = await optional('calibration', `SELECT h.recommended_action,h.recommendation_confidence,count(f.feedback_id)::int AS feedback_count,
      count(f.feedback_id) FILTER(WHERE f.outcome IN('success','improved','confirmed_benefit'))::int AS positive_outcome_count
      FROM pg_workload_advisor.capture_history h LEFT JOIN pg_workload_advisor.recommendation_feedback f USING(capture_key)
      WHERE h.server_id=$1 AND h.database_oid=$2 GROUP BY h.recommended_action,h.recommendation_confidence`, scope);
    await client.query('COMMIT');
    return { fetchedAt: new Date().toISOString(), capture, identity, selectedPolicy, policies, history, queries, events, matchingEvent, infrastructure, captureTelemetry, outbox, calibration, warnings };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function collectCapture(pool, policyName) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: locks } = await client.query(`SELECT pg_try_advisory_xact_lock(hashtext('pg_workload_advisor_dashboard'),
      (SELECT oid::integer FROM pg_database WHERE datname=current_database())) AS acquired`);
    if (!locks[0].acquired) throw new AppError(409, 'Another dashboard collection is running. Refresh in a moment.');
    const { rows } = await client.query(`SELECT p.enabled,p.minimum_window_seconds,
      extract(epoch FROM clock_timestamp() - (SELECT max(collected_at) FROM pg_workload_advisor.capture_history
        WHERE server_id=pg_workload_advisor._server_id() AND database_oid=(SELECT oid FROM pg_database WHERE datname=current_database())))::float8 AS age_seconds
      FROM pg_workload_advisor.advisory_policy p WHERE p.policy_name=$1`, [policyName]);
    if (!rows.length) throw new AppError(400, 'The selected advisor policy does not exist.');
    if (!rows[0].enabled) throw new AppError(409, 'The selected advisor policy is disabled.');
    if (rows[0].age_seconds !== null && rows[0].age_seconds < rows[0].minimum_window_seconds) throw new AppError(409, `Wait ${Math.ceil(rows[0].minimum_window_seconds - rows[0].age_seconds)} seconds before collecting again to preserve a valid capture interval.`);
    const capture = (await client.query('SELECT pg_workload_advisor.run_advisory_cycle($1) AS payload', [policyName])).rows[0].payload;
    await client.query('COMMIT');
    return capture;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
