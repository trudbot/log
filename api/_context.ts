import { geolocation, ipAddress, type Geo } from '@vercel/functions';

/**
 * Context that the server derives from the incoming request and attaches to
 * every log entry. These values originate from Vercel's edge (IP, geo headers)
 * or from standard request headers, so they are harder to forge than anything
 * carried in the request body.
 */
export interface RequestContext {
  ip: string | null;
  location: Partial<Geo>;
  timezone: string | null;
  language: string | null;
  userAgent: string | null;
  referer: string | null;
}

export function extractRequestContext(request: Request): RequestContext {
  const headers = request.headers;
  return {
    ip: ipAddress(request) ?? null,
    location: geolocation(request) ?? {},
    // Resolved from the visitor's IP by Vercel's edge; an IANA name like
    // "Asia/Shanghai". Absent when running outside Vercel (e.g. `vercel dev`).
    timezone: headers.get('x-vercel-ip-timezone'),
    // Raw Accept-Language so downstream analysis can weigh quality values.
    language: headers.get('accept-language'),
    userAgent: headers.get('user-agent'),
    // Origin is the useful fallback for CORS/beacon calls that omit Referer.
    referer: headers.get('referer') ?? headers.get('origin'),
  };
}
