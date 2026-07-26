# BackTest E2E Test Suite

Playwright-based end-to-end coverage for **BackTestApp** (API) and **BackTestUI** (browser), mapped to all test cases in `test_case_plans/BackTest*.md`.

## Preferred: shell runners (repo root)

Modular scripts under `scripts/test/` wrap this Playwright package. Orchestrator:

```bash
# List registered suites (enabled + future)
./run_all_test_cases.sh --list

# All enabled suites (backtest-app + backtest-ui)
./run_all_test_cases.sh --coverage

# BackTestApp API only
./run_all_test_cases.sh --suite backtest-app

# BackTestUI browser only
./run_all_test_cases.sh --suite backtest-ui

# UI headed / single test
./run_all_test_cases.sh --suite backtest-ui -- --headed
./run_all_test_cases.sh --suite backtest-app -- --grep TC-ACC-001

# Rebuild images + deploy Swarm stack, then test
./run_all_test_cases.sh --build --coverage

# Granular build / deploy (same as CI phases)
./run_all_test_cases.sh --build-images --deploy-stack --coverage
```

Direct suite scripts:

```bash
./scripts/test/run_backtest_app_test_cases.sh
./scripts/test/run_backtest_app_test_cases.sh backtest-app/iam-auth.spec.ts
./scripts/test/run_backtest_ui_test_cases.sh --headed
./scripts/test/run_backtest_ui_test_cases.sh --grep TC-UI-024
```

Future docker-service suites are listed in `scripts/test/suites.registry` with `enabled=0`. Copy `_template_run_service_test_cases.sh` when adding automation.

## Build & deploy scripts

`build-all.sh` is a thin wrapper:

```text
build-all.sh
  ├── scripts/build-images.sh   # docker build only
  └── scripts/deploy-stack.sh   # swarm init + stack deploy
```

```bash
# Full local / AWS path (all images, wait for Swarm converge)
./build-all.sh
# equivalent to:
./scripts/build-images.sh --profile full
./scripts/deploy-stack.sh --no-detach

# E2E / CI-style (fewer images, detach + CI replica overlay)
./scripts/build-images.sh --profile e2e --parallel 4
NGINX_CONF=./certs/nginx.ci.conf \
  ./scripts/deploy-stack.sh --detach --compose docker-compose.ci.yml
./clear-and-seed.sh --yes
API_BASE_URL=http://127.0.0.1/backtestapp/ \
  ./run_all_test_cases.sh --coverage --no-wait
```

| Script | Purpose |
|--------|---------|
| `scripts/build-images.sh` | Build custom Docker images (`--profile full\|e2e`, `--parallel N`) |
| `scripts/deploy-stack.sh` | Swarm init, pre-pull base images, `docker stack deploy` |
| `docker-compose.ci.yml` | CI overlay (`replicas: 0` for non-E2E services) |
| `certs/nginx.ci.conf` | CI nginx — only `/backtestapp/` and `/backtest-ui/` (set via `NGINX_CONF`) |
| `clear-and-seed.sh` | Wipe/reseed BacktestApp DB inside the running stack |

## Prerequisites (Docker Swarm)

This repo deploys via **Docker Swarm** (`./build-all.sh` → `docker stack deploy ... moneymaker`), not plain `docker compose up`.

Required services for BackTest E2E:

- `mongo1`, `mongo2`, `mongo3`, `redis`
- `backtest-app`, `backtest-ui`
- `reverse-proxy` (nginx image; hosts `/backtestapp` and `/backtest-ui/`)

```bash
./build-all.sh
curl -sf http://localhost/backtestapp/health
```

## Install & run (npm / Playwright directly)

```bash
cd e2e
npm install
# Browsers + OS libs (one-time; needs sudo for system packages):
sudo npx playwright install-deps
npx playwright install chromium
# In CI/root you can instead: PLAYWRIGHT_WITH_DEPS=1 ./run_all_test_cases.sh --suite backtest-ui
# API-only suite does not need browsers: ./run_all_test_cases.sh --suite backtest-app

# Full suite (api + ui projects)
npm run test:e2e

# API only (BackTestApp HTTP)
npm run test:e2e:api

# UI only (BackTestUI browser)
npm run test:e2e:ui

# Coverage gate — fails if any TC-ID is pending
npm run check-coverage

# HTML report
npm run test:e2e:report
```

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `API_BASE_URL` | `http://localhost/backtestapp` | BackTestApp API (via reverse-proxy) |
| `UI_BASE_URL` | `http://localhost/backtest-ui/` | BackTestUI SPA |
| `BACKTEST_SERVICE_TOKEN` | `backtest-internal-service-token` | Service-token endpoints |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@moneymaker.com` / `adminpassword123` | Seed admin (falls back to `@cobratrades.com`) |
| `USER_EMAIL` / `USER_PASSWORD` | `user@moneymaker.com` / `userpassword123` | Seed user |
| `MONGO_URI` | _(optional)_ | Mongo assertions (PAT plaintext, RBAC roles, etc.) |
| `REDIS_URL` | _(optional)_ | Redis key inspection (deployment sync tests) |
| `API_NO_SECRETS_BASE_URL` | _(optional)_ | Separate stack without JWT secrets for TC-AUTH-013/015 |

## Projects (`playwright.config.ts`)

| Project | Directory | Description |
|---------|-----------|-------------|
| `api` | `backtest-app/` | HTTP tests via Playwright `request` fixture |
| `ui` | `backtest-ui/` | Browser tests against the SPA |
| `api-no-secrets` | `iam-auth.spec.ts` `@no-secrets` | JWT default-secret regression |
| `slow` | `@slow` tagged tests | Extended timeout (TC-DEP-040/044, etc.) |

## Tags

- `@race` — concurrent/race-condition tests (workers=1 recommended)
- `@slow` — performance / large seed tests
- `@audit` — static source grep (TC-RBAC-001)
- `@no-secrets` — requires unset JWT env vars

## CI (GitHub Actions)

Workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

```text
test job (every push / PR)
  1. Build E2E images     → scripts/build-images.sh --profile e2e --parallel 4
  2. Deploy CI stack      → scripts/deploy-stack.sh --detach --compose docker-compose.ci.yml
  3. Wait for /health
  4. Seed database        → clear-and-seed.sh --yes
  5. Run suites           → run_all_test_cases.sh --coverage --no-wait

deploy job (push to main only, after test passes)
  → SSH to AWS and run ./build-all.sh
```

Artifacts: on every run, `playwright-report-<run_id>` is uploaded when report files exist (Actions → run → Artifacts).

## Coverage tracking

`coverage/tc-checklist.json` maps every `TC-*` ID to its spec file and status (`implemented` | `skipped`).

## Skipped tests (by design)

| TC-ID | Reason |
|-------|--------|
| TC-DEP-011 | UI-only default — see `deploy-dialog.spec.ts` TC-UI-024/025 |
| TC-ADM-015 | Duplicate of TC-RBAC-001 (`iam-auth.spec.ts`) |
| TC-AUTH-013/015 | Require `API_NO_SECRETS_BASE_URL` |
| TC-TRD-024–027 | Require tick JSON in `backtest-data` volume |
| Several symbol_control / Redis tests | Skip when option-chain or Redis unavailable |

## Assertion policy

Tests match each plan's **Expected Result**, including documented current bugs (issues #3, #9, #33, #35, etc.). Comments reference issue numbers so tests flip when fixes land.
