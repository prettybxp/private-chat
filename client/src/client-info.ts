export type ClientInfoPayload = Record<
  string,
  string | number | boolean | string[] | null
>;

const PRIVATE_IP_RE =
  /(?:^|\s)((?:10\.\d{1,3}\.\d{1,3}\.\d{1,3})|(?:192\.168\.\d{1,3}\.\d{1,3})|(?:172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}))(?:\s|$)/;

export function discoverLocalIps(timeoutMs = 2000): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>();
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      resolve([...found]);
    };

    const timer = setTimeout(finish, timeoutMs);

    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({ iceServers: [] });
    } catch {
      clearTimeout(timer);
      resolve([]);
      return;
    }

    pc.createDataChannel("probe");
    pc.onicecandidate = (ev) => {
      if (!ev.candidate?.candidate) return;
      const m = ev.candidate.candidate.match(PRIVATE_IP_RE);
      if (m && m[1]) found.add(m[1]);
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        finish();
      }
    };

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => {
        clearTimeout(timer);
        finish();
      });
  });
}

export async function collectClientInfo(): Promise<ClientInfoPayload> {
  const nav = navigator;
  const conn = (nav as Navigator & { connection?: { effectiveType?: string } })
    .connection;

  const localIps = await discoverLocalIps();

  const info: ClientInfoPayload = {
    userAgent: nav.userAgent,
    language: nav.language,
    languages: [...(nav.languages || [])],
    platform: nav.platform,
    cookieEnabled: nav.cookieEnabled,
    onLine: nav.onLine,
    screenWidth: screen.width,
    screenHeight: screen.height,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hardwareConcurrency: nav.hardwareConcurrency,
    maxTouchPoints: nav.maxTouchPoints,
    pageUrl: location.href,
    referrer: document.referrer || null,
    serverHost: location.hostname,
    localIps,
  };

  if (conn?.effectiveType) {
    info.connectionType = conn.effectiveType;
  }

  return info;
}
