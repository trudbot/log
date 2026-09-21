import { waitUntil } from '@vercel/functions';
import { extractRequestContext } from './_context.js';
import { db, LOG_TYPES, type LogType } from './_db.js';

const ALLOWED_TYPES = new Set<string>(LOG_TYPES);

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Lightweight discovery endpoint describing the contract for callers.
export function GET(): Response {
  return json({
    service: 'log',
    endpoint: '/log',
    method: 'POST',
    types: [...LOG_TYPES],
    body: {
      type: LOG_TYPES.join(' | '),
      params: '{ ...custom fields, optional }',
      timestamp: 'epoch ms, optional (defaults to server receive time)',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
  }

  if (!isPlainObject(payload)) {
    return json({ error: 'invalid_body', message: 'Request body must be a JSON object.' }, 400);
  }

  const { type } = payload;
  if (typeof type !== 'string' || !ALLOWED_TYPES.has(type)) {
    return json(
      { error: 'invalid_type', message: `"type" must be one of: ${LOG_TYPES.join(', ')}.` },
      400,
    );
  }

  const params = isPlainObject(payload.params) ? payload.params : {};

  const eventTimestamp =
    typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp)
      ? payload.timestamp
      : Date.now();

  const context = extractRequestContext(request);

  // Client hints only fill gaps the edge could not resolve (e.g. local dev);
  // server-derived values win because they are harder to spoof.
  const timezone =
    context.timezone ?? (typeof payload.timezone === 'string' ? payload.timezone : null);
  const language =
    context.language ?? (typeof payload.language === 'string' ? payload.language : null);

  const record = {
    type: type as LogType,
    ip: context.ip,
    location: JSON.stringify(context.location),
    timezone,
    language,
    user_agent: context.userAgent,
    referer: context.referer,
    params: JSON.stringify(params),
    event_timestamp: eventTimestamp,
  };

  // Persist after the response so beacon-style callers stay low-latency.
  // waitUntil keeps the function alive until the write settles, preserving
  // durability; a failed write is logged, never surfaced to the client.
  waitUntil(
    db
      .insertInto('log_record')
      .values(record)
      .execute()
      .catch((error: unknown) => {
        console.error('[log] failed to persist record', error);
      }),
  );

  return json(
    {
      ok: true,
      type,
      timestamp: eventTimestamp,
      context: { ip: context.ip, location: context.location, timezone, language },
    },
    202,
  );
}
