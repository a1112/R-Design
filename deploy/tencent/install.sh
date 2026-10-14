#!/usr/bin/env bash
# Called by deploy.ps1 only after local validation. Environment arrives over SSH stdin.
set -Eeuo pipefail
umask 077

revision=${1:?release revision required}
archive=${2:?archive path required}
expected_sha=${3:?archive SHA-256 required}
phase=${4:-publish}
reuse_revision=${5:-none}
[[ "$revision" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$ ]] || exit 2
[[ "$archive" == /tmp/r-design-team-*.tar.gz && -f "$archive" && ! -L "$archive" ]] || exit 2
[[ "$expected_sha" =~ ^[a-f0-9]{64}$ ]] || exit 2
[[ "$phase" == stage || "$phase" == verify || "$phase" == publish ]] || exit 2
[[ "$reuse_revision" == none || "$reuse_revision" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$ ]] || exit 2
[[ $EUID == 0 ]] || { printf 'Run installer using sudo.\n' >&2; exit 2; }

root=/srv/r-design-team
release="$root/releases/$revision"
data=/var/lib/r-design-team
environment=/etc/r-design-team.env
unit=/etc/systemd/system/r-design-team.service
nginx_config=/etc/nginx/sites-enabled/serverall
nginx_snippet=/etc/nginx/snippets/r-design-team.conf
backups="/var/backups/r-design-team/$revision"
incoming=$(mktemp /tmp/r-design-team-env.XXXXXX)
trap 'rm -f -- "$incoming"' EXIT
if [[ "$phase" == publish ]]; then cat > "$incoming"; fi
exec 9>/run/lock/r-design-team-deploy.lock
flock -n 9 || { printf 'Another R-Design deployment is running.\n' >&2; exit 2; }
actual_sha=$(sha256sum "$archive" | cut -d' ' -f1)
[[ "$actual_sha" == "$expected_sha" ]] || { printf 'Archive checksum mismatch.\n' >&2; exit 2; }
node -e 'const sqlite=require("node:sqlite"); const d=new sqlite.DatabaseSync(":memory:"); d.exec("create table smoke(id integer)"); if(typeof sqlite.backup!=="function")process.exit(1); d.close();' >/dev/null
nginx -t
[[ -f "$nginx_config" ]] || { printf 'Expected shared nginx site is missing.\n' >&2; exit 2; }
for candidate in "$root" "$data" "$environment" "$nginx_snippet"; do
  [[ ! -L "$candidate" ]] || { printf 'Unexpected deployment symlink: %s\n' "$candidate" >&2; exit 2; }
done
if [[ "$phase" == publish ]]; then
python3 - "$incoming" <<'PY'
import re, sys
from pathlib import Path
values = {}
for line in Path(sys.argv[1]).read_text().splitlines():
    if not line or line.startswith('#'):
        continue
    key, separator, value = line.partition('=')
    if not separator or key in values:
        raise SystemExit('Invalid bootstrap environment format')
    values[key] = value
required = {
    'RDESIGN_TEAM_PORT': '4315', 'RDESIGN_TEAM_HOST': '127.0.0.1',
    'RDESIGN_TEAM_DATA_DIR': '/var/lib/r-design-team',
    'RDESIGN_TEAM_PUBLIC_ORIGIN': 'https://175.178.16.90',
    'RDESIGN_TEAM_BASE_PATH': '/r-design',
    'RDESIGN_TEAM_STATIC_DIR': '/srv/r-design-team/current/dist/workbench',
}
for key, expected in required.items():
    if values.get(key) != expected:
        raise SystemExit('Unexpected bootstrap configuration: ' + key)
if set(values) != set(required) | {'RDESIGN_TEAM_ADMIN_EMAIL', 'RDESIGN_TEAM_ADMIN_PASSWORD', 'RDESIGN_TEAM_ADMIN_NAME'}:
    raise SystemExit('Unexpected environment keys')
if not re.fullmatch(r'[A-Za-z0-9_.+@-]{3,200}', values['RDESIGN_TEAM_ADMIN_EMAIL']):
    raise SystemExit('Invalid administrator email')
if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', values['RDESIGN_TEAM_ADMIN_PASSWORD']):
    raise SystemExit('Invalid administrator password format')
if not re.fullmatch(r'[A-Za-z0-9 _.-]{1,80}', values['RDESIGN_TEAM_ADMIN_NAME']):
    raise SystemExit('Invalid administrator name')
PY
fi

if [[ ! -e "$release" ]]; then
  install -d -m 0755 "$root" "$root/releases"
  install -d -m 0755 -o ubuntu -g ubuntu "$release"
  python3 - "$archive" <<'PY'
import sys, tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe archive entry rejected')
        if any(part in {'.git', '.rdesign', 'node_modules'} or part.startswith('.env') for part in path.parts):
            raise SystemExit('Private archive entry rejected')
PY
  tar --extract --gzip --file "$archive" --directory "$release" --no-same-owner --no-same-permissions
  [[ -f "$release/package-lock.json" ]] || { printf 'Incomplete source release.\n' >&2; exit 2; }
  chown -R ubuntu:ubuntu "$release"
  chmod -R a+rX,go-w "$release"
  printf '%s\n' "$expected_sha" > "$release/.artifact-sha256"
else
  [[ -d "$release" && ! -L "$release" && -f "$release/.artifact-sha256" && "$(cat "$release/.artifact-sha256")" == "$expected_sha" ]] || { printf 'Release revision exists with different content.\n' >&2; exit 2; }
fi
if [[ "$phase" == publish && -e "$release/.verification-modified" ]]; then
  printf 'This verification tree was modified after archiving; prepare a fresh release.\n' >&2
  exit 2
fi
# A failed copy/install has no completion marker. Preserve its partial trees, then retry cleanly.
if [[ ! -f "$release/.dependencies-installed" && -e "$release/node_modules" ]]; then
  [[ "$(readlink -f "$root/current" 2>/dev/null || true)" != "$release" ]] || { printf 'Cannot replace dependencies of the active release; prepare a fresh revision.\n' >&2; exit 2; }
  quarantine=$(mktemp -d "$release/.incomplete-dependencies.XXXXXX")
  while IFS= read -r -d '' partial_modules; do
    [[ ! -L "$partial_modules" && "$(realpath "$partial_modules")" == "$release/"* ]] || { printf 'Partial dependencies escape the release.\n' >&2; exit 2; }
    relative_partial=${partial_modules#"$release/"}
    quarantine_target="$quarantine/$relative_partial"
    [[ "$(realpath -m "$quarantine_target")" == "$quarantine/"* ]] || exit 2
    install -d -m 0700 "$(dirname "$quarantine_target")"
    mv -- "$partial_modules" "$quarantine_target"
  done < <(printf '%s\0' "$release/node_modules"; find "$release/apps" "$release/packages" "$release/fixtures" -type d -name node_modules -prune -print0)
  printf 'Incomplete dependency trees retained in %s; retrying the locked dependency preparation.\n' "$quarantine"
fi
if [[ ! -f "$release/.dependencies-installed" && "$reuse_revision" != none ]]; then
  reuse="$root/releases/$reuse_revision"
  [[ "$reuse" != "$release" && -d "$reuse" && ! -L "$reuse" && "$(realpath "$reuse")" == "$reuse" && -f "$reuse/.dependencies-installed" && -d "$reuse/node_modules" && ! -L "$reuse/node_modules" && "$(realpath "$reuse/node_modules")" == "$reuse/node_modules" ]] || { printf 'Invalid dependency reuse source.\n' >&2; exit 2; }
  [[ "$(sha256sum "$reuse/package-lock.json" | cut -d' ' -f1)" == "$(sha256sum "$release/package-lock.json" | cut -d' ' -f1)" ]] || { printf 'Dependency reuse requires identical package-lock.json.\n' >&2; exit 2; }
  cp -a --reflink=auto "$reuse/node_modules" "$release/node_modules"
  while IFS= read -r -d '' nested_modules; do
    resolved_modules=$(realpath "$nested_modules")
    [[ "$resolved_modules" == "$reuse/"* && ! -L "$nested_modules" ]] || { printf 'Nested dependencies escape the reuse release.\n' >&2; exit 2; }
    relative_modules=${nested_modules#"$reuse/"}
    destination_modules="$release/$relative_modules"
    [[ "$(realpath -m "$destination_modules")" == "$release/"* && ! -e "$destination_modules" ]] || { printf 'Unsafe or existing nested dependency destination.\n' >&2; exit 2; }
    [[ -d "$(dirname "$destination_modules")" ]] || { printf 'Nested dependency workspace is absent from the new source release.\n' >&2; exit 2; }
    cp -a --reflink=auto "$nested_modules" "$destination_modules"
  done < <(find "$reuse/apps" "$reuse/packages" "$reuse/fixtures" -type d -name node_modules -prune -print0)
  ( cd "$release"; node --import tsx --input-type=module -e 'import {profileHostDependencies} from "./apps/bridge/src/runtime-dependencies.ts"; profileHostDependencies(process.cwd(),"react18"); console.log("Frozen React 18 dependency versions verified.");' )
  touch "$release/.dependencies-installed"
  printf 'Locked Linux dependencies copied from %s; lockfile SHA-256 matches.\n' "$reuse_revision"
fi
if [[ ! -f "$release/.dependencies-installed" ]]; then
  # Match the lockfile authoring CLI without changing the shared system npm installation.
  install -d -m 0755 -o ubuntu -g ubuntu "$root/tooling" "$root/tooling/npm-cache"
  install -m 0644 /dev/null "$root/tooling/global.npmrc"
  ( umask 022; cd "$release"; sudo -u ubuntu env HOME=/home/ubuntu NPM_CONFIG_USERCONFIG=/dev/null NPM_CONFIG_GLOBALCONFIG="$root/tooling/global.npmrc" NPM_CONFIG_CACHE="$root/tooling/npm-cache" npm exec --yes --package=npm@11.13.0 -- npm ci --include=dev --ignore-scripts --no-audit --no-fund )
  chmod -R a+rX,go-w "$release"
  ( cd "$release"; node --import tsx --input-type=module -e 'import {profileHostDependencies} from "./apps/bridge/src/runtime-dependencies.ts"; profileHostDependencies(process.cwd(),"react18"); console.log("Frozen React 18 dependency versions verified.");' )
  touch "$release/.dependencies-installed"
fi

if [[ "$phase" == stage ]]; then
  printf 'R-Design release staged only; no service, environment, data or nginx route changed. revision=%s\n' "$revision"
  exit 0
fi
if [[ "$phase" == verify ]]; then
  # Tooling and temporary test workspaces belong exclusively to this inactive release.
  install -d -m 0755 -o ubuntu -g ubuntu "$release/.verification-browsers"
  verification_browser="$root/tooling/headless-shell/chrome-headless-shell-linux64/chrome-headless-shell"
  if [[ -x "$verification_browser" ]]; then
    expected_browser_version=$(node -p "require('$release/node_modules/playwright-core/browsers.json').browsers.find(b=>b.name==='chromium-headless-shell').browserVersion")
    [[ "$("$verification_browser" --version)" == *"$expected_browser_version"* ]] || { printf 'Verification browser version does not match the locked Playwright metadata.\n' >&2; exit 2; }
  else
    verification_browser=
    ( cd "$release"; sudo -u ubuntu env -u OPENAI_API_KEY -u RDESIGN_AGENT_WORKER_TOKEN HOME=/home/ubuntu PLAYWRIGHT_BROWSERS_PATH="$release/.verification-browsers" npx playwright install chromium --only-shell )
  fi
  ( cd "$release"; sudo -u ubuntu env -u OPENAI_API_KEY -u RDESIGN_AGENT_WORKER_TOKEN HOME=/home/ubuntu PLAYWRIGHT_BROWSERS_PATH="$release/.verification-browsers" RDESIGN_BROWSER="$verification_browser" npm test -- --maxWorkers=2 )
  ( cd "$release"; sudo -u ubuntu env -u OPENAI_API_KEY -u RDESIGN_AGENT_WORKER_TOKEN HOME=/home/ubuntu PLAYWRIGHT_BROWSERS_PATH="$release/.verification-browsers" sh -c 'umask 022; npm run build' )
  ( cd "$release"; sudo -u ubuntu env -u OPENAI_API_KEY -u RDESIGN_AGENT_WORKER_TOKEN HOME=/home/ubuntu PLAYWRIGHT_BROWSERS_PATH="$release/.verification-browsers" RDESIGN_BROWSER="$verification_browser" npm run test:e2e )
  ( cd "$release"; sudo -u ubuntu env -u OPENAI_API_KEY -u RDESIGN_AGENT_WORKER_TOKEN HOME=/home/ubuntu PLAYWRIGHT_BROWSERS_PATH="$release/.verification-browsers" RDESIGN_BROWSER="$verification_browser" npm run test:team:e2e )
  ( cd "$release"; sudo -u ubuntu env -u OPENAI_API_KEY -u RDESIGN_AGENT_WORKER_TOKEN HOME=/home/ubuntu RDESIGN_WEB_BASE_PATH=/r-design/ sh -c 'umask 022; npm run build' )
  ( cd "$release"; sudo -u ubuntu env -u OPENAI_API_KEY -u RDESIGN_AGENT_WORKER_TOKEN HOME=/home/ubuntu PLAYWRIGHT_BROWSERS_PATH="$release/.verification-browsers" RDESIGN_BROWSER="$verification_browser" RDESIGN_TEAM_E2E_BASE_PATH=/r-design npm run test:team:e2e )
  chmod -R a+rX,go-w "$release/dist/workbench"
  printf '%s\n' "$expected_sha" > "$release/.linux-prefix-verified"
  printf 'Inactive release Linux tests and build passed. revision=%s\n' "$revision"
  exit 0
fi
[[ -f "$release/apps/team-server/src/index.ts" && -f "$release/dist/workbench/index.html" ]] || { printf 'Team server entrypoint or production frontend is missing.\n' >&2; exit 2; }
python3 - "$release/dist/workbench/index.html" <<'PY'
from html.parser import HTMLParser
from pathlib import Path
import sys
class Assets(HTMLParser):
    def __init__(self): super().__init__(); self.references = []
    def handle_starttag(self, tag, attributes):
        values = dict(attributes)
        if tag == 'script' and 'src' in values: self.references.append(values['src'])
        if tag == 'link' and values.get('rel') in {'stylesheet', 'modulepreload'}: self.references.append(values.get('href', ''))
assets = Assets(); assets.feed(Path(sys.argv[1]).read_text())
if not assets.references or any(not reference.startswith('/r-design/assets/') for reference in assets.references):
    raise SystemExit('Production build must use RDESIGN_WEB_BASE_PATH=/r-design/; refusing activation')
PY

if ! getent passwd r-design-team >/dev/null; then
  useradd --system --home-dir "$data" --no-create-home --shell /usr/sbin/nologin r-design-team
else
  [[ "$(id -u r-design-team)" -lt 1000 ]] || { printf 'Existing R-Design user is not a system account.\n' >&2; exit 2; }
fi
chmod -R a+rX,go-w "$release/dist/workbench"
while IFS= read -r -d '' static_file; do sudo -u r-design-team test -r "$static_file"; done < <(find "$release/dist/workbench" -type f -print0)
install -d -m 0750 -o r-design-team -g r-design-team "$data"
install -d -m 0700 /var/backups/r-design-team "$backups"
previous=''
if [[ -e "$root/current" || -L "$root/current" ]]; then
  [[ -L "$root/current" ]] || { printf 'Current release must be a managed symlink.\n' >&2; exit 2; }
  previous=$(readlink -f "$root/current" 2>/dev/null || true)
  [[ -n "$previous" && "$previous" == "$root/releases/"* && -d "$previous" ]] || { printf 'Current release is outside managed releases.\n' >&2; exit 2; }
  printf '%s\n' "$previous" > "$backups/previous-release.txt"
fi
if [[ -f "$unit" ]]; then
  grep -q 'Description=R-Design Team' "$unit" || { printf 'Existing service unit is not managed by R-Design.\n' >&2; exit 2; }
  cp -p "$unit" "$backups/service.previous"
fi
cp -p "$nginx_config" "$backups/nginx.previous"
nginx_backup_sha=$(sha256sum "$backups/nginx.previous" | cut -d' ' -f1)
if [[ -f "$nginx_snippet" ]]; then cp -p "$nginx_snippet" "$backups/snippet.previous"; fi
if [[ -f "$data/team.sqlite" ]]; then
  node "$release/deploy/tencent/backup.mjs" "$data/team.sqlite" "$backups/team.sqlite"
fi
if [[ ! -e "$environment" ]]; then
  install -o root -g root -m 0600 "$incoming" "$environment"
  printf 'Administrator bootstrap environment created.\n'
else
  [[ -f "$environment" ]] || exit 2
  printf 'Existing environment and administrator preserved.\n'
fi

activated=0
nginx_changed=0
snippet_changed=0
snippet_installed_sha=
nginx_installed_sha=
rollback() {
  code=$?
  trap - ERR
  printf 'Deployment failed; restoring previous R-Design release.\n' >&2
  nginx_restored=0
  if [[ "$nginx_changed" == 1 ]]; then
    if [[ -n "$nginx_installed_sha" && "$(sha256sum "$nginx_config" | cut -d' ' -f1)" == "$nginx_installed_sha" ]]; then
      cp -p "$backups/nginx.previous" "$nginx_config"
      nginx_restored=1
    else
      printf 'nginx changed concurrently; configuration backup retained for manual review.\n' >&2
    fi
  fi
  if [[ "$snippet_changed" == 1 && "$(sha256sum "$nginx_snippet" | cut -d' ' -f1)" == "$snippet_installed_sha" ]]; then
    if [[ "$nginx_changed" == 1 && "$nginx_restored" == 0 ]]; then
      printf 'Retaining the R-Design snippet because the concurrent shared configuration may still include it.\n' >&2
    elif [[ -f "$backups/snippet.previous" ]]; then
      cp -p "$backups/snippet.previous" "$nginx_snippet"
    elif ! grep -Fq "include $nginx_snippet;" "$nginx_config"; then
      rm -f -- "$nginx_snippet"
    else
      printf 'Retaining the referenced R-Design snippet for manual configuration review.\n' >&2
    fi
  fi
  if [[ "$nginx_restored" == 1 ]]; then if nginx -t; then systemctl reload nginx || true; fi; fi
  if [[ "$activated" == 1 ]]; then
    if [[ -n "$previous" ]]; then
      ln -s "$previous" "$root/current.rollback"
      mv -Tf "$root/current.rollback" "$root/current"
      if [[ -f "$backups/service.previous" ]]; then cp -p "$backups/service.previous" "$unit"; fi
      systemctl daemon-reload
      systemctl restart r-design-team || true
    else
      systemctl disable --now r-design-team || true
    fi
  fi
  printf 'Data retained. Consistent database backup, when present: %s/team.sqlite\n' "$backups" >&2
  exit "$code"
}
trap rollback ERR

python3 "$release/deploy/tencent/nginx-route.py" --config "$nginx_config" --host 175.178.16.90 --snippet "$nginx_snippet" --expected-sha "$nginx_backup_sha" --check
if ss -ltnH 'sport = :4315' | grep -q . && ! systemctl is-active --quiet r-design-team; then
  printf 'Port 4315 is occupied by another process.\n' >&2
  false
fi
install -o root -g root -m 0644 "$release/deploy/tencent/r-design-team.service" "$unit"
ln -s "$release" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
activated=1
systemctl daemon-reload
systemctl enable r-design-team >/dev/null
systemctl restart r-design-team
ready=0
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 2 -H 'Host: 175.178.16.90' -H 'X-Forwarded-Proto: https' http://127.0.0.1:4315/r-design/api/team/health >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { printf 'R-Design readiness check failed.\n' >&2; false; }
cat > "$nginx_snippet" <<'NGINX'
# R-Design Team: preserve /r-design prefix; queries are excluded from access logs.
location = /r-design { return 308 /r-design/team; }
location ^~ /r-design/ {
    proxy_pass http://127.0.0.1:4315;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Connection "";
    client_max_body_size 25m;
    proxy_read_timeout 60s;
    access_log off;
}
NGINX
chmod 0644 "$nginx_snippet"
snippet_changed=1
snippet_installed_sha=$(sha256sum "$nginx_snippet" | cut -d' ' -f1)
nginx_result=$(python3 "$release/deploy/tencent/nginx-route.py" --config "$nginx_config" --host 175.178.16.90 --snippet "$nginx_snippet" --expected-sha "$nginx_backup_sha")
nginx_changed=$(printf '%s' "$nginx_result" | python3 -c 'import json,sys; print(1 if json.load(sys.stdin)["changed"] else 0)')
nginx_installed_sha=$(printf '%s' "$nginx_result" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha256"])')
[[ "$(sha256sum "$nginx_config" | cut -d' ' -f1)" == "$nginx_installed_sha" ]] || { printf 'nginx changed after route insertion; refusing reload.\n' >&2; false; }
nginx -t
systemctl reload nginx
# nginx -s reload returns before the new workers accept connections; old workers can briefly return 404.
public_ready=0
public_deadline=$(( $(date +%s) + 30 ))
while true; do
  public_remaining=$(( public_deadline - $(date +%s) ))
  (( public_remaining > 0 )) || break
  public_timeout=2
  if (( public_remaining < public_timeout )); then public_timeout=$public_remaining; fi
  if curl --fail --silent --max-time "$public_timeout" https://175.178.16.90/r-design/api/team/health | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)=={"status":"ok"} else 1)' 2>/dev/null; then public_ready=1; break; fi
  (( $(date +%s) < public_deadline )) || break
  sleep 1
done
[[ "$public_ready" == 1 ]] || { printf 'Public HTTPS route did not become healthy after nginx reload.\n' >&2; false; }
curl --fail --silent --show-error --max-time 10 https://175.178.16.90/r-design/team >/dev/null
while IFS= read -r asset_reference; do
  curl --fail --silent --show-error --max-time 10 "https://175.178.16.90$asset_reference" >/dev/null
done < <(python3 - "$release/dist/workbench/index.html" <<'PY'
from html.parser import HTMLParser
from pathlib import Path
import sys
class Assets(HTMLParser):
    def handle_starttag(self, tag, attributes):
        values = dict(attributes)
        if tag == 'script' and 'src' in values: print(values['src'])
        if tag == 'link' and values.get('rel') in {'stylesheet', 'modulepreload'}: print(values.get('href', ''))
assets = Assets(); assets.feed(Path(sys.argv[1]).read_text())
PY
)
systemctl is-active --quiet r-design-team
systemctl is-active --quiet mrd-public-tls-renew.timer
printf 'R-Design Team deployed. revision=%s url=https://175.178.16.90/r-design/team\n' "$revision"
printf 'Service: r-design-team; database: /var/lib/r-design-team/team.sqlite\n'
trap - ERR
