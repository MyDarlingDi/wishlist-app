import { useState, type CSSProperties } from "react";
import { assetUrl, type Person, type Wish } from "./api";
import { formatPrice } from "./image";
import { CheckIcon, PencilIcon, PeopleIcon, TrashIcon } from "./Icons";

/**
 * Product photo in a fixed square frame. The frame is painted with the picture's own edge colour
 * (measured on the server), so a product shot on a plain background melts into the frame,
 * and any other photo sits in it like a matted print — nothing is ever cropped or stretched.
 */
export function Frame({ src, bg, className = "" }: { src: string | null; bg?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const url = assetUrl(src);
  return (
    <div className={`frame ${className}`} style={bg ? ({ "--frame-bg": bg } as CSSProperties) : undefined}>
      {url && !failed ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span className="frame-empty">🎁</span>}
    </div>
  );
}

export function ProfileCard({ owner, isOwner }: { owner: Person; isOwner: boolean }) {
  const name = [owner.first_name, owner.last_name].filter(Boolean).join(" ") || "Без имени";
  return (
    <div className="profile-card">
      {owner.photo_url ? <img className="profile-avatar" src={owner.photo_url} alt="" /> : <div className="profile-avatar">{name.charAt(0).toUpperCase()}</div>}
      <div className="profile-info">
        <p className="profile-name">{name}</p>
        <p className="profile-meta">{isOwner ? "Ваш вишлист" : "Вишлист"}</p>
      </div>
    </div>
  );
}

interface CardProps {
  wish: Wish;
  isOwner: boolean;
  onOpen: (w: Wish) => void;
  onBook: (w: Wish) => void;
  onContribute: (w: Wish) => void;
  onEdit: (w: Wish) => void;
  onDelete: (w: Wish) => void;
}

export function WishCard({ wish, isOwner, onOpen, onBook, onContribute, onEdit, onDelete }: CardProps) {
  const price = formatPrice(wish.price, wish.currency);
  const target = wish.price ?? 0;
  const collected = wish.collected ?? 0;
  const pct = target ? Math.min(100, Math.round((collected / target) * 100)) : 0;
  const funded = wish.is_group_gift && !!target && collected >= target;

  return (
    <div className="gift-card">
      <button className="gift-image-wrap" onClick={() => onOpen(wish)} aria-label={`Открыть товар: ${wish.title}`} disabled={!wish.url}>
        <Frame src={wish.image_url} bg={wish.image_bg} />
      </button>
      {!isOwner && (wish.booked || funded) && (
        <span className="ribbon-seal" title={wish.booked_by_me ? "Забронировано вами" : "Уже занято"}>
          <CheckIcon size={13} />
        </span>
      )}
      {isOwner && wish.is_group_gift && (
        <span className="chip-group">
          <PeopleIcon /> вскладчину
        </span>
      )}

      <div className="gift-body">
        <div className="gift-title" onClick={() => onOpen(wish)} role="button">
          {wish.title}
        </div>
        {wish.site_name && <div className="gift-site">{wish.site_name}</div>}
        {price && <div className="gift-price">{price}</div>}

        {!isOwner && wish.is_group_gift && (
          <>
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="progress-caption">
              {formatPrice(collected, wish.currency) ?? "0 ₽"} из {price}
              {wish.my_contribution ? ` · вы: ${formatPrice(wish.my_contribution, wish.currency)}` : ""}
            </div>
            <button className={`gift-book-btn ${funded && !wish.my_contribution ? "taken" : "book"}`} disabled={funded && !wish.my_contribution} onClick={() => onContribute(wish)}>
              {funded ? (wish.my_contribution ? "Изменить взнос" : "Собрано 🎉") : wish.my_contribution ? "Изменить / добавить" : "Скинуться"}
            </button>
          </>
        )}

        {!isOwner && !wish.is_group_gift && (
          <button
            className={`gift-book-btn ${wish.booked ? (wish.booked_by_me ? "booked-by-me" : "taken") : "book"}`}
            disabled={!!wish.booked && !wish.booked_by_me}
            onClick={() => onBook(wish)}
          >
            {wish.booked ? (wish.booked_by_me ? "Вы забронировали" : "Занято") : "Забронировать"}
          </button>
        )}

        {isOwner && (
          <div className="owner-item-actions">
            <button className="icon-btn" onClick={() => onEdit(wish)} aria-label="Изменить">
              <PencilIcon />
            </button>
            <button className="icon-btn danger" onClick={() => onDelete(wish)} aria-label="Удалить">
              <TrashIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
