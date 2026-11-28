## 2024-05-24 - Unescaped RegExp in Query Builder
**Vulnerability:** Regular Expression Denial of Service (ReDoS) vulnerability in `queryHelper.js`.
**Learning:** `new RegExp(query.search, "i")` was used to build dynamic Mongoose filters without sanitizing the search string from query parameters.
**Prevention:** Always escape user-provided strings before using them in `new RegExp` using `string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.

## 2024-05-24 - Hardcoded JWT Secrets Fallback
**Vulnerability:** JWT secret and Refresh Token secret were falling back to hardcoded strings (`"iam-access-secret"`, `"iam-refresh-secret"`) if environment variables were missing. This would allow an attacker to forge JWT tokens and hijack any account if the environment variables were inadvertently omitted in production.
**Learning:** Fallbacks in environment variable loading functions (`getEnv`) can mask misconfigurations and silently introduce critical security risks in production environments.
**Prevention:** Avoid providing default hardcoded values for sensitive secrets in production. Enforce configuration presence by throwing errors when critical secrets are undefined in `NODE_ENV === 'production'`.
