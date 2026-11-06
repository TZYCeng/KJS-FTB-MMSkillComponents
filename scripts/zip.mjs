/**
 * Minimal read-only ZIP reader (zero dependencies).
 *
 * Mod jars and datapacks are ZIPs, and the workbench only needs to list entries
 * and pull a few files out of them (lang tables, item models, textures), so a
 * full library would be dead weight. Supports stored + deflate entries and the
 * ZIP64 end-of-central-directory records that large mod jars occasionally use.
 */
import { promises as fs } from 'node:fs';
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const S_IFDIR = 0x10;

/** Refuse to inflate anything bigger than this unless the caller asks for it. */
export const DEFAULT_MAX_ENTRY = 32 * 1024 * 1024;

function findEocd(buf) {
  const min = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function normalize(name) {
  return name.replace(/\\/g, '/');
}

/**
 * @param {string} path zip file
 * @returns {Promise<{path:string, entries:Map<string,object>, list:object[], names:()=>string[], has:(n:string)=>boolean, read:(n:string, o?:object)=>Promise<Buffer>, readText:(n:string)=>Promise<string>, close:()=>Promise<void>}>}
 */
export async function openZip(path, { strict = false } = {}) {
  const handle = await fs.open(path, 'r');
  try {
    const stat = await handle.stat();
    const size = stat.size;
    if (size < 22) throw new Error(`not a zip file: ${path}`);

    const tailLen = Math.min(size, 66_000);
    const tail = Buffer.alloc(tailLen);
    await handle.read(tail, 0, tailLen, size - tailLen);

    const eocd = findEocd(tail);
    if (eocd < 0) {
      if (strict) throw new Error(`no end-of-central-directory record: ${path}`);
      return emptyArchive(path, handle);
    }
    const eocdAbs = size - tailLen + eocd;

    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);

    // ZIP64: locator sits 20 bytes before the classic EOCD.
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locatorAbs = eocdAbs - 20;
      if (locatorAbs >= 0) {
        const loc = Buffer.alloc(20);
        await handle.read(loc, 0, 20, locatorAbs);
        if (loc.readUInt32LE(0) === EOCD64_LOCATOR_SIG) {
          const z64 = Buffer.alloc(56);
          const z64Offset = Number(loc.readBigUInt64LE(8));
          await handle.read(z64, 0, 56, z64Offset);
          if (z64.readUInt32LE(0) === EOCD64_SIG) {
            count = Number(z64.readBigUInt64LE(32));
            cdSize = Number(z64.readBigUInt64LE(40));
            cdOffset = Number(z64.readBigUInt64LE(48));
          }
        }
      }
    }

    if (cdOffset < 0 || cdOffset + cdSize > size) {
      if (strict) throw new Error(`central directory is out of bounds: ${path}`);
      return emptyArchive(path, handle);
    }

    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);

    /** @type {Map<string, any>} */
    const entries = new Map();
    const list = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== CENTRAL_SIG) break;
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      let compSize = cd.readUInt32LE(p + 20);
      let uncompSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const external = cd.readUInt32LE(p + 38);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = normalize(cd.toString('utf8', p + 46, p + 46 + nameLen));

      // ZIP64 extended information extra field (0x0001) holds the real sizes.
      if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
        let e = p + 46 + nameLen;
        const end = e + extraLen;
        while (e + 4 <= end) {
          const id = cd.readUInt16LE(e);
          const len = cd.readUInt16LE(e + 2);
          if (id === 0x0001) {
            let q = e + 4;
            if (uncompSize === 0xffffffff && q + 8 <= end) { uncompSize = Number(cd.readBigUInt64LE(q)); q += 8; }
            if (compSize === 0xffffffff && q + 8 <= end) { compSize = Number(cd.readBigUInt64LE(q)); q += 8; }
            if (localOffset === 0xffffffff && q + 8 <= end) { localOffset = Number(cd.readBigUInt64LE(q)); }
            break;
          }
          e += 4 + len;
        }
      }

      const entry = {
        name,
        method,
        flags,
        crc,
        compressedSize: compSize,
        size: uncompSize,
        localOffset,
        isDirectory: name.endsWith('/') || (external & S_IFDIR) !== 0,
      };
      if (!entries.has(name)) entries.set(name, entry);
      list.push(entry);
      p += 46 + nameLen + extraLen + commentLen;
    }

    const archive = {
      path,
      entries,
      list,
      names: () => list.map((e) => e.name),
      has: (name) => entries.has(normalize(name)),
      read: (name, opts) => readEntry(handle, entries, name, opts),
      readText: async (name, opts) => (await readEntry(handle, entries, name, opts)).toString('utf8'),
      close: () => handle.close(),
    };
    return archive;
  } catch (err) {
    await handle.close().catch(() => {});
    throw err;
  }
}

async function emptyArchive(path, handle) {
  return {
    path,
    entries: new Map(),
    list: [],
    names: () => [],
    has: () => false,
    read: async () => { throw new Error(`entry not found in unreadable archive: ${path}`); },
    readText: async () => { throw new Error(`entry not found in unreadable archive: ${path}`); },
    close: () => handle.close(),
  };
}

async function readEntry(handle, entries, name, { maxSize = DEFAULT_MAX_ENTRY } = {}) {
  const key = normalize(name);
  const entry = entries.get(key);
  if (!entry) throw new Error(`entry not found: ${key}`);
  if (entry.isDirectory) return Buffer.alloc(0);
  if (entry.flags & 1) throw new Error(`encrypted entry: ${key}`);
  if (entry.size > maxSize) throw new Error(`entry too large (${entry.size} bytes): ${key}`);

  const header = Buffer.alloc(30);
  await handle.read(header, 0, 30, entry.localOffset);
  if (header.readUInt32LE(0) !== LOCAL_SIG) throw new Error(`bad local header: ${key}`);
  const nameLen = header.readUInt16LE(26);
  const extraLen = header.readUInt16LE(28);
  const dataOffset = entry.localOffset + 30 + nameLen + extraLen;

  const raw = Buffer.alloc(entry.compressedSize);
  if (entry.compressedSize > 0) await handle.read(raw, 0, entry.compressedSize, dataOffset);

  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    const out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(maxSize, entry.size) });
    return out;
  }
  throw new Error(`unsupported compression method ${entry.method}: ${key}`);
}

/** Cheap "is this a readable zip" probe used when scanning a mods folder. */
export async function isZip(path) {
  try {
    const handle = await fs.open(path, 'r');
    try {
      const head = Buffer.alloc(4);
      await handle.read(head, 0, 4, 0);
      return head.readUInt32LE(0) === LOCAL_SIG || head.toString('utf8', 0, 2) === 'PK';
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}
