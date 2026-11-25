# StreetSense EXIF geotagging patch (JPEG + PNG + WebP)

## What this patch adds
- Reads embedded GPS coordinates from JPEG EXIF metadata, PNG eXIf chunks, and WebP EXIF chunks locally in the browser.
- Uses photo EXIF coordinates first in the Operations evidence-upload workflow.
- Falls back to the existing browser/device GPS workflow when the photo has no readable GPS metadata.
- In the Scan page, automatically places the map pin from photo EXIF only when no coordinates have already been entered. The existing GPS button and manual map pin remain available.
- Sends coordinates through the existing `/api/evidence` endpoint. The existing server already validates and stores `lat` and `lng` in the evidence table.

## Install
1. Stop the StreetSense server completely.
2. Make a backup copy of these existing files: `app.js`, `scan.js`, `operations.html`, and `scan.html`.
3. Extract this patch ZIP into the same StreetSense project folder, preserving the folder structure, and choose **Replace** for the four updated files.
4. Copy the new `geotag.js` into the project root.
5. Start the server again and hard-refresh the browser (Ctrl+F5).

## Notes
- This patch does not alter the database schema or overwrite `server.js`, `insights.js`, or `backend-client.js`.
- GPS is extracted only when the uploaded image actually contains supported EXIF GPS metadata. PNG/WebP files often have no GPS metadata, and some editors or messaging/social apps strip it.
- JPEG, PNG, and WebP remain accepted image formats. If GPS metadata is missing or unreadable, use the existing browser GPS permission flow, the Scan page's **Use my GPS** button, or manually place the map pin.
- A photo's EXIF location is the place recorded when the photo was taken; confirm the pin before treating it as the defect's exact location.
