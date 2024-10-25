import {ipAddress, geolocation} from "@vercel/functions"
export function GET(request: Request) {
  return new Response(`Your IP address is ${ipAddress(request)}, and your geolocation is ${JSON.stringify(geolocation(request))}`);
}