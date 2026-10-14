const BASE_TITLE = "私人聊天室";
const FLASH_MS = 800;
const DEFAULT_ICON = "/favicon.png";

let unread = 0;
let flashOn = false;
let timer: ReturnType<typeof setInterval> | null = null;
let faviconLink: HTMLLinkElement | null = null;
let alertIconUrl = "";
let normalIconUrl = "";

function getFaviconLink(): HTMLLinkElement {
  if (faviconLink && faviconLink.isConnected) return faviconLink;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  faviconLink = link;
  return link;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function makeIcon(bg: string): string {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return DEFAULT_ICON;
  roundedRect(ctx, 1, 1, 30, 30, 8);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = "#fff";
  roundedRect(ctx, 7, 8, 18, 14, 4);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, 20);
  ctx.lineTo(14, 20);
  ctx.lineTo(10, 26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = bg;
  roundedRect(ctx, 9, 10, 14, 10, 2);
  ctx.fill();
  return canvas.toDataURL("image/png");
}

function ensureIcons(): void {
  if (!normalIconUrl) normalIconUrl = makeIcon("#5b8def");
  if (!alertIconUrl) alertIconUrl = makeIcon("#e85d4c");
}

function applyFavicon(alert: boolean): void {
  ensureIcons();
  const link = getFaviconLink();
  link.type = "image/png";
  link.href = alert ? alertIconUrl : normalIconUrl || DEFAULT_ICON;
}

function renderFlash(): void {
  if (unread <= 0) {
    document.title = BASE_TITLE;
    applyFavicon(false);
    return;
  }
  if (flashOn) {
    document.title = "【新消息】";
    applyFavicon(true);
  } else {
    document.title = `(${unread}) ${BASE_TITLE}`;
    applyFavicon(false);
  }
}

export function isTabInactive(): boolean {
  return document.hidden || document.visibilityState !== "visible";
}

export function notifyTabAlert(): void {
  if (!isTabInactive()) return;
  unread += 1;
  if (timer) {
    renderFlash();
    return;
  }
  flashOn = true;
  renderFlash();
  timer = setInterval(() => {
    flashOn = !flashOn;
    renderFlash();
  }, FLASH_MS);
}

export function clearTabAlert(): void {
  unread = 0;
  flashOn = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  document.title = BASE_TITLE;
  applyFavicon(false);
}

export function initTabAlert(): void {
  ensureIcons();
  applyFavicon(false);
  const stopIfVisible = () => {
    if (!isTabInactive()) clearTabAlert();
  };
  document.addEventListener("visibilitychange", stopIfVisible);
  window.addEventListener("focus", stopIfVisible);
}
