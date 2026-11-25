#!/bin/sh
# Daily backup of the database and uploaded photos/videos. Run from cron as the streetsense user.
# Needs:  sudo apt install sqlite3
set -e
APP=/opt/streetsense
OUT=/var/backups/streetsense
mkdir -p "$OUT"
STAMP=$(date +%F-%H%M)
sqlite3 "$APP/data/streetsense.sqlite" ".backup '$OUT/streetsense-$STAMP.sqlite'"
tar -czf "$OUT/files-$STAMP.tar.gz" -C "$APP/data" evidence video 2>/dev/null || true
find "$OUT" -type f -mtime +14 -delete
