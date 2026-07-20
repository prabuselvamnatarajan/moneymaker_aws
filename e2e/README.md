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
```

Direct suite scripts:

```bash
./scripts/test/run_backtest_app_test_cases.sh
./scripts/test/run_backtest_app_test_cases.sh backtest-app/iam-auth.spec.ts
./scripts/test/run_backtest_ui_test_cases.sh --headed
./scripts/test/run_backtest_ui_test_cases.sh --grep TC-UI-024
```

Future docker-service suites are listed in `scripts/test/suites.registry` with `enabled=0`. Copy `_template_run_service_test_cases.sh` when adding automation.

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

## CI

No `.gitlab-ci.yml` exists in this repo. Add a job like:

```yaml
e2e-backtest:
  stage: test
  script:
    - ./build-all.sh
    - curl -sf --retry 60 --retry-delay 3 http://localhost/backtestapp/health
    - ./run_all_test_cases.sh --no-install --coverage
    # or: cd e2e && npm ci && npx playwright install --with-deps && npm run test:e2e
  artifacts:
    when: always
    paths:
      - e2e/playwright-report/
```

Note: `run_all_test_cases.sh` installs e2e deps unless `--no-install` is set; for CI prefer installing once then `--no-install`, or let the orchestrator install.

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
