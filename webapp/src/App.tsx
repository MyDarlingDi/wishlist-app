import { useCallback, useEffect, useState } from "react";
import { api, errorText, type Me, type Wish, type WishesResponse } from "./api";
import { ContributeSheet } from "./ContributeSheet";
import { ProfileCard, WishCard } from "./components";
import { WishSheet } from "./WishSheet";
import { confirmDialog, haptic, inTelegram, openLink, openTelegramLink, requestedOwner, showAlert } from "./telegram";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<WishesResponse | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [editing, setEditing] = useState<Wish | "new" | null>(null);
  const [contributing, setContributing] = useState<Wish | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
      setData(await api.wishes(requestedOwner() ?? m.id));
    } catch (e) {
      const status = (e as { status?: number }).status;
      setFatal(
        status === 401 || (!inTelegram() && status === undefined)
          ? "Откройте это приложение через Telegram-бота, чтобы мы узнали ваш профиль."
          : status === 404
            ? errorText(e)
            : "Не удалось загрузить вишлист. Закройте и снова откройте приложение.",
      );
    }
  }, []);
  useEffect(() => void load(), [load]);

  const replace = (w: Wish) => setData((d) => d && { ...d, items: d.items.map((x) => (x.id === w.id ? w : x)) });

  async function act(fn: () => Promise<Wish>) {
    try {
      replace(await fn());
    } catch (e) {
      showAlert(errorText(e));
      void load(); // someone may have booked it a second ago — show the fresh state
    }
  }

  const onBook = async (w: Wish) => {
    haptic("medium");
    if (w.booked_by_me && !(await confirmDialog("Снять вашу бронь с этого подарка?"))) return;
    await act(() => (w.booked_by_me ? api.unbook(w.id) : api.book(w.id)));
  };

  const onDelete = async (w: Wish) => {
    if (!(await confirmDialog(`Удалить «${w.title}» из вишлиста?`))) return;
    try {
      await api.deleteWish(w.id);
      setData((d) => d && { ...d, items: d.items.filter((x) => x.id !== w.id) });
    } catch (e) {
      showAlert(errorText(e));
    }
  };

  const onSaved = (w: Wish, isNew: boolean) =>
    setData((d) => d && { ...d, items: isNew ? [w, ...d.items] : d.items.map((x) => (x.id === w.id ? w : x)) });

  if (fatal)
    return (
      <div className="screen">
        <div className="empty-state">
          <span className="emoji">🔒</span>
          <p>{fatal}</p>
        </div>
      </div>
    );
  if (!data || !me)
    return (
      <div className="screen">
        <div className="loading-wrap">Загружаем вишлист…</div>
      </div>
    );

  const isOwner = data.is_owner;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(me.share_link);
      showAlert("Ссылка скопирована — отправьте её друзьям.");
    } catch {
      showAlert(me.share_link);
    }
  };

  return (
    <div className="screen">
      <ProfileCard owner={data.owner} isOwner={isOwner} />

      {isOwner && (
        <div className="share-bar">
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(me.share_link)}&text=${encodeURIComponent("Мой вишлист 🎁")}`)}>
            Отправить другу
          </button>
          <button className="btn btn-outline" onClick={copy}>
            Скопировать ссылку
          </button>
        </div>
      )}
      {!isOwner && <p className="hint-text center">Бронь и взносы видите только вы и другие гости — именинник ничего не узнает 🤫</p>}

      {data.items.length === 0 ? (
        <div className="empty-state">
          <span className="emoji">🎁</span>
          <p>{isOwner ? "Пока пусто. Нажмите «+» и загрузите скриншот товара." : "Здесь пока нет подарков."}</p>
        </div>
      ) : (
        <div className="grid">
          {data.items.map((w) => (
            <WishCard
              key={w.id}
              wish={w}
              isOwner={isOwner}
              onOpen={(x) => x.url && (haptic(), openLink(x.url))}
              onBook={onBook}
              onContribute={setContributing}
              onEdit={setEditing}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {isOwner && (
        <button className="fab" onClick={() => setEditing("new")} aria-label="Добавить подарок">
          +
        </button>
      )}
      {editing && <WishSheet wish={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {contributing && <ContributeSheet wish={contributing} onClose={() => setContributing(null)} onChanged={replace} />}
    </div>
  );
}
