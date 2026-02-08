# Rate Limiting Policy

This project uses a dual-layer rate limiting model:

1. Cloudflare is the primary protection layer for public traffic.
2. Application-level controls enforce API key and quota policy.

## Cloudflare Rules (Primary)

Apply rules to proxied frontend DNS records (`nadeshiko.co`, `dev.nadeshiko.co`) so requests are filtered before they hit origin.

| Rule Name | Host | Path Pattern | Action | Threshold | Rule ID |
| --- | --- | --- | --- | --- | --- |
| Public Search Burst | `nadeshiko.co`, `dev.nadeshiko.co` | `/internal-api/search/media/*` | Block or Managed Challenge | 120 requests / 60 seconds / IP | `TODO_CF_RULE_PUBLIC_SEARCH_BURST` |
| Public Search Sustained | `nadeshiko.co`, `dev.nadeshiko.co` | `/internal-api/search/media/*` | Block | 2000 requests / 5 minutes / IP | `TODO_CF_RULE_PUBLIC_SEARCH_SUSTAINED` |
| Auth Endpoint Protection | `nadeshiko.co`, `dev.nadeshiko.co` | `/api/auth/*` | Managed Challenge or Block | 30 requests / 60 seconds / IP | `TODO_CF_RULE_AUTH` |

Tune values by traffic profile, but keep this file updated whenever thresholds or rule IDs change.

## Backend Controls (Identity-Aware)

- Better Auth API key short-window limit:
  - `API_KEY_RATE_LIMIT_WINDOW_MS` (default `300000`)
  - `API_KEY_RATE_LIMIT_MAX` (default `2000`)
- Monthly account quota via `AccountQuotaUsage` + `User.monthly_quota_limit`.
- Service keys are excluded from monthly account quota when:
  - key metadata contains `"keyType": "service"` or `"isService": true`, or
  - key ID is listed in `SERVICE_API_KEY_IDS`.

## Frontend Server Fallback

Nuxt server routes under `/internal-api/search/media/*` have an in-memory fallback limiter:

- `NUXT_FALLBACK_RATE_LIMIT_WINDOW_MS` (default `60000`)
- `NUXT_FALLBACK_RATE_LIMIT_MAX_REQUESTS` (default `300`)

This limiter is a safety net only. Cloudflare remains the primary public limiter.
