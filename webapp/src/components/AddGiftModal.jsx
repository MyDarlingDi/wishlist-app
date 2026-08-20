import { useState, useRef } from "react";
import { api } from "../api.js";
import { compressImageFile } from "../imageUtils.js";

export default function AddGiftModal({ onClose, onAdded }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [image, setImage] = useState(null); // data-URI или http(s)-URL
  const [recognizing, setRecognizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [hint, setHint] = useState(null);
  const fileInputRef = useRef(null);

  async function handleRecognize() {
    if (!url.trim()) return;
    setRecognizing(true);
    setError(null);
    setHint(null);
    try {
      const data = await api.scrapePreview(url.trim());
      if (data.title) setTitle((prev) => prev || data.title);
      if (data.price) setPrice((prev) => prev || String(Math.round(data.price)));
      if (data.image_url) setImage((prev) => prev || data.image_url);
      if (!data.title && !data.image_url) {
        setHint("Автоматически распознать не получилось — впишите название и приложите скриншот вручную.");
      }
    } catch {
      setHint("Автоматически распознать не получилось — впишите название и приложите скриншот вручную.");
    } finally {
      setRecognizing(false);
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUri = await compressImageFile(file);
      setImage(dataUri);
    } catch {
      setError("Не получилось обработать изображение, попробуйте другое фото.");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url.trim() || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const item = await api.addItem({
        url: url.trim(),
        title: title.trim(),
        price: price ? Number(price) : null,
        currency: "RUB",
        image_url: image,
      });
      onAdded(item);
      onClose();
    } catch {
      setError("Не получилось сохранить подарок, попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="modal-title">Добавить подарок</p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <input
              className="input"
              placeholder="Ссылка на товар (https://...)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
            <p className="hint-text" style={{ marginTop: 6 }}>
              По ссылке карточка будет открывать товар. Название, цену и фото можно получить
              автоматически или заполнить/прикрепить самим — например, скриншотом страницы товара.
            </p>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-block"
            disabled={!url.trim() || recognizing}
            onClick={handleRecognize}
          >
            {recognizing ? "Распознаём…" : "✨ Попробовать распознать автоматически"}
          </button>

          {hint && <p className="hint-text">{hint}</p>}

          <div className="preview-card" style={{ alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
              {image ? (
                <img src={image} alt="" style={{ width: 64, height: 64 }} />
              ) : (
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 10,
                    background: "var(--tg-bg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                  }}
                >
                  🎁
                </div>
              )}
              <button
                type="button"
                className="icon-btn"
                style={{ width: "auto", padding: "0 8px", fontSize: 11 }}
                onClick={() => fileInputRef.current?.click()}
              >
                {image ? "Заменить фото" : "Прикрепить скриншот"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
            </div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                className="input"
                placeholder="Название подарка"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <input
                className="input"
                placeholder="Цена, ₽ (необязательно)"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}

          <button className="btn btn-ribbon btn-block" disabled={saving || !url.trim() || !title.trim()}>
            {saving ? "Сохраняем…" : "Добавить в вишлист"}
          </button>
        </form>
      </div>
    </div>
  );
}
