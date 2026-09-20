import { and, lt, sql } from "drizzle-orm";
import sharp from "sharp";
import type { DB } from "../db/client.js";
import { wishImages } from "../db/schema.js";
import { HttpError } from "../errors.js";

/** Relative rectangle in 0..1 image coordinates (x, y = top-left corner). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProcessedImage {
  data: Buffer;
  mime: "image/jpeg";
  /** Colour of the picture's outer edge — the frame is painted with it, so `contain` letterboxing is invisible. */
  bg: string;
  cropped: boolean;
}

const MAX_SIDE = 1000;
const CROP_PADDING = 0.03;
const MIN_CROP_AREA = 0.04;

export function dataUrlToBuffer(dataUrl: string, maxBytes = 10 * 1024 * 1024): Buffer {
  const m = /^data:image\/(?:png|jpe?g|webp|gif|heic|heif);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, "bad_image");
  const buf = Buffer.from(m[1]!, "base64");
  if (buf.length === 0 || buf.length > maxBytes) throw new HttpError(400, "bad_image");
  return buf;
}

/** Ignores boxes that are malformed or cover almost nothing (model hallucinations). */
export function sanitizeBox(box: Box | null | undefined): Box | null {
  if (!box) return null;
  const { x, y, width, height } = box;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  const x0 = Math.max(0, x - CROP_PADDING);
  const y0 = Math.max(0, y - CROP_PADDING);
  const x1 = Math.min(1, x + width + CROP_PADDING);
  const y1 = Math.min(1, y + height + CROP_PADDING);
  if (x1 <= x0 || y1 <= y0) return null;
  if ((x1 - x0) * (y1 - y0) < MIN_CROP_AREA) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Auto-rotate, optional crop, downscale, flatten to JPEG, and measure the edge colour. */
export async function processImage(input: Buffer, box?: Box | null, maxSide = MAX_SIDE): Promise<ProcessedImage> {
  try {
    const oriented = await sharp(input, { limitInputPixels: 60e6 }).rotate().toBuffer({ resolveWithObject: true });
    let pipeline = sharp(oriented.data);
    let cropped = false;
    const region = sanitizeBox(box);
    if (region) {
      const { width: w, height: h } = oriented.info;
      const left = Math.floor(region.x * w);
      const top = Math.floor(region.y * h);
      pipeline = pipeline.extract({
        left,
        top,
        width: Math.max(1, Math.min(w - left, Math.round(region.width * w))),
        height: Math.max(1, Math.min(h - top, Math.round(region.height * h))),
      });
      cropped = true;
    }
    const data = await pipeline
      .flatten({ background: "#ffffff" })
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { data, mime: "image/jpeg", bg: await edgeColor(data), cropped };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "bad_image");
  }
}

/**
 * Median colour of the outermost pixel ring. Median (not mean) so that an object touching the
 * edge — a sofa's armrest, a bottle cap — doesn't tint the frame away from the real background.
 */
async function edgeColor(jpeg: Buffer): Promise<string> {
  const N = 48;
  const raw = await sharp(jpeg).resize(N, N, { fit: "fill", kernel: "nearest" }).removeAlpha().raw().toBuffer();
  const ring: number[][] = [[], [], []];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (x !== 0 && y !== 0 && x !== N - 1 && y !== N - 1) continue;
      const i = (y * N + x) * 3;
      for (let c = 0; c < 3; c++) ring[c]!.push(raw[i + c]!);
    }
  }
  const median = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1]!;
  return `#${ring.map((v) => median(v).toString(16).padStart(2, "0")).join("")}`;
}

export async function storeImage(db: DB, img: ProcessedImage): Promise<string> {
  const [row] = await db
    .insert(wishImages)
    .values({ data: img.data, mime: img.mime, bg: img.bg })
    .returning({ id: wishImages.id });
  return row!.id;
}

/** Uploaded-but-never-saved images (abandoned "add wish" dialogs) are dropped after a day. */
export async function deleteOrphanImages(db: DB): Promise<void> {
  await db.delete(wishImages).where(
    and(
      lt(wishImages.createdAt, sql`now() - interval '1 day'`),
      sql`not exists (select 1 from wishes where wishes.image_id = ${wishImages.id})`,
    ),
  );
}
