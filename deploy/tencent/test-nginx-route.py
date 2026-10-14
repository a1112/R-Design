#!/usr/bin/env python3
import importlib.util
import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('nginx_route', Path(__file__).with_name('nginx-route.py'))
route = importlib.util.module_from_spec(spec)
spec.loader.exec_module(route)
SNIPPET = '/etc/nginx/snippets/r-design-team.conf'
SITE = '''server {
    listen 80 default_server;
    server_name _;
    location / { return 308 https://$host$request_uri; }
}
server {
    listen 443 ssl default_server;
    include /etc/nginx/snippets/q-browser.conf;
    server_name 175.178.16.90;
    add_header Example "literal { braces } and # comment";
    # A comment with unbalanced { braces
    location /api/ { proxy_pass http://127.0.0.1:3000; }
}
'''


class RouteTests(unittest.TestCase):
    def test_adds_only_one_line_and_preserves_existing_site(self):
        updated, changed = route.add_route(SITE, '175.178.16.90', SNIPPET, '/r-design')
        added = '    include ' + SNIPPET + '; # R-Design Team managed include\n'
        self.assertTrue(changed)
        self.assertEqual(updated.replace(added, ''), SITE)
        self.assertEqual(updated.count(SNIPPET), 1)
        self.assertNotIn(SNIPPET, updated.split('server {')[1])

    def test_repeated_install_is_idempotent(self):
        first, _ = route.add_route(SITE, '175.178.16.90', SNIPPET, '/r-design')
        second, changed = route.add_route(first, '175.178.16.90', SNIPPET, '/r-design')
        self.assertFalse(changed)
        self.assertEqual(first, second)

    def test_preserves_crlf(self):
        original = SITE.replace('\n', '\r\n')
        updated, _ = route.add_route(original, '175.178.16.90', SNIPPET, '/r-design')
        self.assertNotIn('\n', updated.replace('\r\n', ''))

    def test_refuses_conflicting_existing_route(self):
        conflicting = SITE.replace('location /api/', 'location ^~ /r-design/')
        with self.assertRaisesRegex(ValueError, 'manual review'):
            route.add_route(conflicting, '175.178.16.90', SNIPPET, '/r-design')

    def test_refuses_ambiguous_https_server(self):
        with self.assertRaisesRegex(ValueError, 'found 2'):
            route.add_route(SITE + SITE, '175.178.16.90', SNIPPET, '/r-design')

    def test_refuses_wrong_server_name(self):
        with self.assertRaisesRegex(ValueError, 'found 0'):
            route.add_route(SITE, 'another.example', SNIPPET, '/r-design')

    def test_refuses_unbalanced_configuration(self):
        with self.assertRaisesRegex(ValueError, 'Unbalanced'):
            route.add_route(SITE + '{', '175.178.16.90', SNIPPET, '/r-design')

    def test_backup_then_other_edit_refuses_injection_without_overwriting_edit(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'site.conf'
            original = SITE.encode()
            config.write_bytes(original)
            backup_sha = hashlib.sha256(original).hexdigest()
            modified = original + b'\n# Another service updated its route after our backup.\n'
            config.write_bytes(modified)
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('nginx-route.py')),
                '--config', str(config), '--host', '175.178.16.90', '--snippet', SNIPPET,
                '--expected-sha', backup_sha], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('changed since the deployment backup', result.stderr)
            self.assertEqual(config.read_bytes(), modified)


if __name__ == '__main__':
    unittest.main()
