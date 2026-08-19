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
  const hostname = new URL(url).hostname.replace(/^www\./, "");

  if (hostname.includes("wildberries.")) {
    try {
      const wbData = await scrapeWildberries(url);
      if (wbData) return wbData;
    } catch (e) {
      console.error("[scrapeWildberries] неофициальный способ не сработал, откат на обычный:", e.message);
    }
  }

  return scrapeGeneric(url);
}

// --- Wildberries: неофициальный служебный JSON-адрес карточки товара ---
// ВАЖНО: это не публичный документированный API, а внутренний адрес, которым
// пользуется сам сайт WB для подгрузки данных. Он может измениться без
// предупреждения — тогда просто произойдёт откат на обычный способ (scrapeGeneric),
// а если и он не сработает — на ручное заполнение. Ничего не сломается насовсем.
async function scrapeWildberries(url) {
  const match = url.match(/catalog\/(\d+)/);
  if (!match) return null;
  const nmId = match[1];

  const apiUrl = `https://card.wb.ru/cards/v2/detail?appType=1&curr=rub&dest=-1257786&spp=30&nm=${nmId}`;
  const res = await fetch(apiUrl, { headers: BROWSER_HEADERS, timeout: 10000 });
  if (!res.ok) throw new Error(`card.wb.ru ответил ${res.status}`);

  const json = await res.json();
  const product = json?.data?.products?.[0] || json?.products?.[0];
  if (!product) throw new Error("товар не найден в ответе card.wb.ru");

  const title = [product.brand, product.name].filter(Boolean).join(" — ") || null;

  // Цена у WB приходит в сотых долях копейки (price * 100 * 100); при смене
  // формата на «уже в рублях» подстрахуемся эвристикой на разумность величины.
  const rawPrice = product.salePriceU ?? product.priceU ?? null;
  let price = null;
  if (typeof rawPrice === "number" && rawPrice > 0) {
    price = rawPrice / 100;
    if (price > 2_000_000) price = price / 100; // на случай другого масштаба
  }

  const image_url = buildWbImageUrl(Number(nmId));

  return {
    title,
    image_url,
    price,
    currency: "RUB",
    site_name: "wildberries.ru",
  };
}

// Картинки WB раздаются с "корзин" (basket-XX.wbbasket.ru), номер которой
// зависит от диапазона, в который попадает id товара. Таблица диапазонов
// периодически расширяется самим WB — если попадём мимо, картинка просто не
// загрузится, и на карточке останется placeholder-иконка подарка.
function buildWbImageUrl(nmId) {
  const vol = Math.floor(nmId / 100000);
  const part = Math.floor(nmId / 1000);
  const ranges = [
    [143, "01"], [287, "02"], [431, "03"], [719, "04"], [1007, "05"],
    [1061, "06"], [1115, "07"], [1169, "08"], [1313, "09"], [1601, "10"],
    [1655, "11"], [1919, "12"], [2045, "13"], [2189, "14"], [2405, "15"],
    [2621, "16"], [2837, "17"], [3053, "18"], [3269, "19"], [3485, "20"],
    [3701, "21"], [3917, "22"], [4133, "23"],
  ];
  const basket = ranges.find(([max]) => vol <= max)?.[1] || "24";
  return `https://basket-${basket}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/big/1.webp`;
}

async function scrapeGeneric(url) {
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
