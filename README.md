# log

A small, professional event-logging service built on Vercel Functions and
Vercel Postgres (via Kysely). It captures three event types — **display (展现)**,
**exposure (曝光)**, and **click (点击)** — and automatically enriches every
record with request context (timestamp, IP geolocation, timezone, language).

## Endpoint

All logging goes through a single endpoint:

```
POST /log
```

`/log` is rewritten to the `api/log` function; `GET /log` returns a short
description of the contract, and `OPTIONS /log` handles CORS preflight.

### Request body

```jsonc
{
  "type": "display" | "exposure" | "click", // required
  "params": { "any": "custom fields" },      // optional, stored as JSONB
  "timestamp": 1737450000000,                 // optional epoch ms; defaults to server time
  "timezone": "Asia/Shanghai",               // optional; used only if the edge can't resolve one
  "language": "zh-CN"                          // optional; used only if Accept-Language is absent
}
```

### Automatically recorded per event

| Field             | Source                                             |
| ----------------- | -------------------------------------------------- |
| `event_timestamp` | request body `timestamp`, else server receive time |
| `ip`              | Vercel edge (`ipAddress`)                          |
| `location`        | Vercel edge geolocation (country, region, city, …) |
| `timezone`        | `x-vercel-ip-timezone` header (IANA name)          |
| `language`        | `Accept-Language` header                           |
| `user_agent`      | `User-Agent` header                                |
| `referer`         | `Referer`, falling back to `Origin`                |
| `created_at`      | database insert time                               |

Server-derived context takes precedence over client-provided `timezone` /
`language`, which only fill gaps (e.g. local development).

### Example

```bash
curl -X POST https://<your-deployment>/log \
  -H 'Content-Type: application/json' \
  -d '{"type":"click","params":{"button":"buy","sku":"A-100"}}'
```

Browsers can also fire-and-forget with `navigator.sendBeacon('/log', blob)`.
The endpoint responds `202 Accepted` and persists the write via `waitUntil`,
so callers are not blocked on the database round-trip.

## Database

Provision a Vercel Postgres database and apply the schema:

```bash
psql "$POSTGRES_URL" -f migrations/0001_init.sql
```

All events live in one `log_record` table, discriminated by `type`, with the
open-ended `params` and `location` stored as JSONB.

## Query API

Read-only aggregates for dashboards:

```
GET /query?days=30&tz=Asia/Shanghai
```

- `days` — window size, clamped to `[1, 365]` (default 30).
- `tz` — IANA timezone used to bucket days (default `UTC`).

Returns per-point totals and a gap-free daily series, plus reading-time stats
for duration events (dwell is de-duplicated by taking `MAX(dwell_ms)` per
`sid`). The response contains only aggregates — no IPs, geolocation, or raw
params — because it is world-readable (the browser dashboard calls it directly).

```jsonc
{
  "range": { "from": "…", "to": "…", "days": 30, "tz": "Asia/Shanghai", "bucket": "day" },
  "totals": { "all": 0, "display": 0, "exposure": 0, "click": 0 },
  "points": [
    { "key": "display:page_view", "type": "display", "name": "page_view",
      "total": 0, "firstAt": "…", "lastAt": "…",
      "series": [ { "date": "2026-09-01", "count": 0 } ] }
  ],
  "durations": [
    { "key": "display:article_duration", "type": "display", "name": "article_duration",
      "visits": 0, "avgMs": 0, "p50Ms": 0, "p90Ms": 0 }
  ]
}
```

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
vercel dev          # run the function locally
```

Outside Vercel, edge-only fields (`ip`, `location`, `timezone`) may be empty.
