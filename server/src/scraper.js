import * as cheerio from "cheerio";
import fetch from "node-fetch";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BROWSER_HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "ru,en;q=0.8",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Upgrade-Insecure-Requests": "1",
};

// Частые способы, которыми магазины прячут цену в meta/JSON-LD
const PRICE_META_KEYS = [
  'meta[property="product:price:amount"]',
  'meta[property="og:price:amount"]',
  'meta[itemprop="price"]',
  'meta[name="twitter:data1"]',
];

function extractPriceFromText(text) {
  // ищем что-то похожее на "1 234 ₽", "$99.90", "12990 руб", "€49"
  const match = text.match(
    /(?:[€$₽]|руб\.?|USD|EUR)\s?([\d\s]{2,9}(?:[.,]\d{1,2})?)|([\d\s]{2,9}(?:[.,]\d{1,2})?)\s?(?:[€$₽]|руб\.?)/i
  );
  if (!match) return null;
  const raw = (match[1] || match[2] || "").replace(/\s/g, "").replace(",", ".");
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function detectCurrency(text) {
  if (/₽|руб/i.test(text)) return "RUB";
  if (/\$/.test(text)) return "USD";
  if (/€/.test(text)) return "EUR";
  return null;
}

export async function scrapeProduct(url) {
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    redirect: "follow",
    timeout: 15000,
  });
  if (!res.ok) {
    throw new Error(`Не удалось загрузить страницу (${res.status})`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    $("title").first().text() ||
    null;

  let image =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    null;
  if (image && image.startsWith("//")) image = "https:" + image;

  const siteName =
    $('meta[property="og:site_name"]').attr("content") || new URL(url).hostname.replace(/^www\./, "");

  let price = null;
  for (const sel of PRICE_META_KEYS) {
    const val = $(sel).attr("content");
    if (val) {
      const n = parseFloat(String(val).replace(/[^\d.,]/g, "").replace(",", "."));
      if (Number.isFinite(n) && n > 0) {
        price = n;
        break;
      }
    }
  }

  let currency =
    $('meta[property="product:price:currency"]').attr("content") ||
    $('meta[property="og:price:currency"]').attr("content") ||
    null;

  if (!price) {
    // резервный вариант: ищем цену в видимом тексте страницы (лучший эффорт, не идеально)
    const bodyText = $("body").text().slice(0, 20000);
    price = extractPriceFromText(bodyText);
    if (!currency) currency = detectCurrency(bodyText);
  }
  if (!currency) currency = "RUB";

  return {
    title: title ? title.trim().slice(0, 300) : null,
    image_url: image,
    price,
    currency,
    site_name: siteName,
  };
}
