interface TgWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number } };
  themeParams: Record<string, string | undefined>;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  onEvent(name: string, cb: () => void): void;
  openLink(url: string, opts?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  showAlert(msg: string, cb?: () => void): void;
  showConfirm(msg: string, cb: (ok: boolean) => void): void;
  HapticFeedback?: { impactOccurred(style: string): void; notificationOccurred(type: string): void };
}

const tg: TgWebApp | undefined = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

export function initTelegram() {
  tg?.ready();
  tg?.expand();
  applyTheme();
  tg?.onEvent("themeChanged", applyTheme);
}

function applyTheme() {
  if (!tg) return;
  const p = tg.themeParams;
  const map: Record<string, string | undefined> = {
    "--tg-bg": p.bg_color,
    "--tg-text": p.text_color,
    "--tg-hint": p.hint_color,
    "--tg-button": p.button_color,
    "--tg-button-text": p.button_text_color,
    "--tg-secondary-bg": p.secondary_bg_color,
  };
  for (const [k, v] of Object.entries(map)) if (v) document.documentElement.style.setProperty(k, v);
  document.documentElement.dataset.scheme = tg.colorScheme;
}

/**
 * Inside Telegram: the signed initData. In `npm run dev` (outside Telegram) a fake user is
 * used — `?devuser=2` opens the app as user 2 — which the server accepts only when DEV_AUTH=1.
 */
export function authHeader(): string {
  if (tg?.initData) return `tma ${tg.initData}`;
  if (import.meta.env.DEV) {
    const id = new URLSearchParams(location.search).get("devuser") ?? "1";
    return `dev ${id}:Dev${id}`;
  }
  return "";
}

export const inTelegram = () => !!tg?.initData;

/** Wishlist to open: `startapp=wishlist_<id>` (direct link) or `?wl=<id>` (button in the bot chat). Also accepts old `u<id>`. */
export function requestedOwner(): number | null {
  const raw = tg?.initDataUnsafe.start_param ?? new URLSearchParams(location.search).get("wl");
  const m = /^(?:wishlist_|u)?(\d{1,15})$/.exec(raw ?? "");
  return m ? Number(m[1]) : null;
}

export const openLink = (url: string) => (tg?.openLink ? tg.openLink(url, { try_instant_view: false }) : window.open(url, "_blank"));
export const openTelegramLink = (url: string) => (tg?.openTelegramLink ? tg.openTelegramLink(url) : window.open(url, "_blank"));
export const showAlert = (msg: string) => (tg?.showAlert ? tg.showAlert(msg) : window.alert(msg));
export const confirmDialog = (msg: string) =>
  new Promise<boolean>((resolve) => (tg?.showConfirm ? tg.showConfirm(msg, resolve) : resolve(window.confirm(msg))));
export const haptic = (style = "light") => tg?.HapticFeedback?.impactOccurred(style);
