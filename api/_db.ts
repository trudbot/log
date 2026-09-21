import type { Geo } from '@vercel/functions';
import { createKysely } from '@vercel/postgres-kysely';
import type { ColumnType, Generated, JSONColumnType } from 'kysely';

/**
 * The kinds of events this system captures. Kept as a const tuple so the
 * runtime list (for validation) and the union type stay in sync.
 *
 * display  = 展现 (content rendered into the DOM/tree)
 * exposure = 曝光 (content actually entered the viewport / became visible)
 * click    = 点击 (user interaction)
 */
export const LOG_TYPES = ['display', 'exposure', 'click'] as const;
export type LogType = (typeof LOG_TYPES)[number];

interface LogRecordTable {
  id: Generated<number>;
  type: LogType;
  ip: string | null;
  location: JSONColumnType<Partial<Geo>>;
  timezone: string | null;
  language: string | null;
  user_agent: string | null;
  referer: string | null;
  // Caller-supplied custom fields. The shape is intentionally open because it
  // varies per event, so it lives in a single JSONB column rather than schema.
  params: JSONColumnType<Record<string, unknown>>;
  // Event time in epoch milliseconds. Stored as BIGINT because ms timestamps
  // overflow a 32-bit INT; Kysely surfaces BIGINT as a string on read while
  // accepting a number on write.
  event_timestamp: ColumnType<string, number, number>;
  created_at: Generated<Date>;
}

interface Database {
  log_record: LogRecordTable;
}

export const db = createKysely<Database>();
