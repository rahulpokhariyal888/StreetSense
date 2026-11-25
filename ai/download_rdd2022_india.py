#!/usr/bin/env python3
"""Download and safely extract the public RDD2022 India archive."""
from __future__ import annotations
import argparse, shutil, sys, urllib.request, zipfile
from pathlib import Path

URL = "https://bigdatacup.s3.ap-northeast-1.amazonaws.com/2022/CRDDC2022/RDD2022/Country_Specific_Data_CRDDC2022/RDD2022_India.zip"
ROOT = Path(__file__).resolve().parents[1]

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--archive', default=str(ROOT / 'data' / 'raw' / 'RDD2022_India.zip'))
    p.add_argument('--extract-to', default=str(ROOT / 'data' / 'raw' / 'RDD2022_India'))
    a = p.parse_args()
    archive, dest = Path(a.archive).resolve(), Path(a.extract_to).resolve()
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        req = urllib.request.Request(URL, headers={'User-Agent':'StreetSense-dataset-preparer/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=60) as response, archive.open('wb') as out:
                total = int(response.headers.get('Content-Length') or 0)
                done = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk: break
                    out.write(chunk); done += len(chunk)
                    if total: print(f'\\rDownloaded {done/total:.0%} ({done/1024/1024:.0f} MB)', end='', flush=True)
            print()
        except Exception as exc:
            archive.unlink(missing_ok=True)
            raise SystemExit(f'Download failed: {exc}\\nYou can manually download the India archive from the official RDD2022 repository and rerun this script with --archive.')
    if not zipfile.is_zipfile(archive):
        raise SystemExit(f'Archive is not a valid ZIP: {archive}')
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    with zipfile.ZipFile(archive) as zf:
        members = zf.infolist()
        for member in members:
            target = (dest / member.filename).resolve()
            if target != root and root not in target.parents:
                raise SystemExit(f'Unsafe archive path rejected: {member.filename}')
        zf.extractall(dest)
    print(f'Extracted {len(members)} archive entries to: {dest}')
    print('Next: run prepare-rdd2022-india.bat with this folder path.')

if __name__ == '__main__': main()
