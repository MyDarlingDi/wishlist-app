import { useEffect, useMemo, useRef, useState } from "react";
import type { Box } from "./api";

const OUTPUT_SIZE = 1000;
const MAX_ZOOM = 4;

interface View {
  natural: { w: number; h: number };
  /** How many CSS px in the viewport one image px covers. */
  scale: number;
  /** Top-left of the image, in viewport CSS px (always ≤ 0, image always covers the square). */
  x: number;
  y: number;
}

function coverScale(natural: { w: number; h: number }, viewport: number) {
  return viewport / Math.min(natural.w, natural.h);
}

function clampOffset(v: Pick<View, "natural" | "scale">, x: number, y: number, viewport: number): { x: number; y: number } {
  const w = v.natural.w * v.scale;
  const h = v.natural.h * v.scale;
  return { x: Math.min(0, Math.max(viewport - w, x)), y: Math.min(0, Math.max(viewport - h, y)) };
}

/** Starting view that frames `box` (a fraction of the image) inside the square viewport, or a centered full-image view without one. */
function initialView(natural: { w: number; h: number }, viewport: number, box: Box | null): View {
  const base = coverScale(natural, viewport);
  if (!box || box.width <= 0 || box.height <= 0) {
    return { natural, scale: base, ...clampOffset({ natural, scale: base }, (viewport - natural.w * base) / 2, (viewport - natural.h * base) / 2, viewport) };
  }
  const boxPx = { w: box.width * natural.w, h: box.height * natural.h };
  const fit = viewport / Math.max(boxPx.w, boxPx.h);
  const scale = Math.min(MAX_ZOOM * base, Math.max(base, fit));
  const centerX = (box.x + box.width / 2) * natural.w;
  const centerY = (box.y + box.height / 2) * natural.h;
  const { x, y } = clampOffset({ natural, scale }, viewport / 2 - centerX * scale, viewport / 2 - centerY * scale, viewport);
  return { natural, scale, x, y };
}

/**
 * Square photo-crop tool: drag to pan, slider to zoom, always fills the frame (no letterboxing) —
 * the same idea as Telegram/Instagram's own avatar cropper. Works entirely on the image already
 * in memory (a data: URL), so it needs no network round-trip and no CORS handling.
 */
export function CropSheet({ src, box, onCancel, onConfirm }: { src: string; box: Box | null; onCancel: () => void; onConfirm: (dataUrl: string, box: Box) => void }) {
  const [viewport, setViewport] = useState(320);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState<View | null>(null);
  const boxRef = useRef(box);
  const viewportRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const image = new Image();
    image.onload = () => setImg(image);
    image.src = src;
  }, [src]);

  useEffect(() => {
    if (img && viewport) setView(initialView({ w: img.naturalWidth, h: img.naturalHeight }, viewport, boxRef.current));
  }, [img, viewport]);

  const baseScale = useMemo(() => (img ? coverScale({ w: img.naturalWidth, h: img.naturalHeight }, viewport) : 1), [img, viewport]);
  const zoom = view && baseScale ? view.scale / baseScale : 1;

  function setZoom(next: number) {
    setView((v) => {
      if (!v || !viewport) return v;
      const scale = baseScale * next;
      // Zoom around the viewport's centre so the crop doesn't jump.
      const cx = (viewport / 2 - v.x) / v.scale;
      const cy = (viewport / 2 - v.y) / v.scale;
      return { ...v, scale, ...clampOffset({ natural: v.natural, scale }, viewport / 2 - cx * scale, viewport / 2 - cy * scale, viewport) };
    });
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!view) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !view) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setView((v) => v && { ...v, ...clampOffset(v, drag.current!.ox + dx, drag.current!.oy + dy, viewport) });
  }
  const endDrag = () => (drag.current = null);

  function confirm() {
    if (!img || !view) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d")!;
    // The visible square, translated back into the image's own pixel coordinates.
    const sx = -view.x / view.scale;
    const sy = -view.y / view.scale;
    const s = viewport / view.scale;
    ctx.drawImage(img, sx, sy, s, s, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    const usedBox: Box = { x: sx / view.natural.w, y: sy / view.natural.h, width: s / view.natural.w, height: s / view.natural.h };
    onConfirm(canvas.toDataURL("image/jpeg", 0.88), usedBox);
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="modal-title">Подстроить фото</p>
        <p className="hint-text">Потяните, чтобы подвинуть, и используйте ползунок, чтобы приблизить.</p>

        <div
          ref={viewportRef}
          className="crop-viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {img && view && (
            <img
              className="crop-image"
              src={src}
              alt=""
              draggable={false}
              style={{ width: view.natural.w * view.scale, height: view.natural.h * view.scale, transform: `translate(${view.x}px, ${view.y}px)` }}
            />
          )}
        </div>

        <input
          className="crop-zoom"
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Масштаб"
        />

        <div className="action-row">
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>
            Отмена
          </button>
          <button className="btn btn-ribbon" style={{ flex: 1 }} disabled={!view} onClick={confirm}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
