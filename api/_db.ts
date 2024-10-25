import { Geo } from '@vercel/functions';
import { createKysely } from '@vercel/postgres-kysely';
import {
    JSONColumnType,
} from 'kysely'

interface Database {
  view_record: UserRecord;
}

interface UserRecord {
    ip: string;
    location: JSONColumnType<{
        [k in keyof Geo]?: Geo[k];
    }>;
    timestamp: number;
}
 
export const db = createKysely<Database>();
