import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { HttpError } from "../src/errors.js";
import { parseWishlistRef, shareLink } from "../src/links.js";
import { dataUrlToBuffer, processImage, sanitizeBox } from "../src/services/images.js";
import { createNotifier } from "../src/services/notify.js";
import { parsePrice, parseProductHtml, siteNameFromUrl } from "../src/services/scrape.js";
import { isPrivateIp, safeGet } from "../src/services/ssrf.js";

describe("isPrivateIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])(
    "blocks %s",
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe("safeGet", () => {
  it.each(["http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://10.0.0.5:8080/", "ftp://example.com/", "file:///etc/passwd"])(
    "refuses %s",
    async (url) => {
      await expect(safeGet(url)).rejects.toBeInstanceOf(HttpError);
    },
  );
});

describe("parseProductHtml", () => {
  it("prefers JSON-LD Product data", () => {
    const html = `<html><head><title>x</title><script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Кроссовки Nike Air Max 90 — купить в интернет-магазине",
       "image":["/img/a.jpg"],"offers":{"@type":"Offer","price":"12 990,00","priceCurrency":"rub"}}]}</script></head></html>`;
    expect(parseProductHtml(html, "https://www.wildberries.ru/catalog/1/detail.aspx")).toEqual({
      title: "Кроссовки Nike Air Max 90",
      price: 12990,
      currency: "RUB",
      image_url: "https://www.wildberries.ru/img/a.jpg",
      site_name: "Wildberries",
    });
  });

  it("falls back to OpenGraph and product meta tags", () => {
    const html = `<head><meta property="og:title" content="Чайник Xiaomi купить по выгодной цене на OZON.ru">
      <meta property="og:image" content="https://cdn.example.com/k.png"><meta property="product:price:amount" content="2490">
      <meta property="product:price:currency" content="RUB"></head>`;
    const r = parseProductHtml(html, "https://www.ozon.ru/product/1/");
    expect(r).toMatchObject({ title: "Чайник Xiaomi", price: 2490, currency: "RUB", image_url: "https://cdn.example.com/k.png", site_name: "Ozon" });
  });

  it("returns nulls for a page with nothing useful (bot-check page)", () => {
    expect(parseProductHtml("<html><body>Access denied</body></html>", "https://market.yandex.ru/x")).toMatchObject({
      title: null,
      price: null,
      image_url: null,
      site_name: "Яндекс Маркет",
    });
  });

  it("parses prices in the formats shops use", () => {
    expect([parsePrice("1 299,90"), parsePrice("1 299"), parsePrice(1299.4), parsePrice("abc"), parsePrice(0), parsePrice(null)]).toEqual([
      1300, 1299, 1299, null, null, null,
    ]);
    expect(siteNameFromUrl("https://sub.example.org/a")).toBe("sub.example.org");
  });
});

describe("images", () => {
  it("crops to the product box, downsizes, and reports the edge colour", async () => {
    // Blue canvas with a red square in the middle: the crop must be mostly red, edge colour reddish.
    const canvas = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#0000ff" } })
      .composite([{ input: await sharp({ create: { width: 500, height: 500, channels: 3, background: "#ff0000" } }).png().toBuffer(), left: 750, top: 250 }])
      .png()
      .toBuffer();
    const out = await processImage(canvas, { x: 0.375, y: 0.25, width: 0.25, height: 0.5 });
    expect(out.cropped).toBe(true);
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1000);
    expect(meta.width! / meta.height!).toBeCloseTo(620 / 560, 1);
    // box 25%×50% of 2000×1000 plus 3% padding on each side → 620×560 px
    const [r, , b] = (await sharp(out.data).resize(1, 1).raw().toBuffer()) as unknown as number[];
    expect(r!).toBeGreaterThan(b!);
    expect(out.bg).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("ignores absurd boxes instead of producing a broken crop", () => {
    expect(sanitizeBox({ x: 0.5, y: 0.5, width: 0.01, height: 0.01 })).toBeNull();
    expect(sanitizeBox({ x: NaN, y: 0, width: 1, height: 1 })).toBeNull();
    expect(sanitizeBox({ x: 2, y: 2, width: 1, height: 1 })).toBeNull();
    expect(sanitizeBox(null)).toBeNull();
    expect(sanitizeBox({ x: 0, y: 0, width: 1, height: 1 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("rejects things that are not images", async () => {
    expect(() => dataUrlToBuffer("data:text/html;base64,PGh0bWw+")).toThrow(HttpError);
    await expect(processImage(Buffer.from("not an image"))).rejects.toMatchObject({ code: "bad_image" });
  });
});

describe("links", () => {
  it("parses old and new deep-link formats", () => {
    expect([parseWishlistRef("wishlist_123"), parseWishlistRef("u123"), parseWishlistRef("123"), parseWishlistRef("abc"), parseWishlistRef(""), parseWishlistRef(undefined)]).toEqual([
      123, 123, 123, null, null, null,
    ]);
  });
  it("uses the direct Mini App link only when a short name is configured", () => {
    expect(shareLink({ BOT_USERNAME: "b", APP_SHORT_NAME: undefined }, 5)).toBe("https://t.me/b?start=wishlist_5");
    expect(shareLink({ BOT_USERNAME: "b", APP_SHORT_NAME: "app" }, 5)).toBe("https://t.me/b/app?startapp=wishlist_5");
  });
});

describe("notifier", () => {
  const ctx = (notifyChatId: number | null) =>
    ({
      wish: { id: 1, title: "Кроссовки <b>", price: 5000, currency: "RUB" },
      wishlist: { notifyChatId },
      owner: { id: 10, firstName: "Оля", lastName: null, username: null },
    }) as never;
  const who = { id: 20, firstName: "Аня", lastName: null, username: null } as never;

  it("stays silent without a chat, when there is no sender, or when the chat is the owner's own", async () => {
    const sent: unknown[] = [];
    const send = async (c: number, t: string) => void sent.push([c, t]);
    createNotifier(send).booked(ctx(null), who);
    createNotifier(send).booked(ctx(10), who);
    createNotifier(null).booked(ctx(-100), who);
    expect(sent).toEqual([]);
  });

  it("sends plain text to the organisers chat and swallows send failures", async () => {
    const sent: [number, string][] = [];
    const n = createNotifier(async (c, t) => void sent.push([c, t]));
    n.contributed(ctx(-100), who, 1000, 3000);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent[0]![0]).toBe(-100);
    expect(sent[0]![1]).toContain("Аня +1");
    expect(sent[0]![1]).toContain("из 5");
    expect(sent[0]![1]).toContain("«Кроссовки <b>»"); // sent without parse_mode, so it stays inert text

    const logged: string[] = [];
    createNotifier(async () => { throw new Error("boom"); }, (m) => void logged.push(m)).booked(ctx(-100), who);
    await new Promise((r) => setTimeout(r, 0));
    expect(logged).toEqual(["notify failed"]);
  });
});

describe("webhookSecret", () => {
  it("is derived from the token, stable, URL-safe, and changes when the token changes", async () => {
    const { webhookSecret } = await import("../src/config.js");
    const a = webhookSecret({ BOT_TOKEN: "1:aaaaaaaaaaaaaaaaaaaa", WEBHOOK_SECRET: undefined });
    expect(a).toBe(webhookSecret({ BOT_TOKEN: "1:aaaaaaaaaaaaaaaaaaaa", WEBHOOK_SECRET: undefined }));
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(a).not.toBe(webhookSecret({ BOT_TOKEN: "1:bbbbbbbbbbbbbbbbbbbb", WEBHOOK_SECRET: undefined }));
    expect(webhookSecret({ BOT_TOKEN: "x", WEBHOOK_SECRET: "explicit-override-1234" })).toBe("explicit-override-1234");
  });
});

describe("APP_SHORT_NAME", () => {
  const base = { BOT_TOKEN: "1:aaaaaaaaaaaaaaaaaaaa", WEBAPP_URL: "https://x.vercel.app" };

  // A dashboard field present-but-blank must fall back too — that's exactly what silently
  // dropped everyone back onto the unreliable ?start= link the first time this shipped.
  it.each([[{}], [{ APP_SHORT_NAME: "" }], [{ APP_SHORT_NAME: "  " }], [{ APP_SHORT_NAME: "\n" }]])("falls back to the registered short name for %j", async (extra) => {
    const { loadConfig } = await import("../src/config.js");
    expect(loadConfig({ ...base, ...extra }).APP_SHORT_NAME).toBe("wishlist");
  });

  it("still honours an explicit override", async () => {
    const { loadConfig } = await import("../src/config.js");
    expect(loadConfig({ ...base, APP_SHORT_NAME: " other " }).APP_SHORT_NAME).toBe("other");
  });
});
