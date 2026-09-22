import { authHeader } from "./telegram";

const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

export interface Person {
  id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
}
export interface Me extends Person {
  wishlist_id: number;
  share_link: string;
}
export interface Wish {
  id: number;
  title: string;
  url: string | null;
  price: number | null;
  currency: string;
  site_name: string | null;
  image_url: string | null;
  image_bg: string | null;
  is_group_gift: boolean;
  // Only present for guests — the server never sends these to the owner.
  booked?: boolean;
  booked_by_me?: boolean;
  collected?: number;
  contributors?: number;
  my_contribution?: number;
  remaining?: number | null;
}
export interface WishesResponse {
  owner: Person;
  is_owner: boolean;
  wishlist: { id: number; title: string };
  items: Wish[];
}
export interface Photo {
  image_id: string | null;
  image_url: string | null;
  image_bg: string | null;
}
export interface ParsedItem extends Photo {
  title: string | null;
  price: number | null;
  currency: string;
}
/** Relative rectangle (0..1) over the screenshot, e.g. {x:0,y:0,width:1,height:1} = the whole image. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ScreenshotResult {
  title: string | null;
  price: number | null;
  currency: string;
  /** Where the model thinks the product photo is — a starting point for the crop tool, nothing is stored yet. */
  box: Box | null;
}
export interface WishInput {
  title?: string;
  url?: string | null;
  price?: number | null;
  currency?: string;
  image_id?: string | null;
  is_group_gift?: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public body: Record<string, unknown>,
  ) {
    super(code);
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, String(body.error ?? "error"), body);
  return body as T;
}

/** Image URLs come from the API as relative paths. */
export const assetUrl = (u: string | null | undefined) => (u ? (u.startsWith("/") ? BASE + u : u) : null);

const item = (p: Promise<{ item: Wish }>) => p.then((r) => r.item);

export const api = {
  me: () => call<Me>("/me"),
  wishes: (owner?: number) => call<WishesResponse>(`/wishes${owner ? `?owner=${owner}` : ""}`),
  createWish: (b: WishInput) => item(call("/wishes", { method: "POST", body: b })),
  updateWish: (id: number, b: WishInput) => item(call(`/wishes/${id}`, { method: "PATCH", body: b })),
  deleteWish: (id: number) => call<void>(`/wishes/${id}`, { method: "DELETE" }),
  book: (id: number) => item(call(`/wishes/${id}/book`, { method: "POST" })),
  unbook: (id: number) => item(call(`/wishes/${id}/book`, { method: "DELETE" })),
  contribute: (id: number, amount: number) => item(call(`/wishes/${id}/contribute`, { method: "POST", body: { amount } })),
  withdraw: (id: number) => item(call(`/wishes/${id}/contribute`, { method: "DELETE" })),
  parseScreenshot: (image: string) => call<ScreenshotResult>("/parse/screenshot", { method: "POST", body: { image } }),
  parseLink: (url: string) => call<ParsedItem & { site_name: string }>("/parse/link", { method: "POST", body: { url } }),
  uploadImage: (image: string) => call<Photo>("/images", { method: "POST", body: { image } }),
};

const MESSAGES: Record<string, string> = {
  already_booked: "Этот подарок уже кто-то забронировал.",
  group_gift: "На этот подарок собирают вскладчину — можно внести свою часть.",
  not_group_gift: "Этот подарок не для складчины.",
  fully_funded: "Нужная сумма уже собрана 🎉",
  exceeds_remaining: "Столько не нужно — осталось меньше.",
  own_wish: "Свои подарки бронировать не нужно 🙂",
  wish_not_found: "Подарок не найден — возможно, его уже удалили.",
  owner_not_found: "Такой вишлист не найден.",
  rate_limited: "Слишком много попыток. Попробуйте чуть позже.",
  vision_not_configured: "Распознавание скриншотов пока не включено — заполните поля вручную.",
  vision_failed: "Не получилось распознать скриншот — заполните поля вручную.",
  bad_image: "Не получилось обработать изображение, попробуйте другое.",
  too_large: "Файл слишком большой.",
  group_gift_needs_price: "Для складчины укажите цену — это целевая сумма.",
};

export const errorText = (e: unknown) => (e instanceof ApiError ? (MESSAGES[e.code] ?? "Что-то пошло не так, попробуйте ещё раз.") : "Нет связи с сервером. Проверьте интернет.");
