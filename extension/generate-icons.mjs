import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "icons");

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function paint(x, y, size) {
  const t = (v) => (v / size) * 16;
  const px = t(x + 0.5);
  const py = t(y + 0.5);
  const bg = [91, 141, 239, 255];
  const white = [255, 255, 255, 255];
  const r = 3.2;
  const inRoundRect = (ix, iy, x0, y0, x1, y1, rad) => {
    const cx = Math.min(Math.max(ix, x0 + rad), x1 - rad);
    const cy = Math.min(Math.max(iy, y0 + rad), y1 - rad);
    const dx = ix - cx;
    const dy = iy - cy;
    return dx * dx + dy * dy <= rad * rad;
  };
  if (!inRoundRect(px, py, 1.2, 1.2, 14.8, 14.8, r)) return [0, 0, 0, 0];
  if (inRoundRect(px, py, 3.1, 3.4, 12.9, 11.2, 1.8)) {
    if (py > 10.4 && px > 4.2 && px < 7.6) return bg;
    return white;
  }
  if (px > 5.2 && px < 8.4 && py > 10.6 && py < 13.4 && px - py < -4.4) return white;
  return bg;
}

function makePng(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[stride * y] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x, y, size);
      const o = stride * y + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), makePng(size));
}
console.log("icons written");
