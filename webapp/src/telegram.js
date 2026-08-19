const tg = window.Telegram?.WebApp;

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  applyThemeVars();
  tg.onEvent("themeChanged", applyThemeVars);
}

function applyThemeVars() {
  if (!tg) return;
  const p = tg.themeParams || {};
  const root = document.documentElement.style;
  const map = {
    "--tg-bg": p.bg_color,
    "--tg-text": p.text_color,
    "--tg-hint": p.hint_color,
    "--tg-link": p.link_color,
    "--tg-button": p.button_color,
    "--tg-button-text": p.button_text_color,
    "--tg-secondary-bg": p.secondary_bg_color,
    "--tg-section-bg": p.section_bg_color,
  };
  Object.entries(map).forEach(([k, v]) => {
    if (v) root.setProperty(k, v);
  });
  root.setProperty("--tg-color-scheme", tg.colorScheme || "light");
}

export function getInitData() {
  return tg?.initData || "";
}

export function getTelegramUser() {
  return tg?.initDataUnsafe?.user || null;
}

export function getStartParam() {
  return tg?.initDataUnsafe?.start_param || null;
}

export function openExternalLink(url) {
  if (tg?.openLink) tg.openLink(url, { try_instant_view: false });
  else window.open(url, "_blank");
}

export function openInvoice(link, onClosed) {
  if (tg?.openInvoice) {
    tg.openInvoice(link, (status) => onClosed?.(status));
  } else {
    window.open(link, "_blank");
  }
}

export function showAlert(message) {
  if (tg?.showAlert) tg.showAlert(message);
  else window.alert(message);
}

export function showConfirm(message) {
  return new Promise((resolve) => {
    if (tg?.showConfirm) tg.showConfirm(message, (ok) => resolve(ok));
    else resolve(window.confirm(message));
  });
}

export function hapticSelection() {
  tg?.HapticFeedback?.selectionChanged?.();
}

export function hapticImpact(style = "light") {
  tg?.HapticFeedback?.impactOccurred?.(style);
}

export function shareLink(url, text) {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(
    text || ""
  )}`;
  openExternalLink(shareUrl);
}

export function getBotUsername() {
  return import.meta.env.VITE_BOT_USERNAME || "";
}

export function getAppShortName() {
  return import.meta.env.VITE_WEBAPP_SHORT_NAME || "wishlist";
}

export function buildShareLink(userId) {
  const bot = getBotUsername();
  const app = getAppShortName();
  if (!bot) return window.location.href;
  return `https://t.me/${bot}/${app}?startapp=u${userId}`;
}
