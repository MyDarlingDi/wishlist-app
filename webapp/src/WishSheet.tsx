import { Fragment, useRef, useState } from "react";
import { api, errorText, type Box, type Photo, type Wish } from "./api";
import { Frame } from "./components";
import { CropSheet } from "./CropSheet";
import { CameraIcon } from "./Icons";
import { fileToJpegDataUrl, isHttpUrl } from "./image";
import { showAlert } from "./telegram";

type Busy = null | "shot" | "link" | "photo" | "save";
type Picture = { id: string | null; url: string | null; bg: string | null };

const asPicture = (p: Photo): Picture => ({ id: p.image_id, url: p.image_url, bg: p.image_bg });

/**
 * Add / edit a wish. Flow: screenshot of the product page → title and price are recognised and
 * the person positions the product photo in a square crop tool (starting from where the model
 * thinks it is) → the link is asked for → save. Everything stays editable by hand, because
 * recognition can be wrong, incomplete, or (without an API key) unavailable.
 */
export function WishSheet({ wish, onClose, onSaved }: { wish?: Wish; onClose: () => void; onSaved: (w: Wish, isNew: boolean) => void }) {
  const [title, setTitle] = useState(wish?.title ?? "");
  const [price, setPrice] = useState(wish?.price ? String(wish.price) : "");
  const [currency, setCurrency] = useState(wish?.currency ?? "RUB");
  const [url, setUrl] = useState(wish?.url ?? "");
  const [group, setGroup] = useState(wish?.is_group_gift ?? false);
  const [picture, setPicture] = useState<Picture>({ id: null, url: wish?.image_url ?? null, bg: wish?.image_bg ?? null });
  const [pictureChanged, setPictureChanged] = useState(false);
  // The locally-picked screenshot/photo, kept in memory so the crop tool can be reopened without
  // re-uploading anything. There's deliberately no such source for an existing wish's saved photo
  // (it lives on the server, on a different origin) — pick a new photo to get the crop tool back.
  const [rawSource, setRawSource] = useState<string | null>(null);
  const [seedBox, setSeedBox] = useState<Box | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
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
    let dataUrl: string;
    try {
      dataUrl = await fileToJpegDataUrl(file);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
      return;
    }
    setRawSource(dataUrl);
    setRecognised(true);
    let box: Box | null = null;
    try {
      const r = await api.parseScreenshot(dataUrl);
      if (r.title) setTitle(r.title);
      if (r.price) setPrice(String(r.price));
      setCurrency(r.currency);
      box = r.box;
      setHint(
        r.title || r.price
          ? "Проверьте название и цену, подстройте фото и вставьте ссылку."
          : "Не удалось найти название и цену — впишите их вручную и вставьте ссылку.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
    setSeedBox(box);
    setCropOpen(true);
  }

  async function onOtherPhoto(file: File | undefined) {
    if (!file) return;
    setBusy("photo");
    setError(null);
    try {
      const dataUrl = await fileToJpegDataUrl(file);
      setRawSource(dataUrl);
      setSeedBox(null);
      setCropOpen(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function onCropConfirm(dataUrl: string, box: Box) {
    setCropOpen(false);
    setSeedBox(box);
    setBusy("photo");
    setError(null);
    try {
      usePicture(asPicture(await api.uploadImage(dataUrl)));
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
    <Fragment>
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="modal-title">{wish ? "Изменить подарок" : "Добавить подарок"}</p>

        {!wish && !recognised && (
          <>
            <button className="dropzone" onClick={() => shotInput.current?.click()} disabled={busy === "shot"}>
              <span className={`dropzone-icon ${busy === "shot" ? "spin" : ""}`}>
                <CameraIcon />
              </span>
              <span className="dropzone-title">{busy === "shot" ? "Распознаём скриншот…" : "Загрузить скриншот товара"}</span>
              <span className="hint-text">Название, цену и фото найдём сами</span>
            </button>
            <input ref={shotInput} type="file" accept="image/*" hidden onChange={(e) => onScreenshot(e.target.files?.[0])} />
          </>
        )}

        <div className="preview-card">
          <div className="preview-photo">
            <Frame src={picture.url} bg={picture.bg} />
            {rawSource && (
              <button type="button" className="link-btn" onClick={() => setCropOpen(true)}>
                Подстроить рамку
              </button>
            )}
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
      {cropOpen && rawSource && <CropSheet src={rawSource} box={seedBox} onCancel={() => setCropOpen(false)} onConfirm={onCropConfirm} />}
    </Fragment>
  );
}
