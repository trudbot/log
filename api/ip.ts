import {ipAddress, geolocation, waitUntil} from "@vercel/functions"
import {db} from "./_db.js"

function isValidIP(ip: string): boolean {
    // 排除调试地址 ::1
    if (ip === '::1' || ip === '127.0.0.1') {
      return false;
    }

    // 正则表达式校验 IPv4 地址
    const ipv4Pattern = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (ipv4Pattern.test(ip)) {
        return true;
    }

    // 正则表达式校验 IPv6 地址
    const ipv6Pattern = /^([0-9a-fA-F]{1,4}:){7}([0-9a-fA-F]{1,4}|:)$/;
    if (ipv6Pattern.test(ip)) {
        return true;
    }

    return false;
}

export function GET(request: Request) {
    const ip = ipAddress(request) || '';
    const geo = geolocation(request) || {};
    const timestamp = Date.now();
    isValidIP(ip) && waitUntil((async () => {
        await db.insertInto('view_record').values({
            ip,
            location: JSON.stringify(geo),
            timestamp
        }).execute();
    })());
    return new Response(`Your IP address is ${ipAddress(request)}, and your geolocation is ${JSON.stringify(geo)}`);
}