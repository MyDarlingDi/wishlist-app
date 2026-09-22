# Вишлист-бот @wish_and_gift_bot

Telegram-бот + Mini App для вишлистов: скриншот товара → название, цена и фото подставляются сами, друзья тайно бронируют подарки и скидываются вскладчину, а именинник ничего не видит.

```
wishlist-bot/
├── server/                 Node.js + TypeScript (Express, grammY, Drizzle ORM, PostgreSQL)  → Render
│   ├── drizzle/            SQL-миграции (применяются при каждом старте)
│   ├── src/
│   │   ├── index.ts        запуск: БД → бот → API
│   │   ├── app.ts          Express: CORS, авторизация, обработка ошибок, вебхук
│   │   ├── config.ts       переменные окружения (с проверкой)
│   │   ├── db/schema.ts    схема БД
│   │   ├── auth/           проверка initData (HMAC-SHA256) + middleware
│   │   ├── routes/api.ts   все эндпоинты /api/*
│   │   ├── services/       wishes (логика + приватность), images, scrape, vision, notify, ssrf
│   │   ├── bot/bot.ts      команды бота
│   │   └── scripts/setup-bot.ts   разовая настройка вебхука и меню
│   ├── test/               68 тестов (npm test)
│   └── dev/stub-server.ts  локальная демо-версия API без Telegram и без ключа Anthropic
├── webapp/                    React + Vite (Mini App)                                          → Vercel
└── render.yaml             blueprint для Render
```

## 1. База данных

Хранится в PostgreSQL. Схема описана в [server/src/db/schema.ts](server/src/db/schema.ts), SQL — в `server/drizzle/`.

| Таблица | Поля (главное) | Зачем |
|---|---|---|
| `users` | `id` (= Telegram id), `username`, `first_name`, `last_name`, `avatar_url` | Создаётся/обновляется при первом входе через бота или Mini App |
| `wishlists` | `id`, `owner_id → users`, `title`, `is_default`, `notify_chat_id` | У пользователя может быть несколько списков (приложение пока показывает основной). `notify_chat_id` — групповой чат друзей-организаторов |
| `wishes` | `id`, `wishlist_id`, `title`, `url`, `price`, `currency`, `site_name`, `image_id`, `is_group_gift` | Желания. `is_group_gift` = складчина (цена = целевая сумма) |
| `wish_images` | `id` (uuid), `data` (bytea), `mime`, `bg` | Фото товаров, уже приведённые к единому виду. `bg` — цвет краёв фото, им закрашивается рамка |
| `bookings` | `id`, `wish_id` (**unique**), `user_id` | Тайная бронь: не больше одной на подарок |
| `contributions` | `id`, `wish_id`, `user_id`, `amount` | Доли в складчине |

**Приватность.** Владелец не получает данных о брони и взносах ни одним эндпоинтом: маскирование сделано в одном месте (`toViews` в `services/wishes.ts`) — для владельца полей `booked`, `collected` и т. п. просто нет в ответе. Это проверено тестом.

## 2. Проверка `initData`

[server/src/auth/initData.ts](server/src/auth/initData.ts). Фронтенд шлёт `Authorization: tma <initData>`, сервер:

1. разбирает строку, отделяет `hash`;
2. собирает `data_check_string` — все поля кроме `hash`, вида `key=value`, по алфавиту, через `\n`;
3. считает `secret = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)`, затем `HMAC_SHA256(secret, data_check_string)` и сравнивает с `hash` через `timingSafeEqual`;
4. отвергает данные старше 24 часов (`INITDATA_MAX_AGE_SEC`).

После успеха пользователь создаётся/обновляется в БД (`upsertUser`). Тесты: чужой токен, подмена id, нет hash, просроченные данные.

## 3. Бот

[server/src/bot/bot.ts](server/src/bot/bot.ts)

| Команда | Что делает |
|---|---|
| `/start` | Приветствие + кнопка `web_app` «🎁 Мой вишлист» |
| `/start wishlist_<id>` | Кнопка «Открыть вишлист» именно этого человека (понимает и старые ссылки `u<id>`) |
| `/share` | Ссылка на свой вишлист для друзей |
| `/watch [wishlist_<id>]` | В **групповом** чате друзей: сюда приходят уведомления «X забронировал Y» / «Складчина: +1000 ₽». Откажется, если именинник состоит в этом чате |
| `/unwatch` | Отключить уведомления |

Уведомления уходят только в чат организаторов, никогда владельцу, и обычным текстом (без разметки).

## 4. API

Все запросы: `Authorization: tma <initData>`. Ошибки: `{ "error": "<код>" }`.

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/me` | Профиль, id основного списка, `share_link` |
| GET | `/api/wishes?owner=<id\|wishlist_id>` | Список подарков. Владелец — без брони и взносов, гость — с ними |
| POST | `/api/wishes` | `{title, url, price, currency, image_id, is_group_gift}` |
| PATCH / DELETE | `/api/wishes/:id` | Только владелец (чужой id → 404) |
| POST / DELETE | `/api/wishes/:id/book` | Забронировать / снять бронь (409 `already_booked`) |
| POST / DELETE | `/api/wishes/:id/contribute` | Внести `{amount}` / забрать свой взнос. Сумма не может превысить остаток (проверка под блокировкой строки) |
| POST | `/api/parse/screenshot` | `{image: dataURL}` → название, цена и подсказка-рамка, где на скриншоте товар (Claude или OpenAI vision). Само фото не сохраняет — рамку подгоняет и загружает уже фронтенд, см. ниже |
| POST | `/api/parse/link` | `{url}` → название, цена, фото по OpenGraph / JSON-LD |
| POST | `/api/images` | Загрузка своего фото |
| GET | `/api/images/:id` | Фото (публично, id — случайный uuid) |
| GET | `/health` | Проверка для Render |

**Про парсинг ссылок честно:** Wildberries / Ozon / Яндекс Маркет часто отдают серверам страницу «проверка на робота», и тогда по ссылке ничего не достать. Поэтому основной путь — скриншот; ссылка — дополнительный.

**Рамка для фото выбирается вручную.** ИИ только подсказывает, где на скриншоте товар — обрезает и сохраняет фото сам человек, в квадратном инструменте с перетаскиванием и зумом (`webapp/src/CropSheet.tsx`), как при выборе фото профиля в Instagram/Telegram. Так фотография остаётся точной даже когда автоматика ошибается (баннеры, коллажи, несколько товаров на одном скриншоте).

**Рамка для фото.** Каждое фото приводится к JPEG ≤ 1000 px; сервер измеряет цвет его краёв (медиана) и сохраняет как `image_bg`. Во фронтенде фото лежит в квадратной рамке с `object-fit: contain` на этом цвете: товар на белом фоне «сливается» с рамкой, любая другая фотография выглядит как картина в паспарту. Ничего не обрезается и не растягивается.

## 5. Развёртывание

### Шаг 1. Перевыпустить токен бота
Токен попал в переписку, поэтому считайте его скомпрометированным. @BotFather → `/mybots` → @wish_and_gift_bot → API Token → **Revoke current token**. Новый токен — только в переменные окружения Render (в файлы и чаты не вставлять).

### Шаг 2. База данных
Создайте бесплатную PostgreSQL на [neon.tech](https://neon.tech) (или Supabase) и скопируйте строку подключения `postgres://…?sslmode=require`.
(Бесплатная база Render удаляется через 30 дней, поэтому лучше Neon.)

### Шаг 3. Код на GitHub
```bash
cd ~/wishlist-bot
git add . && git commit -m "Вишлист v2" 
# создайте пустой репозиторий на github.com и:
git remote add origin git@github.com:<вы>/wishlist-bot.git && git push -u origin main
```

### Шаг 4. Сервер на Render
New → **Blueprint** → выберите репозиторий (`render.yaml` подхватится). Заполните переменные:

| Переменная | Значение |
|---|---|
| `BOT_TOKEN` | новый токен из шага 1 |
| `DATABASE_URL` | строка из шага 2 |
| `WEBAPP_URL` | адрес Mini App на Vercel, например `https://wishlist-app-opal.vercel.app` |
| `ANTHROPIC_API_KEY` или `OPENAI_API_KEY` | ключ для распознавания скриншотов (хватит любого одного). Anthropic: console.anthropic.com, ≈ 1–2 цента за скриншот; OpenAI: platform.openai.com, модель `gpt-5.6-luna`, дешевле. Другую модель можно задать через `VISION_MODEL` |
| `WEBHOOK_SECRET` | генерируется автоматически |

После деплоя `https://<имя>.onrender.com/health` должен ответить `{"ok":true}`.

> Бесплатный тариф Render «засыпает» через 15 минут без запросов — первый запрос после паузы идёт ~30–50 секунд. Для постоянной работы нужен платный тариф.

### Шаг 5. Mini App на Vercel
Проще всего оставить существующий проект `wishlist-app` (адрес и кнопка меню не изменятся): Settings → Git → подключить новый репозиторий, **Root Directory = `webapp`**, Environment Variables → `VITE_API_URL=https://<имя>.onrender.com` → Redeploy.

### Шаг 6. Переключение бота на новый сервер
Ничего делать не нужно: в `render.yaml` включено `AUTO_SETUP_BOT=1`, и при каждом запуске сервер сам направляет вебхук Telegram на себя, регистрирует команды и кнопку меню «Мой вишлист». **С этого момента старый сервер бота больше не получает сообщений.**
(Запасной вариант вручную: `BOT_TOKEN=… WEBHOOK_SECRET=… WEBAPP_URL=… SERVER_URL=https://<имя>.onrender.com npm run setup:bot`.)

### Шаг 7 (по желанию). Ссылки, открывающие приложение сразу
@BotFather → `/newapp` → выберите бота → короткое имя (например `wishlist`). Добавьте `APP_SHORT_NAME=wishlist` в Render — и «Отправить другу» будет давать `t.me/wish_and_gift_bot/wishlist?startapp=wishlist_<id>`. Без этого ссылка `t.me/wish_and_gift_bot?start=wishlist_<id>` тоже работает: открывает чат, а `/start` показывает кнопку.

## 6. Локальная разработка

```bash
# терминал 1 — демо-API (встроенный Postgres, поддельное «распознавание», примеры фото)
cd server && npm i && npx tsx dev/stub-server.ts
# терминал 2 — фронтенд
cd webapp && npm i && VITE_API_URL=http://localhost:3000 npm run dev
# открыть http://localhost:5173 (владелец) или http://localhost:5173/?devuser=2&wl=1 (гость)
```
Тесты: `cd server && npm test`. Настоящий Postgres для тестов: `TEST_DATABASE_URL=postgres://… npm test`.

**Осторожно:** `BOT_POLLING=1` удаляет вебхук бота. Для локальных опытов с ботом заведите отдельного тестового бота в BotFather.

## Что не перенесено из старой версии
Кнопка «Подарить звёзды» (Telegram Stars) — старый бэкенд утрачен, а логика выплат из него неизвестна; Stars, отправленные боту, оседают на балансе бота, а не у получателя подарка. Если функция нужна, её стоит проектировать отдельно.
