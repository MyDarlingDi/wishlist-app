import { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import { getStartParam, getTelegramUser, buildShareLink, showConfirm, hapticImpact } from "./telegram.js";
import ProfileHeader from "./components/ProfileHeader.jsx";
import WishlistGrid from "./components/WishlistGrid.jsx";
import ShareBar from "./components/ShareBar.jsx";
import AddGiftModal from "./components/AddGiftModal.jsx";
import GiftStarsModal from "./components/GiftStarsModal.jsx";

export default function App() {
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null); // { is_owner, owner, items }
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showGiftStars, setShowGiftStars] = useState(false);

  const startParam = getStartParam();
  const ownerId = startParam?.startsWith("u") ? Number(startParam.slice(1)) : null;

  const load = useCallback(async () => {
    try {
      const meRes = await api.me();
      setMe(meRes);
      const targetOwnerId = ownerId || meRes.id;
      const wl = await api.wishlist(targetOwnerId);
      setData(wl);
    } catch (e) {
      setError(
        !getTelegramUser()
          ? "Откройте это приложение через Telegram-бота, чтобы мы могли определить ваш профиль."
          : "Не удалось загрузить вишлист. Попробуйте закрыть и снова открыть приложение."
      );
    }
  }, [ownerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleBookToggle(item) {
    hapticImpact("medium");
    try {
      if (item.booked_by_me) {
        await api.unbookItem(item.id);
      } else {
        await api.bookItem(item.id);
      }
      const wl = await api.wishlist(data.owner.id);
      setData(wl);
    } catch (e) {
      if (e.body?.error === "already_booked") {
        const wl = await api.wishlist(data.owner.id);
        setData(wl);
      }
    }
  }

  async function handleDelete(item) {
    const ok = await showConfirm(`Удалить «${item.title}» из вишлиста?`);
    if (!ok) return;
    await api.deleteItem(item.id);
    const wl = await api.wishlist(data.owner.id);
    setData(wl);
  }

  async function handleEdit(item) {
    const title = window.prompt("Название", item.title) ?? item.title;
    const priceStr = window.prompt("Цена (число)", item.price ?? "") ?? item.price;
    const price = priceStr ? Number(priceStr) : item.price;
    await api.updateItem(item.id, { title, price });
    const wl = await api.wishlist(data.owner.id);
    setData(wl);
  }

  function handleAdded() {
    api.wishlist(data.owner.id).then(setData);
  }

  if (error) {
    return (
      <div className="screen">
        <div className="empty-state">
          <span className="emoji">🔒</span>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data || !me) {
    return (
      <div className="screen">
        <div className="loading-wrap">Загружаем вишлист…</div>
      </div>
    );
  }

  const isOwner = data.is_owner;

  return (
    <div className="screen">
      <ProfileHeader owner={data.owner} starsBalance={isOwner ? me.stars_balance : null} isOwner={isOwner} />

      {isOwner && <ShareBar link={buildShareLink(me.id)} />}

      {!isOwner && (
        <button className="btn btn-ribbon btn-block" onClick={() => setShowGiftStars(true)}>
          🌟 Подарить звёзды
        </button>
      )}

      <WishlistGrid
        items={data.items}
        isOwner={isOwner}
        onBookToggle={handleBookToggle}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      {isOwner && (
        <button className="fab" onClick={() => setShowAdd(true)} aria-label="Добавить подарок">
          +
        </button>
      )}

      {showAdd && <AddGiftModal onClose={() => setShowAdd(false)} onAdded={handleAdded} />}
      {showGiftStars && <GiftStarsModal ownerId={data.owner.id} onClose={() => setShowGiftStars(false)} />}
    </div>
  );
}
