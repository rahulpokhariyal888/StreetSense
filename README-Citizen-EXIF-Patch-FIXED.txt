STREETSENSE CITIZEN REPORT EXIF GEOTAGGING PATCH (FIXED)

Why the earlier patch failed:
The previous server.js declared lat and lng with const, then attempted to assign
the coordinates extracted from the image. That caused an assignment error.
This fixed version declares them with let and validates the final coordinates
after EXIF extraction.

Install:
1. Stop the StreetSense Node server.
2. Back up your current server.js.
3. Extract both files in this ZIP into the same project root folder as server.js.
4. Replace server.js with the included version.
5. Add geotag-exif.js beside server.js.
6. Restart the server.
7. Submit a NEW Citizen Report with the original geotagged image.

No change to portal.js is required: it already uploads the original image bytes
as base64 with the correct MIME type. The backend extracts GPS from those bytes.

Supported metadata containers:
- JPEG EXIF
- PNG eXIf chunk
- WebP EXIF chunk

Notes:
- The image must actually contain GPSLatitude/GPSLongitude metadata.
- If coordinates are manually entered, those values take priority.
- Existing reports are not retroactively changed.
- Keep a backup of your current server.js before replacing it.
