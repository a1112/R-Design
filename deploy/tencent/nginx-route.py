#!/usr/bin/env python3
"""Insert one include into the existing HTTPS server; preserve all other bytes."""
import argparse
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path


def mask_quotes_and_comments(text):
    result = list(text)
    quote = None
    comment = False
    escaped = False
    for index, char in enumerate(text):
        if comment:
            if char == '\n':
                comment = False
            else:
                result[index] = ' '
        elif quote:
            if char != '\n':
                result[index] = ' '
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == quote:
                quote = None
        elif char == '#':
            comment = True
            result[index] = ' '
        elif char in ('"', "'"):
            quote = char
            result[index] = ' '
    if quote:
        raise ValueError('Unterminated quote in nginx configuration')
    return ''.join(result)


def add_route(text, host, snippet, base_path):
    masked = mask_quotes_and_comments(text)
    stack = []
    servers = []
    for match in re.finditer(r'[{}]', masked):
        index = match.start()
        if match.group() == '{':
            preceding = re.search(r'([\w-]+)\s*$', masked[:index])
            stack.append((index, bool(preceding and preceding.group(1) == 'server')))
        else:
            if not stack:
                raise ValueError('Unbalanced nginx braces')
            start, is_server = stack.pop()
            if is_server:
                servers.append((start, index))
    if stack:
        raise ValueError('Unbalanced nginx braces')
    candidates = []
    for start, end in servers:
        body = masked[start + 1:end]
        names = re.search(r'\bserver_name\s+([^;]+);', body)
        if (re.search(r'\blisten\s+(?:[^;\s]+:)?443\s+[^;]*\bssl\b', body)
                and names and host in names.group(1).split()):
            candidates.append((start, end))
    if len(candidates) != 1:
        raise ValueError(f'Expected exactly one HTTPS server for {host}; found {len(candidates)}')
    start, end = candidates[0]
    original_body = text[start + 1:end]
    include = f'include {snippet};'
    if re.search(r'\binclude\s+' + re.escape(snippet) + r'\s*;', original_body):
        return text, False
    if re.search(r'\blocation\s+[^\n{]*' + re.escape(base_path) + r'(?:[/\s{]|$)', original_body):
        raise ValueError('Existing R-Design location requires manual review')
    name = re.search(r'(?m)^([ \t]*)server_name\s+[^;]+;', original_body)
    if not name:
        raise ValueError('Expected a standalone server_name directive')
    newline = '\r\n' if '\r\n' in text else '\n'
    insertion = start + 1 + name.end()
    line = newline + name.group(1) + include + ' # R-Design Team managed include'
    return text[:insertion] + line + text[insertion:], True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--host', required=True)
    parser.add_argument('--snippet', required=True)
    parser.add_argument('--base-path', default='/r-design')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--expected-sha')
    args = parser.parse_args()
    target = Path(args.config).resolve(strict=True)
    data = target.read_bytes()
    if args.expected_sha and hashlib.sha256(data).hexdigest() != args.expected_sha:
        raise RuntimeError('nginx configuration changed since the deployment backup; no route was inserted')
    if not args.check and not args.expected_sha:
        raise ValueError('A backed-up configuration --expected-sha is required before mutation')
    updated, changed = add_route(data.decode('utf-8'), args.host, args.snippet, args.base_path)
    if args.check:
        print('nginx route already included.' if not changed else 'nginx route insertion validated.')
        return
    if not changed:
        print(json.dumps({'changed': False, 'sha256': hashlib.sha256(data).hexdigest()}))
        return
    # Re-read immediately before the atomic write to reject concurrent configuration edits.
    if target.read_bytes() != data:
        raise RuntimeError('nginx configuration changed during preparation')
    stat = target.stat()
    descriptor, temporary = tempfile.mkstemp(prefix=target.name + '.', dir=target.parent)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(updated.encode('utf-8'))
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, stat.st_mode)
        os.chown(temporary, stat.st_uid, stat.st_gid)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(json.dumps({'changed': True, 'sha256': hashlib.sha256(updated.encode('utf-8')).hexdigest()}))


if __name__ == '__main__':
    main()
