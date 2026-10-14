import fs from "fs";
import path from "path";
import { crc32, deflateRawSync } from "zlib";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extDir = path.join(root, "extension");

const FILES = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

function dosDateTime(date) {
  const year = Math.max(date.getFullYear() - 1980, 0);
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = (year << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function encodePath(rel) {
  return Buffer.from(rel.replaceAll("\\", "/"), "utf8");
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = encodePath(entry.name);
    const { dosTime, dosDate } = dosDateTime(entry.mtime);
    const crc = crc32(entry.data);
    const compressed = deflateRawSync(entry.data);
    const useStore = compressed.length >= entry.data.length;
    const payload = useStore ? entry.data : compressed;
    const method = useStore ? 0 : 8;

    const localHeader = Buffer.concat([
      Buffer.from("PK\u0003\u0004"),
      u16(20),
      u16(0),
      u16(method),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(payload.length),
      u32(entry.data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      payload,
    ]);

    const centralHeader = Buffer.concat([
      Buffer.from("PK\u0001\u0002"),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(payload.length),
      u32(entry.data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);

    localParts.push(localHeader);
    centralParts.push(centralHeader);
    offset += localHeader.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    Buffer.from("PK\u0005\u0006"),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);

  return Buffer.concat([...localParts, central, end]);
}

function packTo(dest) {
  const entries = FILES.map((rel) => {
    const abs = path.join(extDir, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`missing extension file: ${rel}`);
    }
    const stat = fs.statSync(abs);
    return {
      name: rel,
      data: fs.readFileSync(abs),
      mtime: stat.mtime,
    };
  });

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buildZip(entries));
  const size = fs.statSync(dest).size;
  console.log(`packed ${path.relative(root, dest)} (${size} bytes)`);
}

const targets = [
  path.join(root, "private-chat-extension.zip"),
  path.join(root, "client/public/private-chat-extension.zip"),
];

const distClient = path.join(root, "dist/client");
if (fs.existsSync(distClient)) {
  targets.push(path.join(distClient, "private-chat-extension.zip"));
}

for (const dest of targets) packTo(dest);
