import { useState } from "react";
import { openExternalLink, hapticImpact } from "../telegram.js";

function formatPrice(price, currency) {
  if (!price) return null;
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "₽";
  return `${Math.round(price).toLocaleString("ru-RU")} ${symbol}`;
}

export default function GiftCard({ item, isOwner, onBookToggle, onEdit, onDelete }) {
  const price = formatPrice(item.price, item.currency);
  const [imgFailed, setImgFailed] = useState(false);

  function openProduct() {
    hapticImpact("light");
    openExternalLink(item.url);
  }

  return (
    <div className="gift-card">
      <button className="gift-image-wrap" onClick={openProduct} aria-label={`Открыть товар: ${item.title}`}>
        {item.image_url && !imgFailed ? (
          <img src={item.image_url} alt={item.title} loading="lazy" onError={() => setImgFailed(true)} />
        ) : (
          <span className="gift-image-placeholder">🎁</span>
        )}
      </button>

      {!isOwner && item.booked && (
        <span className="ribbon-seal" title={item.booked_by_me ? "Забронировано вами" : "Уже забронировано"}>
          ✓
        </span>
      )}

      <div className="gift-body">
        <div className="gift-title" onClick={openProduct} role="button">
          {item.title || "Название не указано — нажмите ✎, чтобы заполнить"}
        </div>
        <div className="gift-site">{item.site_name}</div>
        {price && <div className="gift-price">{price}</div>}

        {isOwner ? (
          <div className="owner-item-actions">
            <button className="icon-btn" onClick={() => onEdit(item)} aria-label="Изменить">
              ✎
            </button>
            <button className="icon-btn" onClick={() => onDelete(item)} aria-label="Удалить">
              ✕
            </button>
          </div>
        ) : (
          <button
            className={
              "gift-book-btn " + (item.booked ? (item.booked_by_me ? "booked-by-me" : "taken") : "book")
            }
            disabled={item.booked && !item.booked_by_me}
            onClick={() => onBookToggle(item)}
          >
            {item.booked ? (item.booked_by_me ? "Вы забронировали" : "Занято") : "Забронировать"}
          </button>
        )}
      </div>
    </div>
  );
}
