import { Router } from "express";
import {
  getUser,
  listItems,
  listBookingsByOwner,
  insertItem,
  getItem,
  updateItem,
  deleteItem,
  getBooking,
  insertBooking,
  deleteBooking,
} from "../db.js";
import { scrapeProduct } from "../scraper.js";
import { createStarsInvoiceLink } from "../bot.js";

const router = Router();

function fullName(u) {
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "Пользователь";
}

// Список подарков в вишлисте пользователя :ownerId
// Если смотрит владелец — бронирования скрыты полностью.
// Если смотрит гость — видно, занято ли, и забронировал ли он сам.
router.get("/wishlist/:ownerId", async (req, res) => {
  const ownerId = Number(req.params.ownerId);
  const viewerId = req.tgUser.id;
  const isOwner = ownerId === viewerId;

  const owner = await getUser(ownerId);
  if (!owner) return res.status(404).json({ error: "not_found" });

  const items = await listItems(ownerId);
  const bookings = isOwner ? [] : await listBookingsByOwner(ownerId);
  const bookingByItem = new Map(bookings.map((b) => [b.item_id, b]));

  const result = items.map((it) => {
    const base = {
      id: it.id,
      url: it.url,
      title: it.title,
      image_url: it.image_url,
      price: it.price,
      currency: it.currency,
      site_name: it.site_name,
    };
    if (isOwner) return base; // владелец никогда не видит статус брони
    const booking = bookingByItem.get(it.id);
    return {
      ...base,
      booked: Boolean(booking),
      booked_by_me: booking ? booking.booker_id === viewerId : false,
    };
  });

  res.json({
    is_owner: isOwner,
    owner: {
      id: owner.tg_id,
      first_name: owner.first_name,
      last_name: owner.last_name,
      photo_url: owner.photo_url,
      bio: owner.bio,
      birthdate: owner.birthdate,
    },
    items: result,
  });
});

// Добавить подарок по ссылке (только владелец)
router.post("/wishlist/items", async (req, res) => {
  const ownerId = req.tgUser.id;
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "invalid_url" });
  }
  try {
    const data = await scrapeProduct(url);
    const item = await insertItem(ownerId, { url, ...data });
    res.json(item);
  } catch (e) {
    res.status(422).json({ error: "scrape_failed", message: e.message });
  }
});

// Ручное редактирование карточки (если распознавание неточное)
router.patch("/wishlist/items/:id", async (req, res) => {
  const ownerId = req.tgUser.id;
  const id = Number(req.params.id);
  const item = await getItem(id);
  if (!item || item.owner_id !== ownerId) return res.status(404).json({ error: "not_found" });

  const updated = await updateItem(id, req.body || {});
  res.json(updated);
});

router.delete("/wishlist/items/:id", async (req, res) => {
  const ownerId = req.tgUser.id;
  const id = Number(req.params.id);
  const item = await getItem(id);
  if (!item || item.owner_id !== ownerId) return res.status(404).json({ error: "not_found" });
  await deleteItem(id);
  res.json({ ok: true });
});

// Забронировать подарок (гость; владелец не может бронировать свой же подарок)
router.post("/wishlist/items/:id/book", async (req, res) => {
  const viewerId = req.tgUser.id;
  const id = Number(req.params.id);
  const item = await getItem(id);
  if (!item) return res.status(404).json({ error: "not_found" });
  if (item.owner_id === viewerId) return res.status(403).json({ error: "cant_book_own_item" });

  const existing = await getBooking(id);
  if (existing) {
    if (existing.booker_id !== viewerId) return res.status(409).json({ error: "already_booked" });
    return res.json({ booked: true, booked_by_me: true });
  }

  const viewer = await getUser(viewerId);
  await insertBooking(id, viewerId, viewer ? fullName(viewer) : "Гость");
  res.json({ booked: true, booked_by_me: true });
});

// Отменить свою бронь
router.post("/wishlist/items/:id/unbook", async (req, res) => {
  const viewerId = req.tgUser.id;
  const id = Number(req.params.id);
  const existing = await getBooking(id);
  if (!existing || existing.booker_id !== viewerId) {
    return res.status(403).json({ error: "not_your_booking" });
  }
  await deleteBooking(id);
  res.json({ booked: false, booked_by_me: false });
});

// Подарить звёзды владельцу вишлиста — создаёт ссылку на оплату Telegram Stars
router.post("/wishlist/:ownerId/gift-stars", async (req, res) => {
  const viewerId = req.tgUser.id;
  const ownerId = Number(req.params.ownerId);
  const amount = Math.round(Number(req.body?.amount));
  if (!amount || amount < 1 || amount > 100000) {
    return res.status(400).json({ error: "invalid_amount" });
  }
  if (ownerId === viewerId) return res.status(403).json({ error: "cant_gift_self" });

  const viewer = await getUser(viewerId);
  const link = await createStarsInvoiceLink({
    ownerId,
    amount,
    fromName: viewer ? fullName(viewer) : null,
  });
  res.json({ invoice_link: link });
});

export default router;
