'use strict';

// Minimal, dependency-free EXIF GPS reader for JPEG, PNG eXIf and WebP EXIF.
// Returns decimal-degree coordinates or null. Does not alter the uploaded image.
function extractImageGps(input, mimeType) {
  try {
    const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
    let tiff = null;
    if (mimeType === 'image/jpeg' || (b[0] === 0xff && b[1] === 0xd8)) {
      tiff = findJpegExif(b);
    } else if (mimeType === 'image/png' || (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))) {
      tiff = findPngExif(b);
    } else if (mimeType === 'image/webp' || (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP')) {
      tiff = findWebpExif(b);
    }
    if (!tiff) return null;
    return parseTiffGps(tiff);
  } catch (_) {
    return null;
  }
}

function stripExifPrefix(b) {
  if (b.length >= 6 && b.toString('ascii', 0, 6) === 'Exif\0\0') return b.subarray(6);
  return b;
}

function findJpegExif(b) {
  let p = 2;
  while (p + 4 <= b.length && b[p] === 0xff) {
    while (p < b.length && b[p] === 0xff) p++;
    if (p >= b.length) break;
    const marker = b[p++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (p + 2 > b.length) break;
    const len = b.readUInt16BE(p);
    if (len < 2 || p + len > b.length) break;
    const start = p + 2, end = p + len;
    if (marker === 0xe1 && end - start >= 6 && b.toString('ascii', start, start + 6) === 'Exif\0\0') return b.subarray(start + 6, end);
    p = end;
  }
  return null;
}

function findPngExif(b) {
  let p = 8;
  while (p + 12 <= b.length) {
    const len = b.readUInt32BE(p);
    if (len > b.length - p - 12) break;
    const type = b.toString('ascii', p + 4, p + 8);
    if (type === 'eXIf') return b.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return null;
}

function findWebpExif(b) {
  let p = 12;
  while (p + 8 <= b.length) {
    const type = b.toString('ascii', p, p + 4);
    const len = b.readUInt32LE(p + 4);
    if (len > b.length - p - 8) break;
    if (type === 'EXIF') return stripExifPrefix(b.subarray(p + 8, p + 8 + len));
    p += 8 + len + (len & 1);
  }
  return null;
}

function parseTiffGps(t) {
  if (!t || t.length < 8) return null;
  const order = t.toString('ascii', 0, 2);
  const le = order === 'II';
  if (!le && order !== 'MM') return null;
  const u16 = o => { if (o < 0 || o + 2 > t.length) throw new Error('bounds'); return le ? t.readUInt16LE(o) : t.readUInt16BE(o); };
  const u32 = o => { if (o < 0 || o + 4 > t.length) throw new Error('bounds'); return le ? t.readUInt32LE(o) : t.readUInt32BE(o); };
  if (u16(2) !== 42) return null;
  const ifd0 = u32(4);
  const gpsPtr = findTag(ifd0, 0x8825, 4);
  if (!gpsPtr) return null;
  const gpsIfd = gpsPtr.value;
  const latRef = findTag(gpsIfd, 1, 2);
  const latVal = findTag(gpsIfd, 2, 5);
  const lonRef = findTag(gpsIfd, 3, 2);
  const lonVal = findTag(gpsIfd, 4, 5);
  if (!latRef || !latVal || !lonRef || !lonVal) return null;
  const lat = dms(latVal), lon = dms(lonVal);
  const lr = readAscii(latRef), or = readAscii(lonRef);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const signedLat = lr === 'S' ? -lat : lat;
  const signedLon = or === 'W' ? -lon : lon;
  if (Math.abs(signedLat) > 90 || Math.abs(signedLon) > 180) return null;
  return { lat: signedLat, lng: signedLon };

  function findTag(ifdOffset, wanted, expectedType) {
    const count = u16(ifdOffset);
    if (count > 512) return null;
    for (let i = 0; i < count; i++) {
      const e = ifdOffset + 2 + i * 12;
      if (e + 12 > t.length) return null;
      if (u16(e) !== wanted) continue;
      const type = u16(e + 2), n = u32(e + 4), raw = u32(e + 8);
      if (type !== expectedType) return null;
      const unit = type === 5 ? 8 : type === 4 ? 4 : type === 2 ? 1 : 0;
      if (!unit || n < 1 || n > 16) return null;
      const valueOffset = n * unit <= 4 ? e + 8 : raw;
      if (valueOffset < 0 || valueOffset + n * unit > t.length) return null;
      return { value: type === 4 ? raw : valueOffset, count: n };
    }
    return null;
  }
  function dms(tag) {
    const vals = [];
    for (let i = 0; i < 3; i++) {
      const o = tag.value + i * 8;
      const num = u32(o), den = u32(o + 4);
      if (!den) return NaN;
      vals.push(num / den);
    }
    return vals[0] + vals[1] / 60 + vals[2] / 3600;
  }
  function readAscii(tag) {
    return t.toString('ascii', tag.value, tag.value + tag.count).replace(/\0/g, '').trim().toUpperCase();
  }
}

module.exports = extractImageGps;
