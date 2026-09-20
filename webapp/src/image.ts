/**
 * Reads a photo/screenshot, applies EXIF orientation, shrinks it so the upload stays small
 * (a phone screenshot is ~3 MB as PNG), and returns a JPEG data URL.
 * 2000 px keeps small print on a tall product-page screenshot legible for recognition.
 */
export async function fileToJpegDataUrl(file: File, maxSide = 2000, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent PNGs become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

export const isHttpUrl = (s: string) => {
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

export const formatPrice = (n: number | null | undefined, currency = "RUB") =>
  n ? `${Math.round(n).toLocaleString("ru-RU")} ${currency === "USD" ? "$" : currency === "EUR" ? "€" : "₽"}` : null;
