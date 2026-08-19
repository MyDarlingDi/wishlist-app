import { Router } from "express";
import { getUser, upsertUser } from "../db.js";
import { bot } from "../bot.js";

const BOT_TOKEN = process.env.BOT_TOKEN;

async function refreshFromTelegram(tgId, fallback) {
  let bio = null;
  let birthdate = null;
  let photo_url = null;
  try {
    const chat = await bot.api.getChat(tgId);
    bio = chat.bio || null;
    if (chat.birthdate) {
      const b = chat.birthdate;
      birthdate = [b.day, b.month, b.year].filter(Boolean).join(".");
    }
    if (chat.photo?.big_file_id) {
      const file = await bot.api.getFile(chat.photo.big_file_id);
      photo_url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    }
  } catch {
    // приватность пользователя не даёт получить эти поля — используем то, что уже было
  }
  return upsertUser({
    tg_id: tgId,
    first_name: fallback.first_name || "",
    last_name: fallback.last_name || "",
    username: fallback.username || null,
    photo_url,
    bio,
    birthdate,
  });
}

const router = Router();

// Профиль текущего пользователя (для владельца — включая звёзды)
router.get("/me", async (req, res) => {
  const tgUser = req.tgUser;
  let user = await getUser(tgUser.id);
  if (!user) {
    // первый заход в Mini App без предварительного /start — синхронизируем на лету
    user = await refreshFromTelegram(tgUser.id, tgUser);
  }
  res.json({
    id: user.tg_id,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    photo_url: user.photo_url,
    bio: user.bio,
    birthdate: user.birthdate,
    stars_balance: user.stars_balance,
  });
});

// Публичный профиль владельца вишлиста (без звёзд)
router.get("/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  const user = await getUser(id);
  if (!user) return res.status(404).json({ error: "not_found" });
  res.json({
    id: user.tg_id,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    photo_url: user.photo_url,
    bio: user.bio,
    birthdate: user.birthdate,
  });
});

export default router;
