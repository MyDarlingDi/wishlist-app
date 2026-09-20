import * as cheerio from "cheerio";
import { safeGet } from "./ssrf.js";

export interface LinkPreview {
  title: string | null;
  price: number | null;
  currency: string | null;
  image_url: string | null;
  site_name: string;
}

const SITE_NAMES: Record<string, string> = {
  "wildberries.ru": "Wildberries",
  "wb.ru": "Wildberries",
  "ozon.ru": "Ozon",
  "market.yandex.ru": "Яндекс Маркет",
  "aliexpress.ru": "AliExpress",
  "aliexpress.com": "AliExpress",
  "lamoda.ru": "Lamoda",
  "sbermegamarket.ru": "СберМегаМаркет",
  "detmir.ru": "Детский мир",
  "goldapple.ru": "Золотое яблоко",
};

export function siteNameFromUrl(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const hit = Object.keys(SITE_NAMES).find((d) => host === d || host.endsWith(`.${d}`));
  return hit ? SITE_NAMES[hit]! : host;
}

/** "1 299,00" / "1299.5" / 1299 → 1299 (whole units). */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  if (typeof raw !== "string") return null;
  const n = parseFloat(raw.replace(/[\s ]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const cleanTitle = (t: string) =>
  t
    .replace(/\s+/g, " ")
    .replace(/\s*[-–—|,]?\s*купить(?=\s|$).*$/iu, "") // \b is ASCII-only in JS, so no word boundary here
    .replace(/\s*[-–—|]\s*(интернет-магазин|Wildberries|Ozon|OZON|Яндекс\s*Маркет).*$/i, "")
    .trim()
    .slice(0, 200);

type Json = Record<string, unknown>;

function* walkJsonLd(node: unknown): Generator<Json> {
  if (Array.isArray(node)) for (const n of node) yield* walkJsonLd(n);
  else if (node && typeof node === "object") {
    yield node as Json;
    const graph = (node as Json)["@graph"];
    if (graph) yield* walkJsonLd(graph);
  }
}

const firstString = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return firstString(v[0]);
  if (v && typeof v === "object") return firstString((v as Json).url ?? (v as Json).contentUrl);
  return null;
};

/** Pure HTML → preview: JSON-LD Product first, then OpenGraph / product meta tags. */
export function parseProductHtml(html: string, pageUrl: string): LinkPreview {
  const $ = cheerio.load(html);
  const meta = (sel: string) => $(sel).first().attr("content")?.trim() || null;

  let title: string | null = null;
  let price: number | null = null;
  let currency: string | null = null;
  let image: string | null = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    let data: unknown;
    try {
      data = JSON.parse($(el).text());
    } catch {
      return;
    }
    for (const node of walkJsonLd(data)) {
      const type = ([] as unknown[]).concat(node["@type"] ?? []).join(",");
      if (!/Product/i.test(type)) continue;
      title ??= firstString(node.name);
      image ??= firstString(node.image);
      const offers = ([] as Json[]).concat((node.offers as Json | Json[]) ?? []);
      for (const o of offers) {
        price ??= parsePrice(o.price ?? o.lowPrice ?? (o.priceSpecification as Json | undefined)?.price);
        currency ??= firstString(o.priceCurrency);
      }
    }
  });

  title ??= meta('meta[property="og:title"]') ?? meta('meta[name="twitter:title"]') ?? ($("title").first().text().trim() || null);
  image ??= meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]');
  price ??= parsePrice(
    meta('meta[property="product:price:amount"]') ?? meta('meta[property="og:price:amount"]') ?? meta('[itemprop="price"]') ?? $('[itemprop="price"]').first().attr("content"),
  );
  currency ??= meta('meta[property="product:price:currency"]') ?? meta('meta[property="og:price:currency"]') ?? meta('[itemprop="priceCurrency"]');

  let image_url: string | null = null;
  if (image) {
    try {
      image_url = new URL(image, pageUrl).toString();
    } catch {
      image_url = null;
    }
  }
  return {
    title: title ? cleanTitle(title) || null : null,
    price,
    currency: currency ? currency.toUpperCase().slice(0, 3) : null,
    image_url,
    site_name: siteNameFromUrl(pageUrl),
  };
}

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.5",
};

/**
 * Best effort: big marketplaces often serve a bot-check page to server IPs,
 * in which case the preview comes back empty and the UI falls back to the screenshot.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  const res = await safeGet(url, { headers: BROWSER_HEADERS, maxBytes: 3 * 1024 * 1024 });
  const type = String(res.headers["content-type"] ?? "");
  if (res.status >= 400 || !/html/i.test(type)) {
    return { title: null, price: null, currency: null, image_url: null, site_name: siteNameFromUrl(res.finalUrl) };
  }
  return parseProductHtml(res.body.toString("utf8"), res.finalUrl);
}
