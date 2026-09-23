import { sql } from 'kysely';
import { db, LOG_TYPES, type LogType } from './_db.js';

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            // Aggregates only; this endpoint is world-readable by design.
            'Cache-Control': 'public, max-age=60',
            ...CORS_HEADERS,
        },
    });
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
    const value = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

// Only allow IANA-shaped zone names; the value is passed to AT TIME ZONE.
// It is bound as a parameter (not string-concatenated), but validating keeps
// obviously bad input from reaching Postgres.
function sanitizeTz(raw: string | null): string {
    if (raw && /^[A-Za-z][A-Za-z0-9+_\-]*(\/[A-Za-z0-9+_\-]+)*$/.test(raw)) return raw;
    return 'UTC';
}

function toIso(value: unknown): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return null;
}

const UNNAMED = '(unnamed)';

interface SummaryRow {
    type: LogType;
    name: string | null;
    total: number;
    first_at: Date | string;
    last_at: Date | string;
}

interface SeriesRow {
    type: LogType;
    name: string | null;
    date: string;
    count: number;
}

interface DurationRow {
    type: LogType;
    name: string | null;
    visits: number;
    avg_ms: number | null;
    p50_ms: number | null;
    p90_ms: number | null;
}

interface PageTotalRow {
    page: string | null;
    total: number;
}

interface PageSeriesRow {
    page: string | null;
    date: string;
    count: number;
}

interface ArticleRow {
    page: string | null;
    title: string | null;
    id: string | null;
    reads: number;
    readers: number;
}

export function OPTIONS(): Response {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const days = clampInt(url.searchParams.get('days'), 30, 1, 365);
    const tz = sanitizeTz(url.searchParams.get('tz'));
    // Optional site scope for the per-page breakdown. Bound as a parameter, so
    // it is injection-safe; the length cap just avoids absurd input.
    const host = url.searchParams.get('host')?.slice(0, 128) || null;
    const from = new Date(Date.now() - days * 86_400_000);

    try {
        // Per-point totals across the window.
        const summary = await sql<SummaryRow>`
            SELECT type,
                   params->>'name' AS name,
                   count(*)::int AS total,
                   min(created_at) AS first_at,
                   max(created_at) AS last_at
            FROM log_record
            WHERE created_at >= ${from}
            GROUP BY type, params->>'name'
            ORDER BY total DESC
        `.execute(db);

        // Daily counts per point, bucketed in the requested timezone.
        const series = await sql<SeriesRow>`
            WITH ev AS (
                SELECT type,
                       params->>'name' AS name,
                       (created_at AT TIME ZONE ${tz})::date::text AS date
                FROM log_record
                WHERE created_at >= ${from}
            )
            SELECT type, name, date, count(*)::int AS count
            FROM ev
            GROUP BY type, name, date
        `.execute(db);

        // Authoritative, gap-free day axis so every point charts a full window.
        const axis = await sql<{ date: string }>`
            SELECT generate_series(
                date_trunc('day', ${from}::timestamptz AT TIME ZONE ${tz}),
                date_trunc('day', now() AT TIME ZONE ${tz}),
                interval '1 day'
            )::date::text AS date
        `.execute(db);

        // Reading-time stats for duration events: dwell_ms is cumulative per
        // visit, so take MAX per sid before aggregating to avoid double counting.
        const durations = await sql<DurationRow>`
            WITH per_sid AS (
                SELECT type,
                       params->>'name' AS name,
                       params->>'sid' AS sid,
                       max((params->>'dwell_ms')::bigint) AS dwell
                FROM log_record
                WHERE created_at >= ${from}
                  AND params->>'dwell_ms' IS NOT NULL
                  AND params->>'sid' IS NOT NULL
                GROUP BY type, params->>'name', params->>'sid'
            )
            SELECT type,
                   name,
                   count(*)::int AS visits,
                   round(avg(dwell))::int AS avg_ms,
                   (percentile_cont(0.5) WITHIN GROUP (ORDER BY dwell::float8))::int AS p50_ms,
                   (percentile_cont(0.9) WITHIN GROUP (ORDER BY dwell::float8))::int AS p90_ms
            FROM per_sid
            GROUP BY type, name
            ORDER BY visits DESC
        `.execute(db);

        // Per-page view counts, auto-grouped by params.page. Scoped to
        // page_view display events, optionally filtered to one site via host.
        const pageTotals = await sql<PageTotalRow>`
            SELECT params->>'page' AS page, count(*)::int AS total
            FROM log_record
            WHERE created_at >= ${from}
              AND type = 'display'
              AND params->>'name' = 'page_view'
              AND (${host}::text IS NULL OR params->>'host' = ${host})
            GROUP BY params->>'page'
            ORDER BY total DESC
            LIMIT 30
        `.execute(db);

        const pageSeries = await sql<PageSeriesRow>`
            WITH ev AS (
                SELECT params->>'page' AS page,
                       (created_at AT TIME ZONE ${tz})::date::text AS date
                FROM log_record
                WHERE created_at >= ${from}
                  AND type = 'display'
                  AND params->>'name' = 'page_view'
                  AND (${host}::text IS NULL OR params->>'host' = ${host})
            )
            SELECT page, date, count(*)::int AS count
            FROM ev
            GROUP BY page, date
        `.execute(db);

        // Article read ranking for the window. article_view is emitted only by
        // the blog, so no host filter is needed to isolate blog articles.
        const articleRows = await sql<ArticleRow>`
            SELECT params->>'page' AS page,
                   max(params->>'title') AS title,
                   max(params->>'id') AS id,
                   count(*)::int AS reads,
                   count(DISTINCT params->>'sid')::int AS readers
            FROM log_record
            WHERE created_at >= ${from}
              AND type = 'display'
              AND params->>'name' = 'article_view'
            GROUP BY params->>'page'
            ORDER BY reads DESC
            LIMIT 100
        `.execute(db);

        const dayList = axis.rows.map((row) => row.date);
        const countAt = new Map<string, number>();
        for (const row of series.rows) {
            countAt.set(`${row.type}\u0000${row.name ?? ''}\u0000${row.date}`, row.count);
        }

        const points = summary.rows.map((row) => {
            const seriesForPoint = dayList.map((date) => ({
                date,
                count: countAt.get(`${row.type}\u0000${row.name ?? ''}\u0000${date}`) ?? 0,
            }));
            const name = row.name ?? UNNAMED;
            return {
                key: `${row.type}:${name}`,
                type: row.type,
                name,
                total: row.total,
                firstAt: toIso(row.first_at),
                lastAt: toIso(row.last_at),
                series: seriesForPoint,
            };
        });

        const totals: Record<string, number> = { all: 0 };
        for (const type of LOG_TYPES) totals[type] = 0;
        for (const row of summary.rows) {
            totals.all += row.total;
            totals[row.type] = (totals[row.type] ?? 0) + row.total;
        }

        const durationList = durations.rows.map((row) => {
            const name = row.name ?? UNNAMED;
            return {
                key: `${row.type}:${name}`,
                type: row.type,
                name,
                visits: row.visits,
                avgMs: row.avg_ms ?? 0,
                p50Ms: row.p50_ms ?? 0,
                p90Ms: row.p90_ms ?? 0,
            };
        });

        const UNKNOWN_PAGE = '(unknown)';
        const pageCountAt = new Map<string, number>();
        for (const row of pageSeries.rows) {
            pageCountAt.set(`${row.page ?? ''}\u0000${row.date}`, row.count);
        }
        const pages = pageTotals.rows.map((row) => {
            const page = row.page ?? UNKNOWN_PAGE;
            return {
                page,
                total: row.total,
                series: dayList.map((date) => ({
                    date,
                    count: pageCountAt.get(`${row.page ?? ''}\u0000${date}`) ?? 0,
                })),
            };
        });

        const articles = articleRows.rows.map((row) => ({
            page: row.page ?? UNKNOWN_PAGE,
            title: row.title ?? row.page ?? UNKNOWN_PAGE,
            id: row.id,
            reads: row.reads,
            readers: row.readers,
        }));

        return json({
            ok: true,
            range: {
                from: from.toISOString(),
                to: new Date().toISOString(),
                days,
                tz,
                bucket: 'day',
            },
            totals,
            points,
            durations: durationList,
            pages: { host, items: pages },
            articles,
        });
    } catch (error) {
        console.error('[query] failed to aggregate log records', error);
        // Surface the underlying cause so a misconfigured DB / missing table is
        // self-diagnosing from the response instead of an opaque 500.
        const message = error instanceof Error ? error.message : String(error);
        return json({ ok: false, error: 'query_failed', message }, 500);
    }
}
