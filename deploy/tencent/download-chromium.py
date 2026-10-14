#!/usr/bin/env python3
"""Fetch the exact Playwright headless shell from Google's official fixed-version ZIP."""
import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
import time
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browsers-json', required=True)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--proxy')
    parser.add_argument('--parallel', type=int, default=8)
    args = parser.parse_args()
    if not 1 <= args.parallel <= 16:
        raise ValueError('Parallel connection count must be 1 to 16')
    records = json.loads(Path(args.browsers_json).read_text())['browsers']
    browser = next(item for item in records if item['name'] == 'chromium-headless-shell')
    version = browser['browserVersion']
    if not all(part.isdecimal() for part in version.split('.')):
        raise ValueError('Unexpected browser version')
    destination = Path(args.destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    url = f'https://storage.googleapis.com/chrome-for-testing-public/{version}/linux64/chrome-headless-shell-linux64.zip'
    proxies = {'http': args.proxy, 'https': args.proxy} if args.proxy else {}

    def request(headers=None, method='GET'):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler(proxies))
        return opener.open(urllib.request.Request(url, headers=headers or {}, method=method), timeout=60)

    with request(method='HEAD') as response:
        size = int(response.headers['Content-Length'])
        if response.headers.get('Accept-Ranges') != 'bytes' or not 1_000_000 < size < 500_000_000:
            raise ValueError('Official server must support byte ranges and a bounded ZIP size')
    part_size = 4 * 1024 * 1024
    count = (size + part_size - 1) // part_size
    parts = destination / 'download-parts'
    parts.mkdir(exist_ok=True)

    def fetch(index):
        start = index * part_size
        end = min(size - 1, start + part_size - 1)
        file = parts / f'{index:04}.part'
        if file.exists() and file.stat().st_size == end - start + 1:
            return file
        for attempt in range(3):
            try:
                with request({'Range': f'bytes={start}-{end}'}) as response:
                    if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{size}':
                        raise ValueError('Official server returned an unexpected range')
                    temporary = file.with_suffix('.temporary')
                    with temporary.open('wb') as output:
                        shutil.copyfileobj(response, output)
                    if temporary.stat().st_size != end - start + 1:
                        raise ValueError('Truncated range download')
                    temporary.replace(file)
                return file
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2)

    print(f'Downloading official headless shell {version}: {size} bytes using {args.parallel} connections.', flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.parallel) as pool:
        futures = [pool.submit(fetch, index) for index in range(count)]
        for completed, future in enumerate(concurrent.futures.as_completed(futures), 1):
            future.result()
            print(f'Completed range {completed}/{count}.', flush=True)
    archive = destination / 'chrome-headless-shell-linux64.zip'
    with archive.open('wb') as output:
        for index in range(count):
            with (parts / f'{index:04}.part').open('rb') as source:
                shutil.copyfileobj(source, output)
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            name = PurePosixPath(entry.filename)
            if name.is_absolute() or '..' in name.parts or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Unsafe browser ZIP entry')
        bad = bundle.testzip()
        if bad:
            raise ValueError('Browser ZIP CRC check failed')
        bundle.extractall(destination)
        for entry in bundle.infolist():
            mode = entry.external_attr >> 16
            if mode:
                os.chmod(destination / entry.filename, mode & 0o777)
    executable = destination / 'chrome-headless-shell-linux64/chrome-headless-shell'
    executable.chmod(0o755)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    print(f'Browser ZIP CRC passed; SHA-256={checksum}', flush=True)
    print(f'RDESIGN_BROWSER={executable}', flush=True)


if __name__ == '__main__':
    main()
