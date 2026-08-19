import { useState } from "react";
import { api } from "../api.js";

export default function AddGiftModal({ onClose, onAdded }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const item = await api.addItem(url.trim());
      setPreview(item);
      onAdded(item);
      if (!item.needs_manual_edit) {
        setTimeout(onClose, 700);
      }
    } catch (err) {
      setError("Не получилось сохранить подарок, попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="modal-title">Добавить подарок</p>
        <p className="hint-text">
          Вставьте ссылку на товар с любого сайта — название, фото и цену найдём сами. Если что-то
          распознается неточно, карточку можно будет поправить.
        </p>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            className="input"
            placeholder="https://www.wildberries.ru/catalog/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
          {error && <p className="error-text">{error}</p>}
          {preview && (
            <div className="preview-card">
              {preview.image_url && <img src={preview.image_url} alt="" />}
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                  {preview.title || "Название не распозналось"}
                </div>
                {preview.needs_manual_edit ? (
                  <div className="hint-text">
                    Сайт не отдал данные о товаре (так бывает с Wildberries/Ozon). Подарок добавлен —
                    поправьте название, фото и цену вручную через значок ✎ на карточке.
                  </div>
                ) : (
                  <div className="hint-text">Добавлено ✓</div>
                )}
              </div>
            </div>
          )}
          <button className="btn btn-ribbon btn-block" disabled={loading || !url.trim()}>
            {loading ? "Ищем товар…" : "Добавить в вишлист"}
          </button>
          {preview && (
            <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>
              Готово
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
