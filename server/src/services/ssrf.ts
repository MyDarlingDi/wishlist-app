import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { HttpError } from "../errors.js";

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateIp(mapped[1]!);
    return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
  }
  return true;
}

/** DNS lookup that refuses non-public addresses — checked at connect time, so DNS rebinding can't bypass it. */
const safeLookup: net.LookupFunction = (hostname, options, cb) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (cb as (e: Error | null) => void)(err);
    const list = addresses as dns.LookupAddress[];
    const ok = list.filter((a) => !isPrivateIp(a.address));
    if (ok.length === 0) return (cb as (e: Error | null) => void)(new Error("blocked_address"));
    if (options.all) return (cb as (e: null, a: dns.LookupAddress[]) => void)(null, ok);
    (cb as (e: null, a: string, f: number) => void)(null, ok[0]!.address, ok[0]!.family);
  });
};

export interface SafeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  finalUrl: string;
}

export interface SafeGetOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

/** GET a public http(s) URL: no private addresses, capped size, capped redirects. */
export async function safeGet(url: string, opts: SafeGetOptions = {}): Promise<SafeResponse> {
  const { maxBytes = 2 * 1024 * 1024, timeoutMs = 8000, maxRedirects = 5, headers = {} } = opts;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await once(current, { maxBytes, timeoutMs, headers });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, current).toString();
      continue;
    }
    return { ...res, finalUrl: current };
  }
  throw new HttpError(422, "too_many_redirects");
}

function once(
  url: string,
  o: { maxBytes: number; timeoutMs: number; headers: Record<string, string> },
): Promise<Omit<SafeResponse, "finalUrl">> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return reject(new HttpError(400, "bad_url"));
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return reject(new HttpError(400, "bad_url"));
    if (u.port && u.port !== "80" && u.port !== "443") return reject(new HttpError(400, "bad_url"));
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) && isPrivateIp(u.hostname.replace(/^\[|\]$/g, ""))) {
      return reject(new HttpError(400, "blocked_address"));
    }

    const lib = u.protocol === "https:" ? https : http;
    const req = lib.get(
      u,
      { lookup: safeLookup, headers: { "accept-encoding": "identity", ...o.headers }, timeout: o.timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > o.maxBytes) {
            req.destroy();
            reject(new HttpError(422, "too_large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) =>
      reject(e instanceof HttpError ? e : new HttpError(e.message === "blocked_address" ? 400 : 502, e.message === "blocked_address" ? "blocked_address" : "fetch_failed")),
    );
  });
}
