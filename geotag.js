/* StreetSense EXIF GPS reader.
 * Supports JPEG APP1 EXIF, PNG eXIf chunks, and WebP EXIF chunks.
 * Reads locally in the browser; image data is not sent to a third party.
 */
(() => {
  'use strict';

  function parseTiff(view, start, end) {
    if (start + 8 > end) return null;
    // Some WebP files include the optional "Exif\\0\\0" identifier.
    if (start + 6 <= end &&
        view.getUint8(start) === 0x45 && view.getUint8(start + 1) === 0x78 &&
        view.getUint8(start + 2) === 0x69 && view.getUint8(start + 3) === 0x66 &&
        view.getUint8(start + 4) === 0 && view.getUint8(start + 5) === 0) start += 6;

    if (start + 8 > end) return null;
    const order = view.getUint16(start, false);
    const little = order === 0x4949;
    if (!little && order !== 0x4D4D) return null;

    const u16 = p => (p + 2 <= end ? view.getUint16(p, little) : NaN);
    const u32 = p => (p + 4 <= end ? view.getUint32(p, little) : NaN);
    if (u16(start + 2) !== 42) return null;

    const ifdOffset = u32(start + 4);
    if (!Number.isFinite(ifdOffset)) return null;
    const ifd0 = start + ifdOffset;
    if (ifd0 + 2 > end) return null;
    const count = u16(ifd0);
    let gpsOffset = 0;

    for (let i = 0; i < count; i++) {
      const entry = ifd0 + 2 + i * 12;
      if (entry + 12 > end) return null;
      if (u16(entry) === 0x8825) {
        gpsOffset = u32(entry + 8);
        break;
      }
    }
    if (!gpsOffset) return null;

    const gps = start + gpsOffset;
    if (gps + 2 > end) return null;
    const gpsCount = u16(gps);
    const tags = {};

    for (let i = 0; i < gpsCount; i++) {
      const entry = gps + 2 + i * 12;
      if (entry + 12 > end) return null;
      const tag = u16(entry), type = u16(entry + 2), items = u32(entry + 4);
      const typeSize = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 })[type];
      if (!typeSize || !Number.isFinite(items)) continue;
      const bytes = typeSize * items;
      const data = bytes <= 4 ? entry + 8 : start + u32(entry + 8);
      if (!Number.isFinite(data) || data < start || data + bytes > end) continue;

      if (tag === 1 || tag === 3) {
        tags[tag] = String.fromCharCode(view.getUint8(data)).toUpperCase();
      } else if ((tag === 2 || tag === 4) && type === 5 && items >= 3) {
        tags[tag] = [0, 1, 2].map(k => {
          const p = data + k * 8;
          const denominator = u32(p + 4);
          return denominator ? u32(p) / denominator : NaN;
        });
      }
    }

    const convert = (values, ref, positive, negative) => {
      if (!values || values.length !== 3 || !values.every(Number.isFinite)) return null;
      const decimal = values[0] + values[1] / 60 + values[2] / 3600;
      return ref === positive ? decimal : ref === negative ? -decimal : null;
    };

    const lat = convert(tags[2], tags[1], 'N', 'S');
    const lng = convert(tags[4], tags[3], 'E', 'W');
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng, source: 'photo_exif' };
  }

  function findJpegExif(view) {
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xFF) break;
      const marker = view.getUint8(offset + 1);
      if (marker === 0xDA || marker === 0xD9) break;
      const length = view.getUint16(offset + 2, false);
      if (length < 2 || offset + 2 + length > view.byteLength) break;

      if (marker === 0xE1 && length >= 8 &&
          view.getUint8(offset + 4) === 0x45 && view.getUint8(offset + 5) === 0x78 &&
          view.getUint8(offset + 6) === 0x69 && view.getUint8(offset + 7) === 0x66 &&
          view.getUint8(offset + 8) === 0 && view.getUint8(offset + 9) === 0) {
        return parseTiff(view, offset + 10, offset + 2 + length);
      }
      offset += 2 + length;
    }
    return null;
  }

  function findPngExif(view) {
    // PNG signature, then length(4), type(4), data(length), CRC(4).
    let offset = 8;
    while (offset + 12 <= view.byteLength) {
      const length = view.getUint32(offset, false);
      const typeOffset = offset + 4;
      const dataOffset = offset + 8;
      const next = dataOffset + length + 4;
      if (next > view.byteLength || next < offset) break;

      const isExif = view.getUint8(typeOffset) === 0x65 && // e
        view.getUint8(typeOffset + 1) === 0x58 && // X
        view.getUint8(typeOffset + 2) === 0x49 && // I
        view.getUint8(typeOffset + 3) === 0x66;   // f
      if (isExif) return parseTiff(view, dataOffset, dataOffset + length);

      // IEND
      if (view.getUint8(typeOffset) === 0x49 &&
          view.getUint8(typeOffset + 1) === 0x45 &&
          view.getUint8(typeOffset + 2) === 0x4E &&
          view.getUint8(typeOffset + 3) === 0x44) break;
      offset = next;
    }
    return null;
  }

  function findWebpExif(view) {
    // RIFF....WEBP, followed by padded chunks.
    let offset = 12;
    while (offset + 8 <= view.byteLength) {
      const type = String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1),
        view.getUint8(offset + 2), view.getUint8(offset + 3)
      );
      const length = view.getUint32(offset + 4, true);
      const dataOffset = offset + 8;
      const next = dataOffset + length + (length & 1);
      if (next > view.byteLength || next < offset) break;
      if (type === 'EXIF') return parseTiff(view, dataOffset, dataOffset + length);
      offset = next;
    }
    return null;
  }

  function readExifGPS(file) {
    if (!file || typeof file.arrayBuffer !== 'function') return Promise.resolve(null);
    const allowed = /^(image\/(jpeg|jpg|png|webp))$/i.test(file.type || '');
    if (!allowed) return Promise.resolve(null);

    return file.arrayBuffer().then(buffer => {
      const view = new DataView(buffer);
      if (view.byteLength < 12) return null;

      // JPEG: FF D8
      if (view.getUint8(0) === 0xFF && view.getUint8(1) === 0xD8) {
        return findJpegExif(view);
      }

      // PNG: 89 50 4E 47 0D 0A 1A 0A
      if (view.getUint8(0) === 0x89 && view.getUint8(1) === 0x50 &&
          view.getUint8(2) === 0x4E && view.getUint8(3) === 0x47) {
        return findPngExif(view);
      }

      // WebP: RIFF....WEBP
      if (view.getUint8(0) === 0x52 && view.getUint8(1) === 0x49 &&
          view.getUint8(2) === 0x46 && view.getUint8(3) === 0x46 &&
          view.getUint8(8) === 0x57 && view.getUint8(9) === 0x45 &&
          view.getUint8(10) === 0x42 && view.getUint8(11) === 0x50) {
        return findWebpExif(view);
      }
      return null;
    }).catch(() => null);
  }

  window.StreetSenseGeo = Object.freeze({ readExifGPS });
})();
