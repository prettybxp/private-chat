/** 无鼠标/键盘操作超过此时长，视为离开（毫秒） */
export const IDLE_MS = 2 * 60 * 1000;

type Reporter = {
  start: () => void;
  stop: () => void;
  /** 发消息等主动操作时可调用 */
  ping: () => void;
};

export function createActivityReporter(send: (active: boolean) => void): Reporter {
  let idle = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastMoveAt = 0;

  const scheduleIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!idle) {
        idle = true;
        send(false);
      }
    }, IDLE_MS);
  };

  const markActive = () => {
    scheduleIdle();
    if (idle) {
      idle = false;
      send(true);
    }
  };

  const onMouseMove = () => {
    const now = Date.now();
    if (now - lastMoveAt < 3000) return;
    lastMoveAt = now;
    markActive();
  };

  const handlers: Array<[string, EventListener]> = [
    ["mousemove", onMouseMove],
    ["mousedown", markActive],
    ["keydown", markActive],
    ["scroll", markActive],
    ["touchstart", markActive],
    ["click", markActive],
    ["wheel", markActive],
  ];

  const onVisible = () => {
    if (!document.hidden) markActive();
  };

  return {
    start() {
      idle = false;
      scheduleIdle();
      send(true);
      for (const [type, fn] of handlers) {
        window.addEventListener(type, fn, { passive: true });
      }
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", markActive);
    },
    stop() {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      for (const [type, fn] of handlers) {
        window.removeEventListener(type, fn);
      }
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", markActive);
    },
    ping: markActive,
  };
}
