import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeBox } from "../src/services/images.js";
import { buildInitData, makeApp, pngDataUrl, tma } from "./helpers.js";

const owner = { id: 1001, first_name: "Оля" };
const anya = { id: 2002, first_name: "Аня" };
const boris = { id: 3003, first_name: "Борис" };

type Ctx = Awaited<ReturnType<typeof makeApp>>;
let t: Ctx;
const as = (u: { id: number; first_name: string }) => ({ Authorization: tma(u) });

beforeAll(async () => {
  t = await makeApp({
    // Fake vision: pretends the model found the product photo in the middle of the screenshot.
    extract: async () => ({ title: "Кроссовки Nike", price: 8990, currency: "RUB", box: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }),
  });
});
afterAll(() => t.close());

async function addWish(body: Record<string, unknown> = {}) {
  const res = await request(t.app)
    .post("/api/wishes")
    .set(as(owner))
    .send({ title: "Кроссовки", url: "https://www.ozon.ru/product/1", price: 8990, ...body });
  expect(res.status).toBe(201);
  return res.body.item as { id: number };
}

describe("auth", () => {
  it("rejects requests without or with forged initData", async () => {
    expect((await request(t.app).get("/api/me")).status).toBe(401);
    const forged = buildInitData(owner, { token: "111:forged-token-abcdefghijklmnopq" });
    const res = await request(t.app).get("/api/me").set("Authorization", `tma ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "unauthorized", reason: "bad_hash" });
  });

  it("does not accept the dev shortcut outside DEV_AUTH mode", async () => {
    expect((await request(t.app).get("/api/me").set("Authorization", "dev 1:Hacker")).status).toBe(401);
  });

  it("creates the user and default wishlist on first sight and reports the share link", async () => {
    const res = await request(t.app).get("/api/me").set(as(owner));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1001, first_name: "Оля", share_link: "https://t.me/wish_and_gift_bot/wishlist?startapp=wishlist_1001" });
    expect(res.body.wishlist_id).toBeGreaterThan(0);
  });
});

describe("secret booking", () => {
  it("guest books; owner sees NOTHING about it; second guest is refused", async () => {
    const { id } = await addWish();
    await request(t.app).get("/api/me").set(as(anya));
    await request(t.app).get("/api/me").set(as(boris));

    const booked = await request(t.app).post(`/api/wishes/${id}/book`).set(as(anya));
    expect(booked.status).toBe(200);
    expect(booked.body.item).toMatchObject({ booked: true, booked_by_me: true });

    // The owner's view must not contain any trace of the booking — not even keys.
    const ownerView = await request(t.app).get("/api/wishes").set(as(owner));
    const mine = ownerView.body.items.find((w: { id: number }) => w.id === id);
    expect(ownerView.body.is_owner).toBe(true);
    expect(mine).toBeDefined();
    for (const key of ["booked", "booked_by_me", "collected", "contributors", "my_contribution", "remaining"]) {
      expect(mine).not.toHaveProperty(key);
    }
    expect(JSON.stringify(ownerView.body)).not.toContain("Аня");
    // Same for the owner's response to their own write endpoints.
    const patched = await request(t.app).patch(`/api/wishes/${id}`).set(as(owner)).send({ title: "Кроссовки Nike" });
    expect(patched.body.item).not.toHaveProperty("booked");

    const guestView = await request(t.app).get(`/api/wishes?owner=wishlist_${owner.id}`).set(as(boris));
    expect(guestView.body.is_owner).toBe(false);
    expect(guestView.body.items.find((w: { id: number }) => w.id === id)).toMatchObject({ booked: true, booked_by_me: false });

    const second = await request(t.app).post(`/api/wishes/${id}/book`).set(as(boris));
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("already_booked");

    // Anya changes her mind → free again; Boris can take it.
    expect((await request(t.app).delete(`/api/wishes/${id}/book`).set(as(anya))).status).toBe(200);
    expect((await request(t.app).post(`/api/wishes/${id}/book`).set(as(boris))).status).toBe(200);
  });

  it("notifies once per booking, and not again when the same person re-books", async () => {
    const { id } = await addWish({ title: "Часы" });
    t.calls.length = 0;
    await request(t.app).post(`/api/wishes/${id}/book`).set(as(anya));
    await request(t.app).post(`/api/wishes/${id}/book`).set(as(anya));
    expect(t.calls).toEqual([`booked:${id}:${anya.id}`]);
  });

  it("owner cannot book their own wish; strangers cannot edit or delete it", async () => {
    const { id } = await addWish({ title: "Плед" });
    expect((await request(t.app).post(`/api/wishes/${id}/book`).set(as(owner))).status).toBe(403);
    expect((await request(t.app).patch(`/api/wishes/${id}`).set(as(anya)).send({ title: "хак" })).status).toBe(404);
    expect((await request(t.app).delete(`/api/wishes/${id}`).set(as(anya))).status).toBe(404);
    expect((await request(t.app).delete(`/api/wishes/${id}`).set(as(owner))).status).toBe(204);
  });

  it("returns 404 for an unknown wishlist owner", async () => {
    expect((await request(t.app).get("/api/wishes?owner=999999").set(as(anya))).status).toBe(404);
  });
});

describe("group gifts", () => {
  it("needs a target price", async () => {
    const res = await request(t.app).post("/api/wishes").set(as(owner)).send({ title: "Велосипед", is_group_gift: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("group_gift_needs_price");
  });

  it("collects shares, hides them from the owner, never overshoots, and can't be booked", async () => {
    const { id } = await addWish({ title: "Велосипед", price: 10000, is_group_gift: true });
    t.calls.length = 0;

    expect((await request(t.app).post(`/api/wishes/${id}/book`).set(as(anya))).body.error).toBe("group_gift");

    const first = await request(t.app).post(`/api/wishes/${id}/contribute`).set(as(anya)).send({ amount: 3000 });
    expect(first.body.item).toMatchObject({ collected: 3000, contributors: 1, my_contribution: 3000, remaining: 7000 });
    await request(t.app).post(`/api/wishes/${id}/contribute`).set(as(boris)).send({ amount: 2000 });
    expect(t.calls).toEqual([`contributed:${id}:${anya.id}:3000:3000`, `contributed:${id}:${boris.id}:2000:5000`]);

    const tooMuch = await request(t.app).post(`/api/wishes/${id}/contribute`).set(as(anya)).send({ amount: 6000 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body).toMatchObject({ error: "exceeds_remaining", remaining: 5000 });

    const ownerView = (await request(t.app).get("/api/wishes").set(as(owner))).body.items.find((w: { id: number }) => w.id === id);
    expect(ownerView).toMatchObject({ is_group_gift: true, price: 10000 });
    expect(ownerView).not.toHaveProperty("collected");

    expect((await request(t.app).post(`/api/wishes/${id}/contribute`).set(as(owner)).send({ amount: 100 })).status).toBe(403);

    const withdrawn = await request(t.app).delete(`/api/wishes/${id}/contribute`).set(as(boris));
    expect(withdrawn.body.item).toMatchObject({ collected: 3000, my_contribution: 0 });
    expect((await request(t.app).delete(`/api/wishes/${id}/contribute`).set(as(boris))).status).toBe(404);
  });

  it("simultaneous contributions cannot overshoot the target", async () => {
    const { id } = await addWish({ title: "Телевизор", price: 1000, is_group_gift: true });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => request(t.app).post(`/api/wishes/${id}/contribute`).set(as({ id: 5000 + i, first_name: `G${i}` })).send({ amount: 300 })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    const view = await request(t.app).get(`/api/wishes?owner=${owner.id}`).set(as(anya));
    const item = view.body.items.find((w: { id: number }) => w.id === id);
    expect(item.collected).toBeLessThanOrEqual(1000);
    expect(item.collected).toBe(900);
  });

  it("contributing to an ordinary wish is refused", async () => {
    const { id } = await addWish({ title: "Книга" });
    expect((await request(t.app).post(`/api/wishes/${id}/contribute`).set(as(anya)).send({ amount: 100 })).body.error).toBe("not_group_gift");
  });
});

describe("validation", () => {
  it.each([
    [{ title: "" }],
    [{ title: "ok", url: "javascript:alert(1)" }],
    [{ title: "ok", url: "ftp://example.com/x" }],
    [{ title: "ok", price: -5 }],
    [{ title: "ok", price: 1.5 }],
    [{ title: "ok", image_id: "not-a-uuid" }],
  ])("rejects %j", async (body) => {
    expect((await request(t.app).post("/api/wishes").set(as(owner)).send(body)).status).toBe(400);
  });
});

describe("screenshot parsing and images", () => {
  it("returns title, price and a suggested crop box, but stores no image (the client crops and uploads it itself)", async () => {
    const res = await request(t.app).post("/api/parse/screenshot").set(as(owner)).send({ image: await pngDataUrl(800, 600, "#00aa00") });
    expect(res.status).toBe(200);
    // Padded a little by the server (see sanitizeBox) so a tight AI guess doesn't crop into the product.
    expect(res.body).toEqual({ title: "Кроссовки Nike", price: 8990, currency: "RUB", box: sanitizeBox({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }) });
  });

  it("uploads a client-cropped photo, served with a frame colour and visible to everyone who can see the wish", async () => {
    const up = await request(t.app).post("/api/images").set(as(owner)).send({ image: await pngDataUrl(400, 400, "#00aa00") });
    expect(up.status).toBe(201);
    expect(up.body.image_bg).toMatch(/^#[0-9a-f]{6}$/);
    expect(up.body.image_url).toContain("/api/images/");

    const img = await request(t.app).get(up.body.image_url); // public: no Authorization header on <img>
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
    expect(img.headers["cache-control"]).toContain("immutable");

    // The saved wish exposes the image and the frame colour to viewers.
    const { id } = await addWish({ title: "С картинкой", image_id: up.body.image_id });
    const list = await request(t.app).get(`/api/wishes?owner=${owner.id}`).set(as(anya));
    expect(list.body.items.find((w: { id: number }) => w.id === id)).toMatchObject({ image_url: up.body.image_url, image_bg: up.body.image_bg });
  });

  it("rejects non-images and unauthenticated uploads", async () => {
    expect((await request(t.app).post("/api/parse/screenshot").set(as(owner)).send({ image: "data:image/png;base64,AAAA" })).status).toBe(400);
    expect((await request(t.app).post("/api/images").send({ image: await pngDataUrl() })).status).toBe(401);
    expect((await request(t.app).get("/api/images/not-a-uuid")).status).toBe(404);
  });

  it("reports 503 when the Anthropic key is not configured", async () => {
    const bare = await makeApp(null);
    const res = await request(bare.app).post("/api/parse/screenshot").set(as(owner)).send({ image: await pngDataUrl() });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("vision_not_configured");
    await bare.close();
  });

  it("refuses to fetch internal addresses through the link parser (SSRF)", async () => {
    for (const url of ["http://127.0.0.1:8080/admin", "http://169.254.169.254/latest/meta-data/", "http://localhost/"]) {
      const res = await request(t.app).post("/api/parse/link").set(as(owner)).send({ url });
      expect(res.status, url).toBe(400);
    }
  });
});
