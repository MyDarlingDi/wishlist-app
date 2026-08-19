import { getInitData } from "./telegram.js";

// Если фронт и бэкенд задеплоены на РАЗНЫХ доменах (например webapp — на Vercel,
// server — на Railway), укажите полный адрес бэкенда в VITE_API_BASE_URL, например
// https://your-server.up.railway.app — тогда запросы пойдут на /api там.
// Если оставить пустым — запросы идут на текущий домен (подходит, когда всё
// раздаёт один и тот же сервер, как описано в README, вариант "всё на одном сервисе").
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `tma ${getInitData()}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Ошибка запроса (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

export const api = {
  me: () => request("/me"),
  publicUser: (id) => request(`/users/${id}`),
  wishlist: (ownerId) => request(`/wishlist/${ownerId}`),
  addItem: (url) => request("/wishlist/items", { method: "POST", body: JSON.stringify({ url }) }),
  updateItem: (id, patch) =>
    request(`/wishlist/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteItem: (id) => request(`/wishlist/items/${id}`, { method: "DELETE" }),
  bookItem: (id) => request(`/wishlist/items/${id}/book`, { method: "POST" }),
  unbookItem: (id) => request(`/wishlist/items/${id}/unbook`, { method: "POST" }),
  giftStars: (ownerId, amount) =>
    request(`/wishlist/${ownerId}/gift-stars`, { method: "POST", body: JSON.stringify({ amount }) }),
};
