import { useRef, useState } from "react";
import { api, errorText, type Photo, type Wish } from "./api";
import { Frame } from "./components";
import { fileToJpegDataUrl, isHttpUrl } from "./image";
import { showAlert } from "./telegram";

type Busy = null | "shot" | "link" | "photo" | "save";
type Picture = { id: string | null; url: string | null; bg: string | null };

const asPicture = (p: Photo): Picture => ({ id: p.image_id, url: p.image_url, bg: p.image_bg });

/**
 * Add / edit a wish. Flow: screenshot of the product page → title, price and product photo are
 * recognised → the person is asked for the link → save. Everything stays editable by hand,
 * because recognition can be wrong or unavailable.
 */
export function WishSheet({ wish, onClose, onSaved }: { wish?: Wish; onClose: () => void; onSaved: (w: Wish, isNew: boolean) => void }) {
  const [title, setTitle] = useState(wish?.title ?? "");
  const [price, setPrice] = useState(wish?.price ? String(wish.price) : "");
  const [currency, setCurrency] = useState(wish?.currency ?? "RUB");
  const [url, setUrl] = useState(wish?.url ?? "");
  const [group, setGroup] = useState(wish?.is_group_gift ?? false);
  const [picture, setPicture] = useState<Picture>({ id: null, url: wish?.image_url ?? null, bg: wish?.image_bg ?? null });
  const [pictureChanged, setPictureChanged] = useState(false);
  const [wholeShot, setWholeShot] = useState<Picture | null>(null);
  const [cropPicture, setCropPicture] = useState<Picture | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recognised, setRecognised] = useState(false);
  const shotInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const urlOk = isHttpUrl(url);
  const priceNum = price ? Number(price) : null;
  const canSave = !!title.trim() && urlOk && !busy && (!group || !!priceNum);

  function usePicture(p: Picture) {
    setPicture(p);
    setPictureChanged(true);
  }

  async function onScreenshot(file: File | undefined) {
    if (!file) return;
    setBusy("shot");
    setError(null);
    setHint(null);
    try {
      const r = await api.parseScreenshot(await fileToJpegDataUrl(file));
      if (r.title) setTitle(r.title);
      if (r.price) setPrice(String(r.price));
      setCurrency(r.currency);
      const main = asPicture(r);
      usePicture(main);
      setCropPicture(r.cropped ? main : null);
      setWholeShot(r.screenshot ? asPicture(r.screenshot) : null);
      setRecognised(true);
      setHint(
        r.title || r.price
          ? "Проверьте название и цену, затем вставьте ссылку на товар."
          : "Не удалось найти название и цену — впишите их вручную и вставьте ссылку.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function onOtherPhoto(file: File | undefined) {
    if (!file) return;
    setBusy("photo");
    setError(null);
    try {
      const r = await api.uploadImage(await fileToJpegDataUrl(file, 1600, 0.85));
      usePicture(asPicture(r));
      setWholeShot(null);
      setCropPicture(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  /** Fills only what is still empty, so it never overwrites what the screenshot already found. */
  async function fillFromLink() {
    if (!urlOk) return;
    setBusy("link");
    setError(null);
    try {
      const r = await api.parseLink(url.trim());
      if (!title.trim() && r.title) setTitle(r.title);
      if (!price && r.price) setPrice(String(r.price));
      if (!picture.url && r.image_url) usePicture(asPicture(r));
      setHint(r.title || r.price || r.image_url ? "Данные подтянулись по ссылке — проверьте их." : "Магазин не отдаёт данные по ссылке — загрузите скриншот страницы товара.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!canSave) return;
    setBusy("save");
    setError(null);
    try {
      const body = {
        title: title.trim(),
        url: url.trim(),
        price: priceNum,
        currency,
        is_group_gift: group,
        ...(pictureChanged ? { image_id: picture.id } : {}),
      };
      const saved = wish ? await api.updateWish(wish.id, body) : await api.createWish(body);
      onSaved(saved, !wish);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="modal-title">{wish ? "Изменить подарок" : "Добавить подарок"}</p>

        {!wish && !recognised && (
          <>
            <button className="dropzone" onClick={() => shotInput.current?.click()} disabled={busy === "shot"}>
              <span className="dropzone-icon">{busy === "shot" ? "⏳" : "📸"}</span>
              <span className="dropzone-title">{busy === "shot" ? "Распознаём скриншот…" : "Загрузить скриншот товара"}</span>
              <span className="hint-text">Название, цену и фото найдём сами</span>
            </button>
            <input ref={shotInput} type="file" accept="image/*" hidden onChange={(e) => onScreenshot(e.target.files?.[0])} />
          </>
        )}

        <div className="preview-card">
          <div className="preview-photo">
            <Frame src={picture.url} bg={picture.bg} />
            <button type="button" className="link-btn" disabled={busy === "photo"} onClick={() => photoInput.current?.click()}>
              {busy === "photo" ? "…" : picture.url ? "Другое фото" : "Добавить фото"}
            </button>
            <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => onOtherPhoto(e.target.files?.[0])} />
          </div>
          <div className="preview-fields">
            <input className="input" placeholder="Название подарка" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            <input className="input" placeholder="Цена, ₽ (необязательно)" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} />
          </div>
        </div>

        {wholeShot && cropPicture && (
          <div className="segmented" role="group" aria-label="Что показывать в рамке">
            <button className={picture.id === cropPicture.id ? "on" : ""} onClick={() => usePicture(cropPicture)}>
              Только товар
            </button>
            <button className={picture.id === wholeShot.id ? "on" : ""} onClick={() => usePicture(wholeShot)}>
              Весь скриншот
            </button>
          </div>
        )}

        <div>
          <input
            className={`input ${recognised && !url ? "input-attn" : ""}`}
            placeholder="Ссылка на товар (https://…)"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text").trim();
              if (isHttpUrl(pasted) && !title.trim()) setTimeout(fillFromLink, 0);
            }}
            autoFocus={!!wish}
          />
          <p className="hint-text mt">
            {url && !urlOk ? "Ссылка должна начинаться с https://" : "Друзья откроют её, чтобы купить именно этот товар."}
          </p>
          {urlOk && (
            <button type="button" className="link-btn" disabled={busy === "link"} onClick={fillFromLink}>
              {busy === "link" ? "Читаем страницу…" : "✨ Подтянуть данные по ссылке"}
            </button>
          )}
        </div>

        <label className="check">
          <input type="checkbox" checked={group} onChange={(e) => (e.target.checked && !priceNum ? showAlert("Сначала укажите цену — это целевая сумма складчины.") : setGroup(e.target.checked))} />
          <span>Можно скинуться вскладчину</span>
        </label>

        {hint && <p className="hint-text">{hint}</p>}
        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-ribbon btn-block" disabled={!canSave} onClick={save}>
          {busy === "save" ? "Сохраняем…" : wish ? "Сохранить" : "Добавить в вишлист"}
        </button>
      </div>
    </div>
  );
}
