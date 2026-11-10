// 零第三方依赖的 ZIP 读写实现（DOCX 打包用）。
//
// 只使用 Node 内置模块：
//   - node:zlib 的 deflateRawSync / inflateRawSync
//   - Buffer 的二进制读写
//
// 生成的是标准 ZIP32 结构：本地文件头 + 数据 + 中央目录 + EOCD。
// 文件名一律以 UTF-8 编码，并置通用标志位 bit 11（0x0800），
// 这样中文路径在 Word / WPS / unzip 中都能正确显示。

import { deflateRawSync, inflateRawSync } from 'node:zlib';

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

const VERSION_NEEDED = 20; // 2.0：支持 deflate
const FLAG_UTF8 = 0x0800; // 通用标志位 bit 11：文件名为 UTF-8
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

// ---------------------------------------------------------------------------
// CRC32（IEEE 802.3，ZIP 使用的多项式 0xEDB88320）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * 计算 Buffer 的 CRC32 校验值。
 * @param {Buffer} buffer
 * @returns {number} 无符号 32 位整数
 */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/**
 * 把 Date 转成 ZIP 的 DOS 时间/日期（本地时间，精度 2 秒）。
 * @param {Date} value
 * @returns {{ time: number, date: number }}
 */
function toDosDateTime(value) {
  const d = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  const month = Math.min(12, Math.max(1, d.getMonth() + 1));
  const day = Math.min(31, Math.max(1, d.getDate()));
  const hours = Math.min(23, Math.max(0, d.getHours()));
  const minutes = Math.min(59, Math.max(0, d.getMinutes()));
  const seconds = Math.min(59, Math.max(0, d.getSeconds()));
  const date = ((year - 1980) << 9) | (month << 5) | day;
  const time = (hours << 11) | (minutes << 5) | (seconds >> 1);
  return { time, date };
}

/**
 * 把条目内容统一转成 Buffer。
 * @param {Buffer|Uint8Array|string|null|undefined} data
 * @returns {Buffer}
 */
function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data === null || data === undefined) return Buffer.alloc(0);
  throw new TypeError('createZip: entry.data 必须是 Buffer、Uint8Array 或字符串');
}

/**
 * 从缓冲区尾部向前查找 EOCD（结束中央目录记录）的位置。
 * @param {Buffer} buffer
 * @returns {number} 偏移量，找不到返回 -1
 */
function findEndOfCentralDirectory(buffer) {
  if (buffer.length < 22) return -1;
  const minOffset = Math.max(0, buffer.length - 22 - UINT16_MAX);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIR_SIG) return offset;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

/**
 * 创建 ZIP 压缩包。
 *
 * @param {Array<{ name: string, data?: Buffer|Uint8Array|string, deflate?: boolean }>} entries
 *   条目列表。name 使用 `/` 分隔；data 缺省为空内容；deflate 缺省按 options.compress（默认 true），
 *   若压缩后反而更大则自动退回 store（不压缩）。
 * @param {{ compress?: boolean, mtime?: Date }} [options]
 * @returns {Buffer}
 */
export function createZip(entries, options = {}) {
  if (!Array.isArray(entries)) {
    throw new TypeError('createZip: entries 必须是数组');
  }
  const compress = options?.compress === undefined ? true : Boolean(options.compress);
  const { time: dosTime, date: dosDate } = toDosDateTime(options?.mtime);

  /** @type {Buffer[]} */
  const localParts = [];
  /** @type {Buffer[]} */
  const centralParts = [];
  const seenNames = new Set();
  let offset = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError('createZip: 每个条目必须是 { name, data } 对象');
    }
    const name = String(entry.name ?? '').trim().replace(/\\/g, '/');
    if (!name) throw new TypeError('createZip: entry.name 不能为空');
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) {
      throw new Error(`createZip: 条目名不合法：${name}`);
    }
    if (seenNames.has(name)) throw new Error(`createZip: 条目名重复：${name}`);
    seenNames.add(name);

    const nameBuffer = Buffer.from(name, 'utf8');
    if (nameBuffer.length > UINT16_MAX) {
      throw new Error(`createZip: 条目名过长（${nameBuffer.length} 字节）`);
    }

    const raw = toBuffer(entry.data);
    const checksum = crc32(raw);

    let method = METHOD_STORE;
    let payload = raw;
    const wantCompress = entry.deflate === undefined ? compress : Boolean(entry.deflate);
    if (wantCompress && raw.length > 0) {
      const deflated = deflateRawSync(raw, { level: 9 });
      if (deflated.length < raw.length) {
        method = METHOD_DEFLATE;
        payload = deflated;
      }
    }

    // ---- 本地文件头（30 字节）+ 文件名 + 数据 ----
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
    localHeader.writeUInt16LE(VERSION_NEEDED, 4);
    localHeader.writeUInt16LE(FLAG_UTF8, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field 长度

    localParts.push(localHeader, nameBuffer, payload);

    // ---- 中央目录项（46 字节 + 文件名）----
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_DIR_HEADER_SIG, 0);
    centralHeader.writeUInt16LE(VERSION_NEEDED, 4); // version made by
    centralHeader.writeUInt16LE(VERSION_NEEDED, 6); // version needed
    centralHeader.writeUInt16LE(FLAG_UTF8, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field
    centralHeader.writeUInt16LE(0, 32); // file comment
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attributes
    centralHeader.writeUInt32LE(0, 38); // external attributes
    centralHeader.writeUInt32LE(offset, 42); // 本地头偏移

    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + payload.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const entryCount = seenNames.size;
  if (entryCount > UINT16_MAX) {
    throw new Error('createZip: 条目数量超出 ZIP32 上限（65535）');
  }
  if (offset > UINT32_MAX || offset + centralSize > UINT32_MAX) {
    throw new Error('createZip: 内容过大，超出 ZIP32 上限（4GB）');
  }

  // ---- EOCD（22 字节）----
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(END_OF_CENTRAL_DIR_SIG, 0);
  eocd.writeUInt16LE(0, 4); // 当前磁盘号
  eocd.writeUInt16LE(0, 6); // 中央目录起始磁盘号
  eocd.writeUInt16LE(entryCount, 8); // 本磁盘条目数
  eocd.writeUInt16LE(entryCount, 10); // 总条目数
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16); // 中央目录起始偏移
  eocd.writeUInt16LE(0, 20); // 注释长度

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

/**
 * 解析 ZIP 压缩包，返回「条目名 -> 内容」的 Map（保持中央目录顺序）。
 * 会校验文件头签名、解压后大小与 CRC32，适合测试与文档自检。
 *
 * @param {Buffer|Uint8Array} input
 * @returns {Map<string, Buffer>}
 */
export function readZip(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  if (buffer.length < 22) {
    throw new Error('readZip: 数据太短，不是有效的 ZIP 文件');
  }

  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new Error('readZip: 找不到 ZIP 结束记录（EOCD），文件可能已损坏');
  }

  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (
    totalEntries === UINT16_MAX ||
    entriesOnDisk === UINT16_MAX ||
    centralSize === UINT32_MAX ||
    centralOffset === UINT32_MAX
  ) {
    throw new Error('readZip: 暂不支持 ZIP64 格式');
  }
  if (entriesOnDisk !== totalEntries) {
    throw new Error('readZip: 分卷 ZIP 不受支持');
  }
  if (centralOffset + centralSize > buffer.length) {
    throw new Error('readZip: 中央目录越界，文件可能已损坏');
  }

  /** @type {Map<string, Buffer>} */
  const result = new Map();
  let cursor = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > buffer.length) {
      throw new Error('readZip: 中央目录项越界，文件可能已损坏');
    }
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIR_HEADER_SIG) {
      throw new Error(`readZip: 第 ${index + 1} 个中央目录项签名无效`);
    }

    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) {
      throw new Error(`readZip: 第 ${index + 1} 个中央目录项的文件名越界`);
    }
    const nameEncoding = (flags & FLAG_UTF8) !== 0 ? 'utf8' : 'latin1';
    const name = buffer.subarray(nameStart, nameEnd).toString(nameEncoding);

    cursor = nameEnd + extraLength + commentLength;

    // 本地文件头里的文件名/扩展字段长度可能和中央目录不同，必须按本地头计算数据起点。
    if (localHeaderOffset + 30 > buffer.length) {
      throw new Error(`readZip: 本地文件头越界（${name}）`);
    }
    if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIG) {
      throw new Error(`readZip: 本地文件头签名无效（${name}）`);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      throw new Error(`readZip: 条目数据越界（${name}）`);
    }

    const payload = buffer.subarray(dataStart, dataEnd);
    let data;
    if (method === METHOD_STORE) {
      data = Buffer.from(payload);
    } else if (method === METHOD_DEFLATE) {
      try {
        data = inflateRawSync(payload);
      } catch (error) {
        throw new Error(`readZip: 解压失败（${name}）：${error.message}`);
      }
    } else {
      throw new Error(`readZip: 不支持的压缩方法 ${method}（${name}）`);
    }

    if (data.length !== uncompressedSize) {
      throw new Error(`readZip: 解压后大小校验失败（${name}）`);
    }
    if (crc32(data) !== checksum) {
      throw new Error(`readZip: CRC32 校验失败（${name}）`);
    }

    result.set(name, data);
  }

  return result;
}
