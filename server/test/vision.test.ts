import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createVision, DEFAULT_MODELS } from "../src/services/vision.js";

describe("createVision provider selection", () => {
  it("returns null without any key, or when the chosen provider has no key", () => {
    expect(createVision({})).toBeNull();
    expect(createVision({ provider: "openai", anthropicKey: "sk-ant-x" })).toBeNull();
    expect(createVision({ provider: "anthropic", openaiKey: "sk-x" })).toBeNull();
  });
  it("picks whichever key exists", () => {
    expect(createVision({ openaiKey: "sk-x" })).not.toBeNull();
    expect(createVision({ anthropicKey: "sk-ant-x" })).not.toBeNull();
    expect(DEFAULT_MODELS.anthropic).toBe("claude-opus-5");
  });
});

describe("OpenAI recogniser against a fake OpenAI server", () => {
  let server: http.Server;
  let baseURL: string;
  let seen: { auth?: string; body?: any } = {};
  let reply: () => unknown = () => ({});

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        seen = { auth: req.headers.authorization, body: JSON.parse(raw) };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(reply()));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => void server.close());

  const completion = (content: string | null) => ({
    id: "x", object: "chat.completion", created: 0, model: "m",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
  });

  it("sends the picture and a strict schema, and parses the answer", async () => {
    reply = () => completion(JSON.stringify({ title: "  Кроссовки   Nike  ", price: 12990.4, currency: "RUB", product_photo: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } }));
    const vision = createVision({ openaiKey: "sk-test", openaiBaseUrl: baseURL })!;
    const out = await vision.extract(Buffer.from("fake-jpeg-bytes"));

    expect(out).toEqual({ title: "Кроссовки Nike", price: 12990, currency: "RUB", box: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } });
    expect(seen.auth).toBe("Bearer sk-test");
    expect(seen.body.model).toBe(DEFAULT_MODELS.openai);
    const parts = seen.body.messages[0].content;
    expect(parts.find((p: any) => p.type === "image_url").image_url.url).toBe(`data:image/jpeg;base64,${Buffer.from("fake-jpeg-bytes").toString("base64")}`);
    const fmt = seen.body.response_format;
    expect(fmt).toMatchObject({ type: "json_schema", json_schema: { strict: true, name: "product_extraction" } });
    const schema = fmt.json_schema.schema;
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["title", "price", "currency", "product_photo"]);
  });

  it("copes with nulls, empty content and garbage that breaks the schema", async () => {
    const vision = createVision({ openaiKey: "sk-test", openaiBaseUrl: baseURL, model: "custom-model" })!;
    reply = () => completion(JSON.stringify({ title: null, price: null, currency: "RUB", product_photo: null }));
    expect(await vision.extract(Buffer.from("x"))).toEqual({ title: null, price: null, currency: "RUB", box: null });
    expect(seen.body.model).toBe("custom-model");
    reply = () => completion(null);
    expect((await vision.extract(Buffer.from("x"))).title).toBeNull();
    reply = () => completion(JSON.stringify({ title: 5, price: "много", currency: "GBP" }));
    expect((await vision.extract(Buffer.from("x"))).price).toBeNull();
  });
});
