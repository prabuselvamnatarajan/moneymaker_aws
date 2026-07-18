# BackTest E2E Test Suite

Playwright-based end-to-end coverage for **BackTestApp** (API) and **BackTestUI** (browser), mapped to all test cases in `test_case_plans/BackTest*.md`.

## Prerequisites

1. Start the docker-compose stack (minimal):

```bash
./build-all.sh
docker compose up -d mongo1 mongo2 mongo3 redis backtest-app backtest-ui nginx
```

2. Wait for health:

```bash
curl -sf http://localhost/backtestapp/health
```

## Install & run

```bash
cd e2e
npm install
npx playwright install --with-deps   # first time only

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
| `API_BASE_URL` | `http://localhost/backtestapp` | BackTestApp API (nginx proxy) |
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
    - docker compose up -d mongo1 mongo2 mongo3 redis backtest-app backtest-ui nginx
    - curl -sf --retry 60 --retry-delay 3 http://localhost/backtestapp/health
    - cd e2e && npm ci && npx playwright install --with-deps
    - npm run test:e2e
    - npm run check-coverage
  artifacts:
    when: always
    paths:
      - e2e/playwright-report/
```

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
