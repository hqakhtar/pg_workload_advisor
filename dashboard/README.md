# PG Workload Advisor dashboard

A standalone local dashboard for **pg_workload_advisor 1.0**. It includes scaling advice and the relevant extension tag, workload and resource evidence, distribution, history, policy events, JSON inspection, and the Help & guide walkthrough.

This dashboard is included in the
[PG Workload Advisor repository](https://github.com/hqakhtar/pg_workload_advisor)
at:

`pg_workload_advisor/dashboard/`

No separate dashboard ZIP, build step, Python, Docker, cloud account, or extension Makefile change is needed to run it. No database credentials or installed npm dependencies are included.

## Choose a mode

| Mode | Command from dashboard/ | Default address | Requirements |
| --- | --- | --- | --- |
| Demo / no PostgreSQL | `npm run demo` | http://127.0.0.1:4318 | Node.js only; no npm install and no database |
| Live PostgreSQL | `npm ci --omit=dev` once, then `npm start` | http://127.0.0.1:4317 | Node.js, npm dependencies, access to a prepared PostgreSQL 17+ database |

In Windows PowerShell, use **npm.cmd** in place of **npm** if PowerShell blocks npm.ps1. The Windows examples below already use npm.cmd.

Both servers listen only on 127.0.0.1. Leave the terminal open; stop with **Ctrl+C**. Open the printed HTTP address rather than double-clicking index.html.

## 1. Install Node.js

Use **Node.js 24 LTS** (recommended), or Node.js 22. Node.js 24 and 22 are listed as LTS on the [official release page](https://nodejs.org/en/about/previous-releases). Node.js installation includes npm.

### Windows 10/11

Install the Windows installer for Node.js 24 LTS from [nodejs.org/download](https://nodejs.org/en/download), selecting the architecture of your machine. Keep the option to add Node.js to PATH. Reopen PowerShell after installation:

```powershell
node --version
npm.cmd --version
```

The dashboard can run natively on Windows and connect to a PostgreSQL server on Windows, Ubuntu, WSL, or a reachable remote host. PostgreSQL does not need to be installed on the Windows laptop if the server is elsewhere.

### Ubuntu 22.04 or 24.04

If Node.js 22 or 24 is already installed, skip installation. Otherwise one option is nvm, using its [documented installer](https://github.com/nvm-sh/nvm#installing-and-updating):

```bash
sudo apt update
sudo apt install -y curl ca-certificates unzip
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh -o /tmp/pg-workload-advisor-nvm-install.sh
bash /tmp/pg-workload-advisor-nvm-install.sh
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24
node --version
npm --version
```

These commands apply to both Ubuntu versions, including Ubuntu under WSL. Do not run npm as root. The included .nvmrc selects Node.js 24 when you run `nvm use` from this folder.

## 2. Get the repository and run without PostgreSQL

Clone the repository with Git, or use an existing checkout. The commands below
start in the folder where you want the checkout.

### Windows PowerShell

```powershell
git clone https://github.com/hqakhtar/pg_workload_advisor.git
Set-Location pg_workload_advisor\dashboard
npm.cmd run demo
```

### Ubuntu 22.04 / 24.04

```bash
git clone https://github.com/hqakhtar/pg_workload_advisor.git
cd pg_workload_advisor/dashboard
npm run demo
```

Open **http://127.0.0.1:4318**.

- The **Data source** dropdown contains five sample scenarios.
- **Import advisor JSON** accepts output from latest_advice(), run_advisory_cycle(), or an advisory-event payload. Pasted JSON stays in page memory and is not uploaded.
- **Help & guide** explains the sections and can restart the walkthrough.
- PostgreSQL setup is visible, but password entry, refresh and collection are disabled in demo mode. The mode banner makes this explicit.
- **PostgreSQL connection** in the selector explains how to start live mode. It does not label sample data as connected.

Demo mode also starts directly with `node demo.mjs`. It does not import the PostgreSQL driver or require node_modules. After Node.js and the repository are present, it works offline.

## 3. Run with a PostgreSQL connection

From the same dashboard folder, use a separate terminal or stop demo mode first.

### Windows PowerShell

```powershell
npm.cmd ci --omit=dev
npm.cmd start
```

### Ubuntu 22.04 / 24.04

```bash
npm ci --omit=dev
npm start
```

Open **http://127.0.0.1:4317**. The initial npm ci downloads dependencies; later starts do not require internet access unless your database is remote. Runtime dependencies are JavaScript packages; the dashboard does not require a C compiler or PostgreSQL client tools.

1. Choose **PostgreSQL connection** in **Data source**, or click **Connect PostgreSQL**.
2. Enter host, port, database, username, password and TLS mode.
3. Click **Connect & load data**. The dropdown changes to **PostgreSQL · connected** after a successful connection.
4. Use **Connection settings…** to change servers, or **Disconnect** to close the session.

| Field | Example / behavior |
| --- | --- |
| Host | 127.0.0.1 or db.example.com; no protocol or port |
| Port | 5432 by default; use your actual PostgreSQL/Citus port |
| Database | The database where pg_workload_advisor is installed |
| Username | A role with the required advisor privileges |
| Password | Enter normally; reserved characters are encoded automatically |
| TLS / SSL | Verified certificate and hostname by default; Disabled only for a trusted server without TLS |
| Custom CA | Paste a PEM certificate when your database uses a private CA |

Alternatively, switch the form to **Connection URI**:

```text
postgresql://advisor_user:URL_ENCODED_PASSWORD@127.0.0.1:5432/mydb?sslmode=disable
postgresql://advisor_user:URL_ENCODED_PASSWORD@db.example.com:5432/mydb?sslmode=verify-full
```

In URI mode, percent-encode reserved characters in credentials. Only the sslmode URI option is supported. TLS-enabled modes always verify trust and hostname; there is no ignore-certificate-errors mode.

Credentials are kept in the local server's memory, not in browser storage or config files. Password, URI and CA inputs clear after submission or closing the form. Disconnect, stop the server, or leave the session inactive for 30 minutes to close its pool; automatic refresh keeps the session active.

### Database preparation

The **target server**, independently of the laptop OS, needs:

- PostgreSQL **17 or later** and extension **pg_workload_advisor 1.0** in the selected database.
- pg_stat_statements installed and present in shared_preload_libraries. Restart PostgreSQL after changing that setting, preserving other preload entries.
- Citus only if you want Citus-specific evidence. The advisor also works on ordinary PostgreSQL.
- Network access and a database role permitted by the server's authentication configuration.

The dashboard does not install PostgreSQL or extensions automatically. On an Ubuntu server that already has PostgreSQL and its PGXS development files, install the extension from its parent folder using the matching pg_config, for example:

```bash
cd /path/to/pg_workload_advisor
sudo make USE_PGXS=1 PG_CONFIG=/usr/lib/postgresql/17/bin/pg_config install
```

Adjust the PostgreSQL version/path to match the running server. For a custom installation writable by your account, omit sudo. Follow the [extension's installation documentation](../README.md#install) for your deployment.

For a native Windows PostgreSQL server, this version is SQL-only: an administrator can copy the parent extension's pg_workload_advisor.control and pg_workload_advisor--1.0.sql into that server installation's share/extension directory (the directory under `pg_config --sharedir`). Use the parent extension files, not dashboard test fixtures. Configure pg_stat_statements preloading and restart the service.

Then, in the target database using an appropriate administrative role:

```sql
SHOW server_version;
SHOW shared_preload_libraries;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_workload_advisor;
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('pg_stat_statements', 'pg_workload_advisor');
SELECT pg_workload_advisor.latest_advice();
```

An empty latest_advice() result is normal before the first capture. The dashboard does not upgrade an existing extension. For an installation under the former extension name, follow the [deployment rename notes](../README.md#renaming-existing-deployments). Managed database services must support installing this extension through their approved packaging mechanism.

Use the existing collector role initially, or grant a dedicated role the read/collection privileges described in [docs/INTEGRATION.md](docs/INTEGRATION.md). Reader and collector identities must agree: this extension's _server_id() can differ by role privileges. The dashboard surfaces a mismatch rather than combining histories.

### Refresh versus collection

- **Refresh data** reads existing captures and evidence; it does not collect a new snapshot.
- **Collect & evaluate** runs run_advisory_cycle() and writes advisor captures/events; it may queue notifications. It does not change capacity, run a rebalance or reset statistics.
- The first collection establishes a baseline. Under the default policy, wait at least **300 seconds** before the next capture. Sustained pressure needs enough samples.
- Automatic read/collection settings operate while the page is open. Use your existing scheduler for continuous collection.
- CPU, memory and storage metrics need an external telemetry collector. Missing live values are never replaced with demo data.

## 4. Ports, WSL and troubleshooting

To use a different port:

```powershell
# Windows PowerShell
$env:PORT = "4320"
npm.cmd start
# After stopping, restore the default for future runs:
Remove-Item Env:PORT
```

```bash
# Ubuntu; the override applies only to this command
PORT=4320 npm start
```

The same overrides work with npm run demo. Use separate ports when running both modes.

Under WSL, run Node/npm inside the Ubuntu environment and open its printed address in your Windows browser. Host in the connection form is resolved by the Node process: 127.0.0.1 means that process's environment. If PostgreSQL is across the Windows/WSL boundary, use a reachable address for your WSL networking mode and configure PostgreSQL's listener/authentication accordingly.

| Symptom | Action |
| --- | --- |
| node/npm not found | Install Node.js; reopen the terminal. With nvm, load nvm.sh and run nvm use. |
| npm.ps1 execution policy error | Use npm.cmd; changing system execution policy is unnecessary. |
| Cannot find package pg | In dashboard/, run npm ci --omit=dev. |
| Address already in use | Stop the other instance or set PORT. |
| Connection refused / timeout | Check host, port, listener, firewall and pg_hba.conf from the machine running Node. |
| TLS not supported | Select Disabled only for a trusted server intentionally running without TLS. |
| Certificate trust / hostname error | Supply the correct CA and use a hostname matching the server certificate. |
| Extension missing / wrong version | Install pg_workload_advisor 1.0 and pg_stat_statements in the selected database. |
| Statistics not ready | Add pg_stat_statements to shared_preload_libraries and restart PostgreSQL. |
| Connected, but no captures | Collect once, or wait for your separate collector. Also check role/server identity warnings. |
| Missing resource metrics | Supply external infrastructure telemetry; query statistics do not provide OS CPU/memory. |
| Section permission warnings | Check the reader role's schema/table/function and statistics privileges. |

## 5. Repository layout

The extension and dashboard now share one repository:
[hqakhtar/pg_workload_advisor](https://github.com/hqakhtar/pg_workload_advisor).
No separate extraction or integration commit is required.

| Location | Purpose |
| --- | --- |
| [../pg_workload_advisor.control](../pg_workload_advisor.control) | Extension metadata, dependency, and fixed schema |
| [../pg_workload_advisor--1.0.sql](../pg_workload_advisor--1.0.sql) | Extension installation script |
| [package.json](package.json) | Dashboard commands and dependencies; run npm in this directory |
| [test/fixtures/](test/fixtures/) | Disposable-test extension packages, never installed into a user's database |

The .gitignore excludes node_modules, environment files, private keys/certificates, logs, coverage and ZIPs. Keep package-lock.json, public/, server.mjs, database.mjs, demo.mjs, tests and documentation in Git. There is no nested .git repository or hosting account configuration.

## 6. Development and verification

Install development dependencies only when running the included tests:

```text
npm ci
npm test
```

On Windows use npm.cmd. Tests use Node's cross-platform test discovery. SQL integration tests run disposable PostgreSQL 17.5 and 18.3 WebAssembly engines with a fixture matching this repository's extension SQL and control files; they do not connect to your database. The TLS test uses OpenSSL if it is available on PATH and otherwise reports a skip. Ubuntu: `sudo apt install openssl` if needed.

The tests cover demo HTTP assets, UI behavior, PostgreSQL protocol/API execution and TLS validation. The package uses cross-platform Node.js APIs and requires no shell scripts at runtime. Native Windows and Ubuntu desktop behavior, SCRAM authentication, backend concurrency and a distributed Citus cluster require validation in the target environment.

For a read-only check of a real server, set ADVISOR_DATABASE_URL in your local terminal and run `npm run verify-db`. Optionally set ADVISOR_CA_FILE and ADVISOR_POLICY. The connection form avoids putting your URI in shell history. The verification command never prints the URI/password. Adding `-- --collect` explicitly writes one advisor cycle.

Implementation details, permissions, precise data mapping and test limits are in [docs/INTEGRATION.md](docs/INTEGRATION.md). Test fixture provenance and notices are in [test/fixtures/README.md](test/fixtures/README.md).

## Source and license

Maintained with [PG Workload Advisor](https://github.com/hqakhtar/pg_workload_advisor).
The dashboard targets extension version 1.0 from this repository.

This folder includes an MIT license. The vendored PostgreSQL test bundle retains its PostgreSQL copyright notice. npm dependency licenses remain with those packages.
