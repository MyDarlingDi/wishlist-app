// Run with `npm test` (Node's built-in runner: no extra dependencies, so the lockfile Vercel builds from stays untouched).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseShareText, type ShareText } from "../src/shareText.ts";

/** Asserts only the listed fields, so each case reads as "this input gives this title/price". */
function check(raw: string, expected: Partial<ShareText>) {
  const got = parseShareText(raw);
  assert.ok(got, `expected a result for ${JSON.stringify(raw)}`);
  for (const [key, want] of Object.entries(expected)) {
    assert.deepEqual(got[key as keyof ShareText], want, `${key} for ${JSON.stringify(raw)}`);
  }
}

describe("parseShareText", () => {
  it("returns null when there is no link at all", () => {
    assert.equal(parseShareText("просто текст без ссылки"), null);
    assert.equal(parseShareText(""), null);
  });

  it("leaves a bare link alone", () => {
    assert.deepEqual(parseShareText("https://www.ozon.ru/product/krossovki-123/"), {
      url: "https://www.ozon.ru/product/krossovki-123/",
      title: null,
      price: null,
      hadText: false,
    });
  });

  it("takes title and price from an Ozon-style share message", () => {
    check("Смотри, что я нашёл на Ozon: Кроссовки Nike Air Max 90 12 990 ₽ https://ozon.ru/t/AbC123", {
      url: "https://ozon.ru/t/AbC123",
      title: "Кроссовки Nike Air Max 90",
      price: 12990,
      hadText: true,
    });
  });

  it("handles a multi-line Wildberries-style message", () => {
    check("Платье женское летнее\n1 299 ₽\nhttps://www.wildberries.ru/catalog/123456/detail.aspx", {
      url: "https://www.wildberries.ru/catalog/123456/detail.aspx",
      title: "Платье женское летнее",
      price: 1299,
    });
  });

  it("understands «руб.», «р», non-breaking spaces and kopecks", () => {
    check("Чайник Xiaomi, 2 490 руб. https://market.yandex.ru/product/1", { title: "Чайник Xiaomi", price: 2490 });
    check("Лампа 12 990 ₽ https://x.ru/a", { title: "Лампа", price: 12990 });
    check("Книга 1299,50 ₽ https://x.ru/a", { price: 1300 });
    check("Книга 1299р https://x.ru/a", { title: "Книга", price: 1299 });
  });

  it("keeps digits that belong to the title and picks the first of several prices", () => {
    check("Кроссовки 42 размер 5 990 ₽ https://x.ru/a", { title: "Кроссовки 42 размер", price: 5990 });
    check("Куртка 3 990 ₽ 7 500 ₽ https://x.ru/a", { title: "Куртка", price: 3990 });
    check("Модель 2024 12 990 ₽ https://x.ru/a", { title: "Модель 2024", price: 12990 });
  });

  it("works with only a title, and with the link in the middle", () => {
    check("Белая блузка с объемными рукавами https://ozon.ru/t/xyz", { title: "Белая блузка с объемными рукавами", price: null });
    check("Лампа настольная https://wb.ru/abc тёплый свет", { url: "https://wb.ru/abc", title: "Лампа настольная тёплый свет" });
  });

  it("strips punctuation glued to the link", () => {
    check("Смотри https://ozon.ru/t/abc).", { url: "https://ozon.ru/t/abc" });
    check("«https://ozon.ru/t/abc»", { url: "https://ozon.ru/t/abc" });
  });

  it("drops store names, «Цена:» labels and lead-in chatter from the title", () => {
    check("Наушники Sony WH-1000XM5 на Wildberries https://wbx.ru/a", { title: "Наушники Sony WH-1000XM5" });
    check("Ozon\nКружка\nhttps://ozon.ru/t/1", { title: "Кружка" });
    check("Кружка\nЦена: 450 ₽\nhttps://ozon.ru/t/1", { title: "Кружка", price: 450 });
    check("Кружка - Wildberries https://wbx.ru/a", { title: "Кружка" });
  });

  it("returns no title when only chatter is left, and caps very long titles", () => {
    check("Смотри! https://ozon.ru/t/1", { title: null });
    const long = parseShareText(`${"слово ".repeat(80)}https://x.ru/a`);
    assert.ok(long?.title && long.title.length <= 200);
  });

  it("ignores absurd prices the server would reject", () => {
    check("Товар 0 ₽ https://x.ru/a", { price: null });
    check("Товар 999 999 999 999 ₽ https://x.ru/a", { price: null });
  });
});
