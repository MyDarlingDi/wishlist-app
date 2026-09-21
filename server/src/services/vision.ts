import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { z } from "zod";
import type { Box } from "./images.js";

export interface ScreenshotResult {
  title: string | null;
  price: number | null;
  currency: string;
  box: Box | null;
}

export interface Vision {
  extract(jpeg: Buffer): Promise<ScreenshotResult>;
}

const Extraction = z.object({
  title: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.enum(["RUB", "USD", "EUR", "KZT", "BYN", "UAH"]),
  product_photo: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable(),
});

const PROMPT = `Это скриншот карточки товара из интернет-магазина (Wildberries, Ozon, Яндекс Маркет и подобных) или фото товара. Достань данные для вишлиста.

title — название товара так, как назвал бы его человек: бренд + модель + главная характеристика. Без рекламных слов, без названия магазина, без артикулов. Если названия не видно — null.
price — цена, которую покупатель платит сейчас: основная крупная цена, целое число. Не зачёркнутая старая цена, не «в рассрочку X в месяц», не отзывы и не рейтинг. Если цены не видно — null.
currency — валюта цены (для ₽ — RUB).
product_photo — рамка главной фотографии товара (не миниатюры, не иконки, не баннеры) в долях изображения от 0 до 1: x и y — левый верхний угол, width и height — размеры. Если на скриншоте нет отдельной фотографии товара — null.

Ничего не выдумывай: чего не видно — null.`;

const EMPTY: ScreenshotResult = { title: null, price: null, currency: "RUB", box: null };

type Extracted = z.infer<typeof Extraction>;

function toResult(out: Extracted | null | undefined): ScreenshotResult {
  if (!out) return EMPTY;
  const title = out.title?.replace(/\s+/g, " ").trim().slice(0, 200) || null;
  const price = out.price && out.price > 0 ? Math.round(out.price) : null;
  return { title, price, currency: out.currency, box: out.product_photo };
}

export interface VisionOptions {
  /** Force a provider; default: Anthropic if its key is set, otherwise OpenAI. */
  provider?: "anthropic" | "openai";
  anthropicKey?: string;
  openaiKey?: string;
  /** Overrides the provider's default model. */
  model?: string;
  /** For tests only. */
  openaiBaseUrl?: string;
}

export const DEFAULT_MODELS = { anthropic: "claude-opus-5", openai: "gpt-5.6-luna" } as const;

/** `effort` is rejected by Haiku 4.5 / Sonnet 4.5, accepted by the current Opus/Sonnet 5 models. */
const supportsEffort = (model: string) => !/haiku|sonnet-4-5/.test(model);

function anthropicVision(apiKey: string, model: string): Vision {
  const client = new Anthropic({ apiKey });
  return {
    async extract(jpeg) {
      const response = await client.messages.parse({
        model,
        max_tokens: 2000,
        output_config: { ...(supportsEffort(model) ? { effort: "low" as const } : {}), format: zodOutputFormat(Extraction) },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      });
      return toResult(response.parsed_output);
    },
  };
}

function openaiVision(apiKey: string, model: string, baseURL?: string): Vision {
  const client = new OpenAI({ apiKey, baseURL, maxRetries: 2 });
  const { $schema: _omit, ...schema } = z.toJSONSchema(Extraction) as Record<string, unknown>;
  return {
    async extract(jpeg) {
      const response = await client.chat.completions.create({
        model,
        // Reasoning-style models spend part of this budget on thinking before the JSON.
        max_completion_tokens: 6000,
        response_format: { type: "json_schema", json_schema: { name: "product_extraction", strict: true, schema } },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, detail: "high" } },
            ],
          },
        ],
      });
      const text = response.choices[0]?.message?.content;
      if (!text) return EMPTY;
      const parsed = Extraction.safeParse(JSON.parse(text));
      return parsed.success ? toResult(parsed.data) : EMPTY;
    },
  };
}

/** Returns null when no key for the chosen provider is configured. */
export function createVision(o: VisionOptions): Vision | null {
  const provider = o.provider ?? (o.anthropicKey ? "anthropic" : o.openaiKey ? "openai" : undefined);
  if (provider === "anthropic" && o.anthropicKey) return anthropicVision(o.anthropicKey, o.model ?? DEFAULT_MODELS.anthropic);
  if (provider === "openai" && o.openaiKey) return openaiVision(o.openaiKey, o.model ?? DEFAULT_MODELS.openai, o.openaiBaseUrl);
  return null;
}
