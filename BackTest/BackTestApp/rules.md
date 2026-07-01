# AI Rules for BackTest App

## Rules

1. **API Documentation Sync**: Whenever you modify, add, or remove any route, controller, service, middleware, or model in the `src/` directory that affects the REST API behavior, you **MUST** update `API_DOCUMENTATION.md` in this folder to reflect the changes. This includes:
   - Adding or removing endpoints
   - Changing request/response schemas
   - Modifying query parameters or filters
   - Changing authentication or authorization requirements
   - Updating error codes or response formats
   - Modifying lifecycle state transitions (deployments)

2. **Git Commits**: After making changes, commit with a clear message. If both source code and API docs are updated in the same change, mention both in the commit message (e.g., `feat: add export endpoint to trades + update API docs`).

3. **Backward Compatibility**: All routes must remain available at both root (`/`) and `/api/` prefix. Do not remove the `/api/` prefix routes.

4. **Ledger Immutability**: Never add `PUT`, `PATCH`, or `DELETE` endpoints for ledger entries. Ledger records are immutable.

5. **Ownership Enforcement**: All user-facing endpoints must filter by `user_id` from `req.auth.userId`. Only admin endpoints (`/admin/...`) may access other users' resources.
