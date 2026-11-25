STREETSENSE — CITIZEN REPORT EXIF GPS PATCH

This patch is tailored to the uploaded StreetSense project.

FILES
- server.js: updated citizen complaint upload route. When the citizen has not entered latitude/longitude, it reads GPS metadata from the uploaded image before saving the complaint.
- geotag-exif.js: dependency-free EXIF GPS reader for JPEG, PNG eXIf chunks, and WebP EXIF chunks.

INSTALLATION
1. Stop the StreetSense Node.js server.
2. Make a backup copy of your current server.js.
3. Extract this ZIP directly into the same project root folder that contains your current server.js.
4. Allow the patched server.js to replace the old server.js. Make sure geotag-exif.js is placed beside server.js (not in a subfolder).
5. Start StreetSense again using your usual command.
6. Hard-refresh the website (Ctrl+F5) and submit a NEW citizen report with the original geotagged image.

BEHAVIOUR
- Coordinates manually entered in the report form take precedence.
- If both coordinate fields are empty, embedded image GPS is used when present.
- If the image has no supported GPS metadata, the report remains without a map pin; use the website's location controls or enter coordinates manually.
- Existing reports are not modified. Submit a new report to test the patch.
- Supported upload MIME types remain image/jpeg, image/png, and image/webp.

NOTES
- The image must contain actual GPS metadata. A location written in its filename or description is not enough.
- Some image editors and messaging apps remove metadata when exporting or compressing images. Test with the original geotagged file.
- The patch does not add or change database tables; it stores coordinates in the existing complaint record fields.
