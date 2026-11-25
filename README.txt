StreetSense EXIF Geotagging Update
=================================

Contents
--------
1. complaints-route.js.txt
   Replacement code for the POST /api/complaints route in server.js.

2. geotag-exif.js
   The EXIF GPS reader supplied for this project.

IMPORTANT
---------
This is a PATCH ZIP, not a full replacement server.js. Your complete server.js
was pasted into chat but was not uploaded as a file, so this package does not
reconstruct or replace the rest of your backend.

Apply it
--------
1. Back up your current server.js.
2. Open server.js in your project folder.
3. Find the existing block beginning:
      if (req.method === 'POST' && p === '/api/complaints') {
4. Replace that entire route block, up to (but not including) the next
   GET /api/complaints route, with the contents of complaints-route.js.txt.
5. Ensure geotag-exif.js is in the same folder as server.js.
6. Save and restart:
      node server.js

Test
----
Submit a new Citizen Report with a GPS-tagged JPEG and leave the latitude and
longitude fields blank. Watch the server terminal for [GEOTAG] messages.

The GPS helper reads embedded EXIF coordinates. It cannot recover GPS if an
app or image editor removed the metadata before upload.
