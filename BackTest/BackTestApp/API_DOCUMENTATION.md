# BackTest App — REST API Documentation

**Base URL:** `http://<host>/backtestapp`
**API Version:** v1
**Content-Type:** `application/json`

> All endpoints are available at both root (`/`) and `/api/` prefix (e.g., `/accounts` and `/api/accounts`).

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [User Profile (Me)](#2-user-profile-me)
3. [Users](#3-users)
4. [Accounts](#4-accounts)
5. [Strategies](#5-strategies)
6. [Symbols](#6-symbols)
7. [Deployments](#7-deployments)
8. [Trades](#8-trades)
9. [Ledger](#9-ledger)
10. [Admin](#10-admin)
11. [Common Query Parameters](#11-common-query-parameters)
12. [Error Responses](#12-error-responses)
13. [Health Check](#13-health-check)

---

## Authentication Header

All protected endpoints require a JWT Bearer token:

```
Authorization: Bearer <access_token>
```

---

## 1. Authentication

### POST `/auth/signup`

Create a new user account.

**Auth Required:** No

**Request Body:**
```json
{
  "username": "johndoe",
  "name": "John Doe",
  "email": "john@example.com",
  "password": "securepassword123"
}
```

**Response (201):**
```json
{
  "message": "Signup successful",
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi..."
}
```

---

### POST `/auth/login`

Authenticate and receive tokens.

**Auth Required:** No

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "securepassword123"
}
```

**Response (200):**
```json
{
  "message": "Login successful",
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi..."
}
```

---

### POST `/auth/logout`

End the current session.

**Auth Required:** Yes

**Response (200):**
```json
{
  "message": "Logout successful"
}
```

---

### POST `/auth/refresh-token`

Get a new access token using a refresh token.

**Auth Required:** No

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOi..."
}
```

**Response (200):**
```json
{
  "message": "Access token refreshed successfully",
  "accessToken": "eyJhbGciOi..."
}
```

---

### POST `/auth/change-password`

Change the current user's password.

**Auth Required:** Yes

**Request Body:**
```json
{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword123"
}
```

**Response (200):**
```json
{
  "message": "Password changed successfully"
}
```

---

### POST `/auth/forgot-password`

Request a password reset token.

**Auth Required:** No

**Request Body:**
```json
{
  "email": "john@example.com"
}
```

**Response (200):**
```json
{
  "message": "Password reset token generated successfully",
  "token": "eyJhbGciOi..."
}
```

---

### POST `/auth/reset-password`

Reset password using the token from forgot-password.

**Auth Required:** No

**Request Body:**
```json
{
  "token": "eyJhbGciOi...",
  "newPassword": "newpassword123"
}
```

**Response (200):**
```json
{
  "message": "Password reset successfully"
}
```

---

### POST `/auth/mfa/setup`

Set up multi-factor authentication.

**Auth Required:** Yes

---

### POST `/auth/mfa/verify-setup`

Verify MFA setup with a TOTP code.

**Auth Required:** Yes

---

### POST `/auth/mfa/login-verify`

Verify MFA during login.

**Auth Required:** No

---

## 2. User Profile (Me)

### GET `/me`

Get the current authenticated user's profile.

**Auth Required:** Yes

**Response (200):**
```json
{
  "message": "Current user retrieved successfully",
  "data": {
    "_id": "664a...",
    "username": "johndoe",
    "name": "John Doe",
    "email": "john@example.com",
    "is_active": true,
    "roles": [{ "_id": "...", "name": "user" }],
    "createdAt": "2026-06-28T10:00:00Z"
  }
}
```

---

### PATCH `/me`

Update the current user's profile.

**Auth Required:** Yes

**Request Body (all fields optional):**
```json
{
  "name": "John Updated",
  "username": "john_updated",
  "email": "newemail@example.com"
}
```

**Response (200):**
```json
{
  "message": "Profile updated successfully",
  "data": { ... }
}
```

---

### DELETE `/me`

Delete the current user's account.

**Auth Required:** Yes

**Response (200):**
```json
{
  "message": "Account deleted successfully"
}
```

---

## 3. Users

### POST `/users`

Create a new user (public signup alternative).

**Auth Required:** No

**Request Body:**
```json
{
  "username": "newuser",
  "name": "New User",
  "email": "newuser@example.com",
  "password": "password123"
}
```

**Response (201):**
```json
{
  "message": "User created successfully",
  "data": { ... }
}
```

---

### GET `/users`

Get users list. Standard users see only their own profile; admins see all users.

**Auth Required:** Yes

**Response (200):**
```json
{
  "message": "Users retrieved successfully",
  "data": [ ... ]
}
```

---

### GET `/users/:id`

Get a user by ID. Standard users can only access their own profile.

**Auth Required:** Yes

**Response (200):**
```json
{
  "message": "User retrieved successfully",
  "data": { ... }
}
```

---

### PUT/PATCH `/users/:id`

Update a user. Standard users can only update their own profile.

**Auth Required:** Yes

**Request Body (all fields optional):**
```json
{
  "name": "Updated Name",
  "username": "updated_username",
  "email": "updated@example.com",
  "password": "newpassword"
}
```

---

### DELETE `/users/:id`

Delete a user. Standard users can only delete their own account.

**Auth Required:** Yes

---

## 4. Accounts

### POST `/accounts`

Create a new trading account.

**Auth Required:** Yes

**Request Body:**
```json
{
  "account_name": "Main Trading Account",
  "account_id": "ACC-001",
  "current_balance": 50000,
  "description": "Primary backtest account"
}
```

**Response (201):**
```json
{
  "message": "Account created successfully",
  "data": { ... }
}
```

---

### GET `/accounts`

List all accounts for the authenticated user. Supports pagination and filtering.

**Auth Required:** Yes

**Query Parameters:** `page`, `limit`, `sort`, `order`, `from`, `to`, `search`, `is_active`

**Response (200):**
```json
{
  "message": "Accounts retrieved successfully",
  "items": [ ... ],
  "pagination": {
    "total": 5,
    "page": 1,
    "limit": 20,
    "pages": 1
  }
}
```

---

### GET `/accounts/:id`

Get a specific account by `_id` or `account_id`.

**Auth Required:** Yes

---

### PUT/PATCH `/accounts/:id`

Update an account.

**Auth Required:** Yes

**Request Body (fields to update):**
```json
{
  "account_name": "Renamed Account",
  "is_active": false
}
```

---

### DELETE `/accounts/:id`

Delete an account.

**Auth Required:** Yes

---

### GET `/accounts/:id/balance`

Get only the balance of a specific account.

**Auth Required:** Yes

**Response (200):**
```json
{
  "message": "Account balance retrieved successfully",
  "data": {
    "account_id": "ACC-001",
    "current_balance": 48500
  }
}
```

---

## 5. Strategies

### POST `/strategies`

Create a new strategy.

**Auth Required:** Yes

**Request Body:**
```json
{
  "strategy_name": "MSB Breakout",
  "strategy_description": "Market structure break strategy",
  "is_active": true
}
```

**Response (201):**
```json
{
  "message": "Strategy created successfully",
  "data": { ... }
}
```

---

### GET `/strategies`

List all strategies. Supports pagination and search.

**Auth Required:** Yes

**Query Parameters:** `page`, `limit`, `sort`, `order`, `from`, `to`, `search`, `is_active`

---

### GET `/strategies/:id`

Get a strategy by ID.

**Auth Required:** Yes

---

### PUT/PATCH `/strategies/:id`

Update a strategy.

**Auth Required:** Yes

---

### DELETE `/strategies/:id`

Delete a strategy.

**Auth Required:** Yes

---

## 6. Symbols

### POST `/symbols`

Add a symbol to the user's watchlist.

**Auth Required:** Yes

**Request Body:**
```json
{
  "symbol": "NIFTY",
  "exchange": "NSE",
  "instrument_key": "NSE_INDEX|Nifty 50"
}
```

**Response (201):**
```json
{
  "message": "Symbol added successfully",
  "data": { ... }
}
```

---

### GET `/symbols`

List all user symbols. Supports pagination and search.

**Auth Required:** Yes

**Query Parameters:** `page`, `limit`, `sort`, `order`, `from`, `to`, `search`

---

### GET `/symbols/:id`

Get a symbol by `_id` or `user_symbol_id`.

**Auth Required:** Yes

---

### PUT/PATCH `/symbols/:id`

Update a symbol.

**Auth Required:** Yes

---

### DELETE `/symbols/:id`

Remove a symbol.

**Auth Required:** Yes

---

## 7. Deployments

### CRUD Operations

### POST `/deployments`

Create a new deployment.

**Auth Required:** Yes

**Request Body:**
```json
{
  "strategy_id": "664a...",
  "account_id": "664b...",
  "symbol": "NIFTY",
  "current_status": "CREATED"
}
```

---

### GET `/deployments`

List deployments. Supports pagination and status filtering.

**Auth Required:** Yes

**Query Parameters:** `page`, `limit`, `sort`, `order`, `from`, `to`, `search`, `current_status`

---

### GET `/deployments/:id`

Get a deployment by ID.

**Auth Required:** Yes

---

### PUT/PATCH `/deployments/:id`

Update a deployment.

**Auth Required:** Yes

---

### DELETE `/deployments/:id`

Delete a deployment.

**Auth Required:** Yes

---

### Lifecycle Actions

All lifecycle endpoints validate state transitions. Invalid transitions return `409 Conflict`.

**Valid State Transitions:**

| Action    | Allowed From States              | Target State |
|-----------|----------------------------------|--------------|
| `start`   | CREATED, STOPPED, COMPLETED      | RUNNING      |
| `stop`    | RUNNING, PAUSED                  | STOPPED      |
| `pause`   | RUNNING                          | PAUSED       |
| `resume`  | PAUSED                           | RUNNING      |
| `restart` | RUNNING, PAUSED, STOPPED, ERROR  | RUNNING      |

### POST `/deployments/:id/start`

Start a deployment.

**Auth Required:** Yes

**Response (200):**
```json
{
  "message": "Deployment start successful",
  "data": { ... }
}
```

**Error (409):**
```json
{
  "message": "Cannot start deployment in status 'RUNNING'. Allowed from: CREATED, STOPPED, COMPLETED"
}
```

---

### POST `/deployments/:id/stop`

Stop a running or paused deployment.

**Auth Required:** Yes

---

### POST `/deployments/:id/pause`

Pause a running deployment.

**Auth Required:** Yes

---

### POST `/deployments/:id/resume`

Resume a paused deployment.

**Auth Required:** Yes

---

### POST `/deployments/:id/restart`

Restart a deployment from any active state.

**Auth Required:** Yes

---

### Monitoring

### GET `/deployments/:id/status`

Get the current status of a deployment.

**Auth Required:** Yes

**Response (200):**
```json
{
  "message": "Deployment status retrieved successfully",
  "data": {
    "_id": "664a...",
    "current_status": "RUNNING",
    "start_time": "2026-06-28T10:00:00Z",
    "end_time": null,
    "symbol": "NIFTY"
  }
}
```

---

### GET `/deployments/:id/logs`

Get logs for a deployment.

**Auth Required:** Yes

**Response (200):**
```json
{
  "message": "Deployment logs retrieved successfully",
  "data": []
}
```

---

### GET `/deployments/:id/metrics`

Get performance metrics for a deployment (calculated from trades).

**Auth Required:** Yes

**Response (200):**
```json
{
  "message": "Deployment metrics retrieved successfully",
  "data": {
    "deployment_id": "664a...",
    "current_status": "RUNNING",
    "total_trades": 42,
    "total_pnl": 12500,
    "wins": 28,
    "losses": 14,
    "win_rate": "66.67%"
  }
}
```

---

## 8. Trades

### POST `/trades`

Execute a new trade (creates trade, updates ledger and account balance atomically).

**Auth Required:** Yes

**Request Body:**
```json
{
  "account_id": "ACC-001",
  "symbol": "NIFTY",
  "instrument_key": "NSE_INDEX|Nifty 50",
  "price": 24500,
  "quantity": 1,
  "type_of_order": "BUY",
  "deployment_id": "664a..."
}
```

**Response (201):**
```json
{
  "message": "✅ Trade executed successfully",
  "data": {
    "trade": { ... },
    "account": { ... },
    "closing_balance": 15500
  }
}
```

---

### GET `/trades`

List trades with filtering and pagination.

**Auth Required:** Yes

**Query Parameters:**
| Parameter       | Type   | Description                          |
|-----------------|--------|--------------------------------------|
| `page`          | number | Page number (default: 1)             |
| `limit`         | number | Items per page (default: 20, max: 100) |
| `sort`          | string | Sort field (default: `created_at`)   |
| `order`         | string | `asc` or `desc` (default: `desc`)    |
| `from`          | string | Start date (ISO 8601)                |
| `to`            | string | End date (ISO 8601)                  |
| `search`        | string | Search in symbol, instrument_key     |
| `type_of_order` | string | Filter by `BUY` or `SELL`            |
| `symbol`        | string | Filter by symbol name                |
| `account_id`    | string | Filter by account ID                 |
| `deployment_id` | string | Filter by deployment ID              |

**Response (200):**
```json
{
  "message": "Trades retrieved successfully",
  "items": [ ... ],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "pages": 5
  }
}
```

---

### GET `/trades/:id`

Get a specific trade by `_id` or `trade_id`.

**Auth Required:** Yes

---

### DELETE `/trades/:id`

Delete a trade.

**Auth Required:** Yes

---

### Legacy Endpoint

### POST `/api/trade`

Legacy trade creation endpoint (for backtest streamer compatibility). No authentication required.

---

## 9. Ledger

> **Ledger entries are immutable.** Only `GET` operations are allowed. Entries are created automatically when trades are executed.

### GET `/ledger`

List ledger entries with filtering.

**Auth Required:** Yes

**Query Parameters:**
| Parameter   | Type   | Description                             |
|-------------|--------|-----------------------------------------|
| `page`      | number | Page number (default: 1)                |
| `limit`     | number | Items per page (default: 20, max: 100)  |
| `sort`      | string | Sort field (default: `created_on`)      |
| `order`     | string | `asc` or `desc` (default: `desc`)       |
| `from`      | string | Start date (ISO 8601)                   |
| `to`        | string | End date (ISO 8601)                     |
| `accountId` | string | Filter by account `_id` or `account_id` |
| `type`      | string | `credit` or `debit`                     |

**Response (200):**
```json
{
  "message": "Ledger entries retrieved successfully",
  "items": [
    {
      "_id": "664a...",
      "account_id": { ... },
      "trade_id": { ... },
      "opening_balance": 50000,
      "change_in_balance": -24500,
      "closing_balance": 25500,
      "created_on": "2026-06-28T10:00:00Z"
    }
  ],
  "pagination": { ... }
}
```

---

### GET `/ledger/:id`

Get a specific ledger entry.

**Auth Required:** Yes

---

## 10. Admin

> All admin endpoints require the `admin` role. Returns `403 Forbidden` for non-admin users.

### User Management

| Method | Endpoint                  | Description            |
|--------|---------------------------|------------------------|
| GET    | `/admin/users`            | List all users         |
| POST   | `/admin/users`            | Create a user          |
| GET    | `/admin/users/:userId`    | Get user by ID         |
| PUT    | `/admin/users/:userId`    | Update user            |
| PATCH  | `/admin/users/:userId`    | Partial update user    |
| DELETE | `/admin/users/:userId`    | Delete user            |

### POST `/admin/users`

**Request Body:**
```json
{
  "username": "newadmin",
  "name": "New Admin",
  "email": "admin2@example.com",
  "password": "password123",
  "roles": ["<role_id>"],
  "is_active": true
}
```

### User Resource Access

| Method | Endpoint                              | Description               |
|--------|---------------------------------------|---------------------------|
| GET    | `/admin/users/:userId/accounts`       | List user's accounts      |
| POST   | `/admin/users/:userId/accounts`       | Create account for user   |
| GET    | `/admin/users/:userId/strategies`     | List user's strategies    |
| POST   | `/admin/users/:userId/strategies`     | Create strategy for user  |
| GET    | `/admin/users/:userId/deployments`    | List user's deployments   |
| GET    | `/admin/users/:userId/trades`         | List user's trades        |
| GET    | `/admin/users/:userId/ledger`         | List user's ledger        |

All list endpoints support the standard pagination query parameters.

---

## 11. Common Query Parameters

All list endpoints support these query parameters:

| Parameter | Type   | Default      | Description                          |
|-----------|--------|--------------|--------------------------------------|
| `page`    | number | `1`          | Page number                          |
| `limit`   | number | `20`         | Items per page (max: 100)            |
| `sort`    | string | varies       | Field to sort by                     |
| `order`   | string | `desc`       | Sort direction: `asc` or `desc`      |
| `from`    | string | —            | Filter from date (ISO 8601)          |
| `to`      | string | —            | Filter to date (ISO 8601)            |
| `search`  | string | —            | Text search across relevant fields   |

**Example:**
```
GET /accounts?page=2&limit=10&sort=created_on&order=asc&search=trading
```

---

## 12. Error Responses

All errors follow a consistent format:

```json
{
  "message": "Error description",
  "error": "Detailed error message (if available)"
}
```

### HTTP Status Codes

| Code | Meaning                                                |
|------|--------------------------------------------------------|
| 200  | Success                                                |
| 201  | Created                                                |
| 400  | Bad Request — missing or invalid parameters            |
| 401  | Unauthorized — missing or invalid JWT token            |
| 403  | Forbidden — insufficient permissions                   |
| 404  | Not Found — resource does not exist                    |
| 409  | Conflict — invalid state transition or duplicate entry |
| 500  | Internal Server Error                                  |

---

## 13. Health Check

### GET `/health`

**Auth Required:** No

**Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2026-06-28T10:00:00.000Z"
}
```

---

## Default Seed Data

Run the seed script to populate initial data:

```bash
node src/db/seed.js
```

This creates:

| User              | Email                  | Password   | Role    |
|-------------------|------------------------|------------|---------|
| Admin User        | admin@moneymaker.com   | admin123   | admin   |
| Standard User     | user@moneymaker.com    | user123    | user    |
