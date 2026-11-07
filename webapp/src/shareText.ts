/**
 * The «Поделиться» button in Ozon, Wildberries, Яндекс Маркет and friends copies a whole message:
 * some chatter, the product name, sometimes a price, then the link. The shops refuse to serve the
 * product page to our server, but everything we need is already in the text the person pasted.
 */

export interface ShareText {
  url: string;
  title: string | null;
  price: number | null;
  /** True when the pasted text held more than the bare link. */
  hadText: boolean;
}

const MAX_TITLE_LENGTH = 200;
const MAX_PRICE = 100_000_000; // same ceiling the server enforces

const URL_PATTERN = /https?:\/\/[^\s<>"«»“”]+/i;
const URL_PATTERN_ALL = new RegExp(URL_PATTERN.source, "gi");
const TRAILING_PUNCTUATION = /[)\]}>.,;:!?'’]+$/u;

const STORE = String.raw`(?:ozon|озон|wildberries|вайлдберриз|вайлдберрис|wb|яндекс[\s.]*маркет\p{L}*|aliexpress|алиэкспресс|lamoda|ламода|сбермегамаркет|мегамаркет)`;

// 1 299 ₽ · 12 990 руб. · 1299,50 ₽ · 450р — «р»/«руб» only count when no letter follows ("рубашка" is not a price).
const PRICE_PATTERN = /(\d{1,3}(?:[\s  ]\d{3})+|\d+)(?:[.,](\d{1,2}))?[\s  ]?(?:₽|(?:рублей|рубля|рубль|руб\.?|р\.?|rub)(?!\p{L}))/giu;

const LEAD_INS = [
  /^(?:смотри|посмотри|глянь|гляди|зацени|вот)(?=[\s,!.:]|$)[^:\n]*:\s*/iu, // «Смотри, что я нашёл на Ozon:»
  /^(?:я\s+)?(?:нашёл|нашел|нашла|выбрал|выбрала|хочу)(?=[\s,!.:]|$)[^:\n]*:\s*/iu,
  new RegExp(String.raw`^[^:\n]{0,12}?${STORE}[^:\n]{0,20}:\s*`, "iu"), // «Товар на Ozon:»
  /^(?:смотри|посмотри|глянь|гляди|зацени)(?=[\s,!.]|$)[\s,!.]*/iu, // a bare «Смотри!»
];

const STORE_TAILS = [
  new RegExp(String.raw`\s*[,–—|-]?\s*(?:на|в)\s+${STORE}\s*[.!]?$`, "iu"),
  new RegExp(String.raw`\s*[–—|-]\s*${STORE}\s*[.!]?$`, "iu"),
  new RegExp(String.raw`\s*\(${STORE}\)\s*$`, "iu"),
];

const NOISE_LINE = new RegExp(String.raw`^(?:${STORE}|цена|стоимость|ссылка|товар)\s*[:.!-]*$`, "iu");
const PRICE_LABEL_TAIL = /\s*(?:цена|стоимость|всего)\s*[:–—-]?\s*$/iu;
const EDGE_SEPARATORS = /^[\s,;:|/\\–—·•\-"«»“”'’]+|[\s,;:|/\\–—·•\-"«»“”'’]+$/gu;

function firstValidPrice(text: string): number | null {
  for (const [, whole, kopecks] of text.matchAll(PRICE_PATTERN)) {
    const value = Math.round(Number(`${whole!.replace(/\s/g, "")}${kopecks ? `.${kopecks}` : ""}`));
    if (value >= 1 && value <= MAX_PRICE) return value;
  }
  return null;
}

function cleanLine(line: string): string {
  let out = line.replace(/\s+/g, " ").trim();
  if (NOISE_LINE.test(out)) return "";
  for (const lead of LEAD_INS) out = out.replace(lead, "");
  for (const tail of STORE_TAILS) out = out.replace(tail, "");
  out = out.replace(PRICE_LABEL_TAIL, "").replace(EDGE_SEPARATORS, "").trim();
  return NOISE_LINE.test(out) ? "" : out;
}

function buildTitle(textWithoutLinkAndPrice: string): string | null {
  const joined = textWithoutLinkAndPrice
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_TITLE_LENGTH)
    .trim();
  return /[\p{L}\p{N}]/u.test(joined) ? joined : null;
}

/** Splits pasted text into the link and whatever product details sit around it; null if there is no usable link. */
export function parseShareText(raw: string): ShareText | null {
  const found = URL_PATTERN.exec(raw);
  if (!found) return null;
  const url = found[0].replace(TRAILING_PUNCTUATION, "");
  try {
    if (!/^https?:$/.test(new URL(url).protocol)) return null;
  } catch {
    return null;
  }

  const text = raw.replace(URL_PATTERN_ALL, " ");
  return {
    url,
    title: buildTitle(text.replace(PRICE_PATTERN, " ")),
    price: firstValidPrice(text),
    hadText: text.trim().length > 0,
  };
}
