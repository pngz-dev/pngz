importScripts('zstd.js');

const MAGIC = new Uint8Array([0x89,0x50,0x4e,0x47,0x7a,0x0d,0x0a,0x1a]);
const IHDR_SIZE = 16;
const CT_GRAY = 0, CT_RGB = 2, CT_PAL = 3, CT_GRAYA = 4, CT_RGBA = 6;
const FLAG_ALPH = 1;
const FLAG_RCT  = 2;
const FLAG_RAW  = 4;

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_CHUNK_BYTES = 256 * 1024 * 1024;
const MAX_CHUNKS = 8192;
const MAX_IDAT_CHUNKS = 8192;
const MAX_DIM = 16384;
const MAX_PIXELS = 64 * 1024 * 1024;
const MAX_DECODED_BYTES = 512 * 1024 * 1024;
const MAX_PLTE_BYTES = 1024;

const ZSTD_c_compressionLevel = 100;
const ZSTD_c_windowLog = 101;
const ZSTD_c_contentSizeFlag = 200;
const ZSTD_c_checksumFlag = 201;
const ZSTD_c_dictIDFlag = 202;

let zstd = null;

function makeZstd(Module) {
  const wrap = (name, ret, args) => { try { return Module.cwrap(name, ret, args); } catch { return null; } };
  const _compressBound = wrap('ZSTD_compressBound', 'number', ['number']);
  const _compress = wrap('ZSTD_compress', 'number', ['number','number','number','number','number']);
  const _decompress = wrap('ZSTD_decompress', 'number', ['number','number','number','number']);
  const _isError = wrap('ZSTD_isError', 'number', ['number']);
  const _getErrorName = wrap('ZSTD_getErrorName', 'string', ['number']);
  const _createCCtx = wrap('ZSTD_createCCtx', 'number', []);
  const _freeCCtx = wrap('ZSTD_freeCCtx', 'number', ['number']);
  const _createDCtx = wrap('ZSTD_createDCtx', 'number', []);
  const _freeDCtx = wrap('ZSTD_freeDCtx', 'number', ['number']);
  const _compressUsingDict = wrap('ZSTD_compress_usingDict', 'number', ['number','number','number','number','number','number','number','number']);
  const _decompressUsingDict = wrap('ZSTD_decompress_usingDict', 'number', ['number','number','number','number','number','number','number']);
  const _setParameter = wrap('ZSTD_CCtx_setParameter', 'number', ['number','number','number']);
  const _compress2 = wrap('ZSTD_compress2', 'number', ['number','number','number','number','number']);
  const _loadDictionary = wrap('ZSTD_CCtx_loadDictionary', 'number', ['number','number','number']);
  const _trainFromBuffer = wrap('ZDICT_trainFromBuffer', 'number', ['number','number','number','number','number']);
  const _zdictIsError = wrap('ZDICT_isError', 'number', ['number']);
  const _zdictGetError = wrap('ZDICT_getErrorName', 'string', ['number']);
  const hasDict = !!(_compressUsingDict && _decompressUsingDict && _createCCtx && _createDCtx && _freeCCtx && _freeDCtx);
  const hasTrain = !!(_trainFromBuffer && _zdictIsError && _zdictGetError);
  const hasLong = !!(_setParameter && _compress2 && _createCCtx && _freeCCtx);

  function compressPlain(bytes, level) {
    const srcLen = bytes.length;
    const bound = _compressBound(srcLen);
    const srcPtr = Module._malloc(srcLen);
    const dstPtr = Module._malloc(bound);
    try {
      Module.HEAPU8.set(bytes, srcPtr);
      const n = _compress(dstPtr, bound, srcPtr, srcLen, level);
      if (_isError(n)) throw new Error(_getErrorName(n));
      return Module.HEAPU8.slice(dstPtr, dstPtr + n);
    } finally { Module._free(srcPtr); Module._free(dstPtr); }
  }

  function compressDict(bytes, level, dict) {
    const srcLen = bytes.length;
    const dictLen = dict.length;
    const bound = _compressBound(srcLen);
    const srcPtr = Module._malloc(srcLen);
    const dstPtr = Module._malloc(bound);
    const dictPtr = Module._malloc(dictLen);
    const cctx = _createCCtx();
    try {
      Module.HEAPU8.set(bytes, srcPtr);
      Module.HEAPU8.set(dict, dictPtr);
      const n = _compressUsingDict(cctx, dstPtr, bound, srcPtr, srcLen, dictPtr, dictLen, level);
      if (_isError(n)) throw new Error(_getErrorName(n));
      return Module.HEAPU8.slice(dstPtr, dstPtr + n);
    } finally { _freeCCtx(cctx); Module._free(srcPtr); Module._free(dstPtr); Module._free(dictPtr); }
  }

  function compressLong(bytes, level, dict) {
    const srcLen = bytes.length;
    const bound = _compressBound(srcLen);
    const srcPtr = Module._malloc(srcLen);
    const dstPtr = Module._malloc(bound);
    const cctx = _createCCtx();
    let dictPtr = 0;
    try {
      Module.HEAPU8.set(bytes, srcPtr);
      _setParameter(cctx, ZSTD_c_compressionLevel, level);
      _setParameter(cctx, ZSTD_c_windowLog, 27);
      _setParameter(cctx, ZSTD_c_contentSizeFlag, 0);
      _setParameter(cctx, ZSTD_c_checksumFlag, 0);
      _setParameter(cctx, ZSTD_c_dictIDFlag, 0);
      if (dict) {
        dictPtr = Module._malloc(dict.length);
        Module.HEAPU8.set(dict, dictPtr);
        _loadDictionary(cctx, dictPtr, dict.length);
      }
      const n = _compress2(cctx, dstPtr, bound, srcPtr, srcLen);
      if (_isError(n)) throw new Error(_getErrorName(n));
      return Module.HEAPU8.slice(dstPtr, dstPtr + n);
    } finally {
      if (dictPtr) Module._free(dictPtr);
      _freeCCtx(cctx);
      Module._free(srcPtr);
      Module._free(dstPtr);
    }
  }

  function decompressPlain(bytes, expectedSize) {
    const srcLen = bytes.length;
    const srcPtr = Module._malloc(srcLen);
    const dstPtr = Module._malloc(expectedSize);
    try {
      Module.HEAPU8.set(bytes, srcPtr);
      const n = _decompress(dstPtr, expectedSize, srcPtr, srcLen);
      if (_isError(n)) throw new Error(_getErrorName(n));
      return Module.HEAPU8.slice(dstPtr, dstPtr + n);
    } finally { Module._free(srcPtr); Module._free(dstPtr); }
  }

  function decompressDict(bytes, expectedSize, dict) {
    const srcLen = bytes.length;
    const dictLen = dict.length;
    const srcPtr = Module._malloc(srcLen);
    const dstPtr = Module._malloc(expectedSize);
    const dictPtr = Module._malloc(dictLen);
    const dctx = _createDCtx();
    try {
      Module.HEAPU8.set(bytes, srcPtr);
      Module.HEAPU8.set(dict, dictPtr);
      const n = _decompressUsingDict(dctx, dstPtr, expectedSize, srcPtr, srcLen, dictPtr, dictLen);
      if (_isError(n)) throw new Error(_getErrorName(n));
      return Module.HEAPU8.slice(dstPtr, dstPtr + n);
    } finally { _freeDCtx(dctx); Module._free(srcPtr); Module._free(dstPtr); Module._free(dictPtr); }
  }

  function trainDict(samples, dictSize) {
    if (!hasTrain) throw new Error('training unavailable: rebuild zstd.js with ZDICT_trainFromBuffer exported');
    const total = samples.reduce((a, s) => a + s.length, 0);
    if (dictSize > Math.floor(total / 4)) dictSize = Math.max(4096, Math.floor(total / 4));
    const samplesPtr = Module._malloc(total);
    const sizesPtr = Module._malloc(samples.length * 4);
    const dictPtr = Module._malloc(dictSize);
    try {
      let off = 0;
      for (let i = 0; i < samples.length; i++) {
        Module.HEAPU8.set(samples[i], samplesPtr + off);
        Module.HEAPU32[(sizesPtr >> 2) + i] = samples[i].length;
        off += samples[i].length;
      }
      const n = _trainFromBuffer(dictPtr, dictSize, samplesPtr, sizesPtr, samples.length);
      if (_zdictIsError(n)) throw new Error(_zdictGetError(n));
      return Module.HEAPU8.slice(dictPtr, dictPtr + n);
    } finally { Module._free(samplesPtr); Module._free(sizesPtr); Module._free(dictPtr); }
  }

  function compress(bytes, level, dict, longRange) {
    if (longRange && hasLong) return compressLong(bytes, level, dict);
    if (dict && hasDict) return compressDict(bytes, level, dict);
    return compressPlain(bytes, level);
  }

  function decompress(bytes, expectedSize, dict) {
    if (dict && hasDict) return decompressDict(bytes, expectedSize, dict);
    return decompressPlain(bytes, expectedSize);
  }

  return { compress, decompress, trainDict, hasDict, hasTrain, hasLong };
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function hashBytes(bytes) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function applyRCT_RGB(data) {
  const n = data.length / 3;
  const out = new Uint8Array(data.length);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const r = data[j], g = data[j+1], b = data[j+2];
    out[j]   = g;
    out[j+1] = (r - g) & 0xff;
    out[j+2] = (b - g) & 0xff;
  }
  return out;
}

function undoRCT_RGB(data) {
  const n = data.length / 3;
  const out = new Uint8Array(data.length);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const y = data[j], cb = data[j+1], cr = data[j+2];
    out[j]   = (cb + y) & 0xff;
    out[j+1] = y;
    out[j+2] = (cr + y) & 0xff;
  }
  return out;
}

function applyRCT_RGBA(data) {
  const n = data.length / 4;
  const out = new Uint8Array(data.length);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = data[j], g = data[j+1], b = data[j+2], a = data[j+3];
    out[j]   = g;
    out[j+1] = (r - g) & 0xff;
    out[j+2] = (b - g) & 0xff;
    out[j+3] = a;
  }
  return out;
}

function undoRCT_RGBA(data) {
  const n = data.length / 4;
  const out = new Uint8Array(data.length);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const y = data[j], cb = data[j+1], cr = data[j+2], a = data[j+3];
    out[j]   = (cb + y) & 0xff;
    out[j+1] = y;
    out[j+2] = (cr + y) & 0xff;
    out[j+3] = a;
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function applyFilter(type, cur, prev, bpp, out) {
  const len = cur.length;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const a = i >= bpp ? cur[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = (prev && i >= bpp) ? prev[i - bpp] : 0;
    const x = cur[i];
    let v;
    switch (type) {
      case 0: v = x; break;
      case 1: v = x - a; break;
      case 2: v = x - b; break;
      case 3: v = x - ((a + b) >> 1); break;
      default: v = x - paeth(a, b, c); break;
    }
    v &= 0xff; out[i] = v;
    sum += v < 128 ? v : 256 - v;
  }
  return sum;
}

function unfilterRow(type, cur, prev, bpp, out) {
  const len = cur.length;
  for (let i = 0; i < len; i++) {
    const a = i >= bpp ? out[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = (prev && i >= bpp) ? prev[i - bpp] : 0;
    const v = cur[i];
    let x;
    switch (type) {
      case 0: x = v; break;
      case 1: x = v + a; break;
      case 2: x = v + b; break;
      case 3: x = v + ((a + b) >> 1); break;
      case 4: x = v + paeth(a, b, c); break;
      default: throw new Error('bad filter ' + type);
    }
    out[i] = x & 0xff;
  }
}

function filterBytes(raw, width, bpp, height) {
  const expected = width * bpp * height;
  if (raw.length < expected) throw new Error(`filterBytes: raw ${raw.length} < expected ${expected}`);
  const rowBytes = width * bpp;
  const stride = rowBytes + 1;
  const out = new Uint8Array(stride * height);
  const tmp = new Uint8Array(rowBytes);
  const best = new Uint8Array(rowBytes);
  const curRow = new Uint8Array(rowBytes);
  const prevRow = new Uint8Array(rowBytes);
  let havePrev = false;
  for (let y = 0; y < height; y++) {
    const rs = y * rowBytes;
    curRow.set(raw.subarray(rs, rs + rowBytes));
    let bestScore = Infinity, bestType = 0;
    for (let t = 0; t <= 4; t++) {
      const s = applyFilter(t, curRow, havePrev ? prevRow : null, bpp, tmp);
      if (s < bestScore) { bestScore = s; bestType = t; best.set(tmp); }
    }
    const ro = y * stride;
    out[ro] = bestType;
    out.set(best, ro + 1);
    prevRow.set(curRow);
    havePrev = true;
  }
  return out;
}

function filterFixed(raw, width, bpp, height, filterType) {
  const rowBytes = width * bpp;
  const stride = rowBytes + 1;
  const out = new Uint8Array(stride * height);
  const tmp = new Uint8Array(rowBytes);
  const curRow = new Uint8Array(rowBytes);
  const prevRow = new Uint8Array(rowBytes);
  let havePrev = false;
  for (let y = 0; y < height; y++) {
    const rs = y * rowBytes;
    curRow.set(raw.subarray(rs, rs + rowBytes));
    applyFilter(filterType, curRow, havePrev ? prevRow : null, bpp, tmp);
    const ro = y * stride;
    out[ro] = filterType;
    out.set(tmp, ro + 1);
    prevRow.set(curRow);
    havePrev = true;
  }
  return out;
}

function filterNonePacked(packed, width, bitDepth, height) {
  const rowBytes = Math.ceil(width * bitDepth / 8);
  const stride = rowBytes + 1;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    out[y * stride] = 0;
    out.set(packed.subarray(y * rowBytes, (y + 1) * rowBytes), y * stride + 1);
  }
  return out;
}

function writeChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function buildPngz(ihdr, chunks) {
  let total = MAGIC.length + 12 + IHDR_SIZE;
  for (const c of chunks) total += 12 + c.data.length;
  const out = new Uint8Array(total);
  let o = 0;
  out.set(MAGIC, o); o += MAGIC.length;
  const ih = writeChunk('IHDR', ihdr);
  out.set(ih, o); o += ih.length;
  for (const c of chunks) {
    const ch = writeChunk(c.type, c.data);
    out.set(ch, o); o += ch.length;
  }
  return out;
}

function validChunkType(b, off) {
  for (let i = 0; i < 4; i++) {
    const c = b[off + i];
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return false;
  }
  return true;
}

function filteredSizeFor(width, height, colorType, bitDepth) {
  let rowBytes;
  switch (colorType) {
    case CT_PAL:   rowBytes = Math.ceil(width * bitDepth / 8); break;
    case CT_GRAY:  rowBytes = width; break;
    case CT_RGB:   rowBytes = width * 3; break;
    case CT_GRAYA: rowBytes = width * 2; break;
    case CT_RGBA:  rowBytes = width * 4; break;
    default: throw new Error('bad color type');
  }
  return (rowBytes + 1) * height;
}

function parsePngz(bytes) {
  const errors = [];
  const fail = (m) => errors.push(m);

  if (bytes.length < 8) { fail('file too small (' + bytes.length + ' bytes)'); throw new Error(errors.join(' | ')); }
  if (bytes.length > MAX_FILE_BYTES) fail('file too large: ' + bytes.length + ' > ' + MAX_FILE_BYTES);

  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== MAGIC[i]) { fail('bad magic byte ' + i + ': 0x' + bytes[i].toString(16)); break; }
  }

  let off = 8;
  let ihdr = null;
  const idat = [];
  let plte = null, alph = null;
  let sawIEND = false;
  let chunkCount = 0;
  let seenPLTE = false, seenALPH = false;

  while (off < bytes.length && !sawIEND) {
    chunkCount++;
    if (chunkCount > MAX_CHUNKS) { fail('too many chunks (>' + MAX_CHUNKS + ')'); break; }
    if (off + 12 > bytes.length) { fail('truncated chunk header at offset ' + off); break; }
    const dv = new DataView(bytes.buffer, bytes.byteOffset + off);
    const len = dv.getUint32(0);
    if (len > MAX_CHUNK_BYTES) fail('chunk too large: ' + len + ' > ' + MAX_CHUNK_BYTES);
    if (off + 12 + len > bytes.length) { fail('truncated chunk body at offset ' + off + ' (len=' + len + ')'); break; }
    if (!validChunkType(bytes, off + 4)) fail('invalid chunk type at offset ' + off);
    const type = String.fromCharCode(bytes[off+4], bytes[off+5], bytes[off+6], bytes[off+7]);
    const ds = off + 8;
    const de = ds + len;
    const stored = dv.getUint32(8 + len);
    const computed = crc32(bytes.subarray(off + 4, de));
    if (stored !== computed) fail('CRC mismatch in ' + type);
    const data = bytes.subarray(ds, de);

    if (type === 'IHDR') {
      if (ihdr) fail('duplicate IHDR');
      else if (len !== IHDR_SIZE) fail('IHDR must be ' + IHDR_SIZE + ' bytes, got ' + len);
      else ihdr = new Uint8Array(data);
    } else if (type === 'PLTE') {
      if (seenPLTE) fail('duplicate PLTE');
      seenPLTE = true;
      if (len === 0) fail('PLTE must not be empty');
      if (len % 4 !== 0) fail('PLTE length must be multiple of 4, got ' + len);
      if (len > MAX_PLTE_BYTES) fail('PLTE too large: ' + len + ' > ' + MAX_PLTE_BYTES);
      if (len % 4 === 0 && len > 0) plte = new Uint8Array(data);
    } else if (type === 'ALPH') {
      if (seenALPH) fail('duplicate ALPH');
      seenALPH = true;
      alph = new Uint8Array(data);
    } else if (type === 'IDAT') {
      if (idat.length >= MAX_IDAT_CHUNKS) fail('too many IDAT chunks');
      else idat.push(data);
    } else if (type === 'IEND') {
      if (len !== 0) fail('IEND must be empty, got ' + len + ' bytes');
      sawIEND = true;
    } else if ((bytes[off+4] & 0x20) === 0) {
      fail('unknown critical chunk ' + type);
    }
    off = de + 4;
  }

  if (!sawIEND) fail('missing IEND');
  if (!ihdr) fail('missing IHDR');
  if (!idat.length) fail('missing IDAT');

  if (!ihdr || !idat.length) throw new Error(errors.join(' | '));

  const iv = new DataView(ihdr.buffer, ihdr.byteOffset, IHDR_SIZE);
  const width = iv.getUint32(0);
  const height = iv.getUint32(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const flags = ihdr[10];
  const dictMode = ihdr[11];
  const dictHash = iv.getUint32(12);

  if (width === 0) fail('width is zero');
  if (height === 0) fail('height is zero');
  if (width > MAX_DIM) fail('width ' + width + ' > ' + MAX_DIM);
  if (height > MAX_DIM) fail('height ' + height + ' > ' + MAX_DIM);
  if (width > 0 && height > 0 && width * height > MAX_PIXELS) fail('pixel count ' + (width * height) + ' > ' + MAX_PIXELS);

  if (![0, 2, 3, 4, 6].includes(colorType)) fail('invalid color type ' + colorType);
  if (colorType === 3) {
    if (![1, 2, 4, 8].includes(bitDepth)) fail('invalid palette bit depth ' + bitDepth);
  } else {
    if (bitDepth !== 8) fail('invalid bit depth ' + bitDepth + ' for color type ' + colorType);
  }

  if (flags & ~(FLAG_ALPH | FLAG_RCT | FLAG_RAW)) fail('reserved flag bits set: 0x' + (flags & ~(FLAG_ALPH | FLAG_RCT | FLAG_RAW)).toString(16));
  if ((flags & FLAG_ALPH) && colorType !== CT_RGB) fail('ALPH flag set but color type is ' + colorType + ' (needs RGB)');
  if ((flags & FLAG_RCT) && (colorType !== CT_RGB && colorType !== CT_RGBA)) fail('RCT flag set but color type is ' + colorType + ' (needs RGB or RGBA)');
  if (dictMode > 1) fail('invalid dict mode ' + dictMode);
  if (dictMode === 1 && dictHash === 0) fail('dict used but hash is zero');
  if (dictMode === 0 && dictHash !== 0) fail('dict hash set but mode is zero: 0x' + dictHash.toString(16));
  if ((flags & FLAG_RAW) && dictMode === 1) fail('raw store cannot use dictionary');

  if (colorType !== CT_PAL && plte) fail('PLTE present but color type is ' + colorType);
  if (colorType === CT_PAL && !plte) fail('palette image missing PLTE');
  if (plte) {
    const n = plte.length / 4;
    if (bitDepth === 1 && n > 2) fail('too many palette colors (' + n + ') for 1-bit');
    if (bitDepth === 2 && n > 4) fail('too many palette colors (' + n + ') for 2-bit');
    if (bitDepth === 4 && n > 16) fail('too many palette colors (' + n + ') for 4-bit');
    if (n > 256) fail('palette has ' + n + ' colors (max 256)');
  }
  if (alph) {
    const expected = Math.ceil(width * height / 8);
    if (alph.length !== expected) fail('ALPH length ' + alph.length + ' != expected ' + expected);
    if (!(flags & FLAG_ALPH)) fail('ALPH present but flag not set');
  }
  if ((flags & FLAG_ALPH) && !alph) fail('ALPH flag set but ALPH chunk missing');

  let filteredSize = 0;
  try {
    filteredSize = filteredSizeFor(width, height, colorType, bitDepth);
    if (filteredSize > MAX_DECODED_BYTES) fail('decoded size ' + filteredSize + ' > ' + MAX_DECODED_BYTES);
  } catch (e) {
    fail('cannot compute filtered size: ' + e.message);
  }

  if (errors.length) throw new Error(errors.join(' | '));

  let idatData;
  if (idat.length === 1) idatData = idat[0];
  else {
    let total = 0;
    for (const p of idat) total += p.length;
    idatData = new Uint8Array(total);
    let o = 0;
    for (const p of idat) { idatData.set(p, o); o += p.length; }
  }

  return { width, height, bitDepth, colorType, flags, dictMode, dictHash, idatData, plte, alph };
}

function buildPalette(data, maxColors, byFrequency) {
  const n = data.length >> 2;
  if (byFrequency) {
    const counts = new Map();
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const key = ((data[j] << 24) | (data[j+1] << 16) | (data[j+2] << 8) | data[j+3]) >>> 0;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (counts.size > maxColors * 4) return null;
    }
    if (counts.size > maxColors) return null;
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const map = new Map();
    const palette = new Uint8Array(sorted.length * 4);
    for (let i = 0; i < sorted.length; i++) {
      map.set(sorted[i][0], i);
      palette[i*4]   = (sorted[i][0] >>> 24) & 0xff;
      palette[i*4+1] = (sorted[i][0] >>> 16) & 0xff;
      palette[i*4+2] = (sorted[i][0] >>> 8) & 0xff;
      palette[i*4+3] = sorted[i][0] & 0xff;
    }
    const indices = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const key = ((data[j] << 24) | (data[j+1] << 16) | (data[j+2] << 8) | data[j+3]) >>> 0;
      indices[i] = map.get(key);
    }
    return { palette, indices };
  }
  const map = new Map();
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const key = ((data[j] << 24) | (data[j+1] << 16) | (data[j+2] << 8) | data[j+3]) >>> 0;
    if (!map.has(key)) {
      if (map.size >= maxColors) return null;
      map.set(key, map.size);
    }
  }
  const palette = new Uint8Array(map.size * 4);
  for (const [key, idx] of map) {
    palette[idx*4]   = (key >>> 24) & 0xff;
    palette[idx*4+1] = (key >>> 16) & 0xff;
    palette[idx*4+2] = (key >>> 8) & 0xff;
    palette[idx*4+3] = key & 0xff;
  }
  const indices = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const key = ((data[j] << 24) | (data[j+1] << 16) | (data[j+2] << 8) | data[j+3]) >>> 0;
    indices[i] = map.get(key);
  }
  return { palette, indices };
}

function packIndicesRowPadded(indices, width, height, bitDepth) {
  if (bitDepth === 8) return indices;
  const rowBytes = Math.ceil(width * bitDepth / 8);
  const out = new Uint8Array(rowBytes * height);
  const ppb = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    const outStart = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const bi = outStart + Math.floor(x / ppb);
      const shift = (ppb - 1 - (x % ppb)) * bitDepth;
      out[bi] |= (indices[rowStart + x] & mask) << shift;
    }
  }
  return out;
}

function unpackIndicesRowPadded(packed, width, height, bitDepth) {
  if (bitDepth === 8) return packed.subarray(0, width * height);
  const out = new Uint8Array(width * height);
  const rowBytes = Math.ceil(width * bitDepth / 8);
  const ppb = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const bi = rowStart + Math.floor(x / ppb);
      const shift = (ppb - 1 - (x % ppb)) * bitDepth;
      out[y * width + x] = (packed[bi] >> shift) & mask;
    }
  }
  return out;
}

function paletteBitDepth(n) {
  if (n <= 2) return 1;
  if (n <= 4) return 2;
  if (n <= 16) return 4;
  return 8;
}

function makeIhdr(width, height, bitDepth, colorType, flags, dictMode, dictHash) {
  const ihdr = new Uint8Array(IHDR_SIZE);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = flags;
  ihdr[11] = dictMode;
  iv.setUint32(12, dictHash);
  return ihdr;
}

function buildFromCandidate(c, idatData, isRaw, width, height, dict) {
  const dictMode = (!isRaw && dict) ? 1 : 0;
  const dictHash = (!isRaw && dict) ? hashBytes(dict) : 0;
  const flags = c.flags | (isRaw ? FLAG_RAW : 0);
  const ihdr = makeIhdr(width, height, c.bitDepth, c.colorType, flags, dictMode, dictHash);
  const chunks = [];
  if (c.palette) chunks.push({ type: 'PLTE', data: c.palette });
  if (c.alphMask) chunks.push({ type: 'ALPH', data: c.alphMask });
  chunks.push({ type: 'IDAT', data: idatData });
  chunks.push({ type: 'IEND', data: new Uint8Array(0) });
  return buildPngz(ihdr, chunks);
}

function buildCandidates(data, width, height) {
  const nPixels = width * height;
  const candidates = [];

  const palFirst = buildPalette(data, 256, false);
  if (palFirst) {
    const nColors = palFirst.palette.length / 4;
    const bd = paletteBitDepth(nColors);
    const packed = bd === 8 ? palFirst.indices : packIndicesRowPadded(palFirst.indices, width, height, bd);
    candidates.push({
      name: `palette ${bd}-bit`,
      colorType: CT_PAL, bitDepth: bd, flags: 0, bpp: 1,
      raw: packed, palette: palFirst.palette, fixedFilter: 0,
    });
  }

  const palFreq = buildPalette(data, 256, true);
  if (palFreq) {
    const nColors = palFreq.palette.length / 4;
    const bd = paletteBitDepth(nColors);
    const packed = bd === 8 ? palFreq.indices : packIndicesRowPadded(palFreq.indices, width, height, bd);
    candidates.push({
      name: `palette-freq ${bd}-bit`,
      colorType: CT_PAL, bitDepth: bd, flags: 0, bpp: 1,
      raw: packed, palette: palFreq.palette, fixedFilter: 0,
    });
  }

  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) { if (data[i] !== 255) { hasAlpha = true; break; } }

  let isGray = true;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== data[i+1] || data[i] !== data[i+2]) { isGray = false; break; }
  }

  let binAlpha = false;
  if (hasAlpha) {
    binAlpha = true;
    for (let i = 3; i < data.length; i += 4) {
      const a = data[i];
      if (a !== 0 && a !== 255) { binAlpha = false; break; }
    }
  }

  if (isGray && !hasAlpha) {
    const g = new Uint8Array(nPixels);
    for (let i = 0; i < nPixels; i++) g[i] = data[i*4];
    candidates.push({ name: 'gray', colorType: CT_GRAY, bitDepth: 8, flags: 0, bpp: 1, raw: g, palette: null, fixedFilter: -1 });
  }

  if (isGray && hasAlpha && !binAlpha) {
    const ga = new Uint8Array(nPixels * 2);
    for (let i = 0; i < nPixels; i++) { ga[i*2] = data[i*4]; ga[i*2+1] = data[i*4+3]; }
    candidates.push({ name: 'gray+alpha', colorType: CT_GRAYA, bitDepth: 8, flags: 0, bpp: 2, raw: ga, palette: null, fixedFilter: -1 });
  }

  if (!hasAlpha) {
    const rgb = new Uint8Array(nPixels * 3);
    for (let i = 0; i < nPixels; i++) { rgb[i*3] = data[i*4]; rgb[i*3+1] = data[i*4+1]; rgb[i*3+2] = data[i*4+2]; }
    candidates.push({ name: 'rgb', colorType: CT_RGB, bitDepth: 8, flags: 0, bpp: 3, raw: rgb, palette: null, fixedFilter: -1 });
    candidates.push({ name: 'rgb+rct', colorType: CT_RGB, bitDepth: 8, flags: FLAG_RCT, bpp: 3, raw: applyRCT_RGB(rgb), palette: null, fixedFilter: -1 });
  }

  if (hasAlpha && binAlpha) {
    const rgb = new Uint8Array(nPixels * 3);
    for (let i = 0; i < nPixels; i++) { rgb[i*3] = data[i*4]; rgb[i*3+1] = data[i*4+1]; rgb[i*3+2] = data[i*4+2]; }
    const mask = new Uint8Array(Math.ceil(nPixels / 8));
    for (let i = 0; i < nPixels; i++) { if (data[i*4+3] === 255) mask[i >> 3] |= (0x80 >> (i & 7)); }
    candidates.push({ name: 'rgb+bin-alpha', colorType: CT_RGB, bitDepth: 8, flags: FLAG_ALPH, bpp: 3, raw: rgb, palette: null, alphMask: mask, fixedFilter: -1 });
  }

  if (hasAlpha && !binAlpha) {
    const rgba = new Uint8Array(nPixels * 4);
    rgba.set(data.subarray(0, nPixels * 4));
    candidates.push({ name: 'rgba', colorType: CT_RGBA, bitDepth: 8, flags: 0, bpp: 4, raw: rgba, palette: null, fixedFilter: -1 });
    candidates.push({ name: 'rgba+rct', colorType: CT_RGBA, bitDepth: 8, flags: FLAG_RCT, bpp: 4, raw: applyRCT_RGBA(rgba), palette: null, fixedFilter: -1 });
  }

  return candidates;
}

function compressCandidate(c, level, dict, longRange) {
  const filtered = c.fixedFilter === 0
    ? filterNonePacked(c.raw, c._w, c.bitDepth, c._h)
    : filterBytes(c.raw, c._w, c.bpp, c._h);
  const compressed = zstd.compress(filtered, level, dict, longRange);
  if (compressed.length >= filtered.length) {
    return { idat: filtered, isRaw: true, filteredLen: filtered.length, compressedLen: compressed.length };
  }
  return { idat: compressed, isRaw: false, filteredLen: filtered.length, compressedLen: compressed.length };
}

function encodeStandard(imageData, level, dict, longRange) {
  const { data, width, height } = imageData;
  const nPixels = width * height;
  if (data.length < nPixels * 4) throw new Error('imageData too small');

  const candidates = buildCandidates(data, width, height);
  if (!candidates.length) throw new Error('no valid encoding candidate');

  for (const c of candidates) { c._w = width; c._h = height; }

  let best = null;
  for (const c of candidates) {
    const { idat, isRaw } = compressCandidate(c, level, dict, longRange);
    const bytes = buildFromCandidate(c, idat, isRaw, width, height, dict);
    const tag = isRaw ? ' · raw' : '';
    if (!best || bytes.length < best.bytes.length) {
      best = { bytes, name: c.name + ' · perRow' + tag, dictMode: (!isRaw && dict) ? 1 : 0 };
    }
  }
  return { bytes: best.bytes, strategy: best.name, dictMode: best.dictMode };
}

function encodeOptimized(imageData, level, dict, longRange, onProgress) {
  const { data, width, height } = imageData;
  const nPixels = width * height;
  if (data.length < nPixels * 4) throw new Error('imageData too small');

  if (onProgress) onProgress('palette');
  const candidates = buildCandidates(data, width, height);
  if (!candidates.length) throw new Error('no valid encoding candidate');

  for (const c of candidates) { c._w = width; c._h = height; }

  const filterModes = [0, 1, 2, 3, 4, 'perRow'];
  let best = null;
  let totalSteps = 0;
  for (const c of candidates) totalSteps += c.fixedFilter === 0 ? 1 : filterModes.length;
  let step = 0;

  for (const c of candidates) {
    const modes = c.fixedFilter === 0 ? [0] : filterModes;
    for (const fm of modes) {
      step++;
      if (onProgress) onProgress('filter', `${step}/${totalSteps}`);
      let filtered;
      if (fm === 'perRow') filtered = filterBytes(c.raw, width, c.bpp, height);
      else if (c.fixedFilter === 0) filtered = filterNonePacked(c.raw, width, c.bitDepth, height);
      else filtered = filterFixed(c.raw, width, c.bpp, height, fm);

      if (onProgress) onProgress('compress', `${step}/${totalSteps}`);
      const compressed = zstd.compress(filtered, level, dict, longRange);

      let idat = compressed, isRaw = false;
      if (compressed.length >= filtered.length) { idat = filtered; isRaw = true; }

      const bytes = buildFromCandidate(c, idat, isRaw, width, height, dict);
      const tag = isRaw ? ' · raw' : '';
      if (!best || bytes.length < best.bytes.length) {
        best = {
          bytes,
          name: `${c.name} · ${fm === 'perRow' ? 'perRow' : 'f' + fm}${tag}`,
          dictMode: (!isRaw && dict) ? 1 : 0,
        };
      }
    }
  }
  return { bytes: best.bytes, strategy: best.name, dictMode: best.dictMode };
}

function decodePngzToImageData(bytes, dict) {
  const { width, height, bitDepth, colorType, flags, dictMode, dictHash, idatData, plte, alph } = parsePngz(bytes);

  if (dictMode === 1) {
    if (!dict) throw new Error('this file needs a dictionary (none loaded)');
    if (hashBytes(dict) !== dictHash) throw new Error('dictionary mismatch');
  }

  const expected = filteredSizeFor(width, height, colorType, bitDepth);
  if (expected > MAX_DECODED_BYTES) throw new Error('decoded size exceeds limit');

  const isRaw = (flags & FLAG_RAW) !== 0;
  let raw;
  if (isRaw) {
    if (idatData.length !== expected) throw new Error('raw IDAT size mismatch: ' + idatData.length + ' != ' + expected);
    raw = idatData;
  } else {
    raw = zstd.decompress(idatData, expected, dictMode === 1 ? dict : null);
    if (raw.length < expected) throw new Error('decompressed data short');
  }

  let rowBytes;
  switch (colorType) {
    case CT_PAL:   rowBytes = Math.ceil(width * bitDepth / 8); break;
    case CT_GRAY:  rowBytes = width; break;
    case CT_RGB:   rowBytes = width * 3; break;
    case CT_GRAYA: rowBytes = width * 2; break;
    case CT_RGBA:  rowBytes = width * 4; break;
    default: throw new Error('bad color type');
  }
  const stride = rowBytes + 1;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const rowBuf = new Uint8Array(rowBytes);
  const prevRow = new Uint8Array(rowBytes);
  let havePrev = false;
  const nPixels = width * height;

  if (colorType === CT_PAL) {
    const nColors = plte ? plte.length / 4 : 0;
    const indexBytes = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      const ro = y * stride;
      if (raw[ro] !== 0) throw new Error('palette rows must use filter 0');
      indexBytes.set(raw.subarray(ro + 1, ro + stride), y * rowBytes);
    }
    const indices = bitDepth === 8
      ? indexBytes.subarray(0, nPixels)
      : unpackIndicesRowPadded(indexBytes, width, height, bitDepth);
    for (let i = 0; i < nPixels; i++) {
      const idx = indices[i];
      if (idx >= nColors) throw new Error('palette index out of range');
      rgba[i*4]   = plte[idx*4];
      rgba[i*4+1] = plte[idx*4+1];
      rgba[i*4+2] = plte[idx*4+2];
      rgba[i*4+3] = plte[idx*4+3];
    }
    return new ImageData(rgba, width, height);
  }

  const bpp = colorType === CT_RGBA ? 4 : colorType === CT_RGB ? 3 : colorType === CT_GRAYA ? 2 : 1;
  const hasRCT = (flags & FLAG_RCT) !== 0;

  const colorBuf = hasRCT && (colorType === CT_RGB || colorType === CT_RGBA)
    ? new Uint8Array(rowBytes * height)
    : null;

  for (let y = 0; y < height; y++) {
    const ro = y * stride;
    const ft = raw[ro];
    if (ft > 4) throw new Error('invalid filter type');
    const slice = raw.subarray(ro + 1, ro + stride);
    unfilterRow(ft, slice, havePrev ? prevRow : null, bpp, rowBuf);
    if (colorBuf) colorBuf.set(rowBuf, y * rowBytes);
    else {
      const dst = y * width * 4;
      if (colorType === CT_RGB) {
        const hasAlphChunk = (flags & FLAG_ALPH) !== 0;
        for (let x = 0; x < width; x++) {
          rgba[dst + x*4]   = rowBuf[x*3];
          rgba[dst + x*4+1] = rowBuf[x*3+1];
          rgba[dst + x*4+2] = rowBuf[x*3+2];
          if (hasAlphChunk) {
            const pi = y * width + x;
            rgba[dst + x*4+3] = (alph[pi >> 3] & (0x80 >> (pi & 7))) ? 255 : 0;
          } else {
            rgba[dst + x*4+3] = 255;
          }
        }
      } else if (colorType === CT_RGBA) {
        rgba.set(rowBuf, dst);
      } else if (colorType === CT_GRAY) {
        for (let x = 0; x < width; x++) {
          const g = rowBuf[x];
          rgba[dst + x*4] = g; rgba[dst + x*4+1] = g; rgba[dst + x*4+2] = g; rgba[dst + x*4+3] = 255;
        }
      } else if (colorType === CT_GRAYA) {
        for (let x = 0; x < width; x++) {
          const g = rowBuf[x*2], a = rowBuf[x*2+1];
          rgba[dst + x*4] = g; rgba[dst + x*4+1] = g; rgba[dst + x*4+2] = g; rgba[dst + x*4+3] = a;
        }
      }
    }
    prevRow.set(rowBuf);
    havePrev = true;
  }

  if (colorBuf) {
    const restored = colorType === CT_RGB ? undoRCT_RGB(colorBuf) : undoRCT_RGBA(colorBuf);
    if (colorType === CT_RGB) {
      const hasAlphChunk = (flags & FLAG_ALPH) !== 0;
      for (let y = 0; y < height; y++) {
        const dst = y * width * 4;
        const rs = y * width * 3;
        for (let x = 0; x < width; x++) {
          rgba[dst + x*4]   = restored[rs + x*3];
          rgba[dst + x*4+1] = restored[rs + x*3 + 1];
          rgba[dst + x*4+2] = restored[rs + x*3 + 2];
          if (hasAlphChunk) {
            const pi = y * width + x;
            rgba[dst + x*4+3] = (alph[pi >> 3] & (0x80 >> (pi & 7))) ? 255 : 0;
          } else {
            rgba[dst + x*4+3] = 255;
          }
        }
      }
    } else {
      rgba.set(restored);
    }
  }

  return new ImageData(rgba, width, height);
}

function extractFilteredBytes(imageData) {
  const { data, width, height } = imageData;
  const nPixels = width * height;
  if (data.length < nPixels * 4) throw new Error('imageData too small');
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) { if (data[i] !== 255) { hasAlpha = true; break; } }

  const palResult = buildPalette(data, 256, false);
  if (palResult) {
    const nColors = palResult.palette.length / 4;
    const bd = paletteBitDepth(nColors);
    const packed = bd === 8 ? palResult.indices : packIndicesRowPadded(palResult.indices, width, height, bd);
    return bd === 8 ? filterBytes(packed, width, 1, height) : filterNonePacked(packed, width, bd, height);
  }

  let isGray = true;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== data[i+1] || data[i] !== data[i+2]) { isGray = false; break; }
  }
  if (isGray && !hasAlpha) {
    const g = new Uint8Array(nPixels);
    for (let i = 0; i < nPixels; i++) g[i] = data[i*4];
    return filterBytes(g, width, 1, height);
  }
  if (!hasAlpha) {
    const rgb = new Uint8Array(nPixels * 3);
    for (let i = 0; i < nPixels; i++) {
      rgb[i*3] = data[i*4]; rgb[i*3+1] = data[i*4+1]; rgb[i*3+2] = data[i*4+2];
    }
    return filterBytes(applyRCT_RGB(rgb), width, 3, height);
  }
  const rgba = new Uint8Array(nPixels * 4);
  rgba.set(data.subarray(0, nPixels * 4));
  return filterBytes(applyRCT_RGBA(rgba), width, 4, height);
}

async function boot() {
  const Module = await createZstd();
  zstd = makeZstd(Module);
  self.postMessage({ type: 'ready', hasLong: zstd.hasLong });
}

boot().catch((e) => {
  self.postMessage({ type: 'error', id: 0, message: 'zstd init failed: ' + (e?.message || e) });
});

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'encode') {
      if (!Number.isFinite(msg.width) || !Number.isFinite(msg.height) ||
          msg.width <= 0 || msg.height <= 0 ||
          msg.width > MAX_DIM || msg.height > MAX_DIM ||
          msg.width * msg.height > MAX_PIXELS) {
        throw new Error('invalid dimensions');
      }
      const expected = msg.width * msg.height * 4;
      if (msg.pixels.byteLength !== expected) throw new Error('pixel buffer size mismatch');
      const pixels = new Uint8ClampedArray(msg.pixels);
      const imageData = new ImageData(pixels, msg.width, msg.height);
      const dict = msg.dict ? new Uint8Array(msg.dict) : null;
      if (dict && dict.length > MAX_CHUNK_BYTES) throw new Error('dictionary too large');
      const longRange = !!msg.longRange;
      const onProgress = (stage, info) => self.postMessage({ type: 'progress', id: msg.id, stage, info });
      let res;
      if (msg.optimize) {
        onProgress('search');
        res = encodeOptimized(imageData, msg.level, dict, longRange, onProgress);
      } else {
        onProgress('filter');
        res = encodeStandard(imageData, msg.level, dict, longRange);
      }
      onProgress('verify');
      const tDec0 = performance.now();
      const decoded = decodePngzToImageData(res.bytes, res.dictMode === 1 ? dict : null);
      const decodeTime = performance.now() - tDec0;
      self.postMessage({
        type: 'encoded',
        id: msg.id,
        bytes: res.bytes.buffer,
        pixels: decoded.data.buffer,
        width: decoded.width,
        height: decoded.height,
        strategy: res.strategy,
        dictMode: res.dictMode,
        decodeTime,
      }, [res.bytes.buffer, decoded.data.buffer]);
    }
    else if (msg.type === 'decode') {
      const bytes = new Uint8Array(msg.bytes);
      if (bytes.length > MAX_FILE_BYTES) throw new Error('file too large');
      const dict = msg.dict ? new Uint8Array(msg.dict) : null;
      const decoded = decodePngzToImageData(bytes, dict);
      self.postMessage({
        type: 'decoded',
        id: msg.id,
        pixels: decoded.data.buffer,
        width: decoded.width,
        height: decoded.height,
      }, [decoded.data.buffer]);
    }
    else if (msg.type === 'extractFiltered') {
      if (!Number.isFinite(msg.width) || !Number.isFinite(msg.height) ||
          msg.width <= 0 || msg.height <= 0 ||
          msg.width > MAX_DIM || msg.height > MAX_DIM ||
          msg.width * msg.height > MAX_PIXELS) {
        throw new Error('invalid dimensions');
      }
      const expected = msg.width * msg.height * 4;
      if (msg.pixels.byteLength !== expected) throw new Error('pixel buffer size mismatch');
      const pixels = new Uint8ClampedArray(msg.pixels);
      const imageData = new ImageData(pixels, msg.width, msg.height);
      const filtered = extractFilteredBytes(imageData);
      self.postMessage({ type: 'filtered', id: msg.id, bytes: filtered.buffer }, [filtered.buffer]);
    }
    else if (msg.type === 'train') {
      if (!Array.isArray(msg.samples) || !msg.samples.length) throw new Error('no samples');
      if (msg.samples.length > 4096) throw new Error('too many samples');
      let total = 0;
      for (const s of msg.samples) {
        if (!(s instanceof ArrayBuffer)) throw new Error('bad sample');
        total += s.byteLength;
        if (total > 256 * 1024 * 1024) throw new Error('samples too large');
      }
      const samples = msg.samples.map((b) => new Uint8Array(b));
      self.postMessage({ type: 'progress', id: msg.id, stage: 'train' });
      const dict = zstd.trainDict(samples, msg.maxSize || 110000);
      self.postMessage({ type: 'trained', id: msg.id, dict: dict.buffer }, [dict.buffer]);
    }
    else {
      throw new Error('unknown request ' + msg.type);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err.message || String(err) });
  }
};
