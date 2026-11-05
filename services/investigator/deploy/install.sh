#!/usr/bin/env bash
# Installs or updates the analyzer on the Pi: `install.sh <settings-file>`, as root, from a checkout.
# Everything lives in its own users and directories. It installs nothing machine-wide besides the two
# services, so whatever else runs on this machine keeps working. Safe to run again.
# Lines starting with `::` are read by the console. Never print a value from the settings file.
set -euo pipefail
exec </dev/null
umask 022

SETTINGS_FILE=$1
SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)

NODE_VERSION=v22.23.4
CLAUDE_VERSION=2.1.318

ROOT=${ADITUM_INSTALL_ROOT:-} # Only for the install test, which can't write to /opt.
APP=$ROOT/opt/aditum-investigator
CONFIG=$ROOT/etc/aditum-investigator
STATE=$ROOT/var/lib/aditum-investigator
GATEWAY_STATE=$ROOT/var/lib/aditum-mysql-gateway
BUILD_HOME=$ROOT/var/lib/aditum-investigator-build
CLAUDE_HOME=/home/investigator-claude
UNITS=$ROOT/etc/systemd/system

setting() { sed -n "s/^$1=//p" "$SETTINGS_FILE" | head -n 1; }
existing() { [ -f "$1" ] && sed -n "s/^$2=//p" "$1" | head -n 1 || true; }
as_builder() { runuser -u investigator-build -- env HOME="$BUILD_HOME" PATH="$APP/node/bin:/usr/bin:/bin" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"; }

echo "::step prepare"
exec 9>"${ROOT:-}/run/lock/aditum-investigator-install.lock"
flock -n 9 || { echo "Ya hay una instalación corriendo en esta máquina."; exit 1; }
# An older functions deploy doesn't send these, and the runner can't start without them.
for name in REPO_URL REPO_BRANCH; do
  [ -n "$(setting "$name")" ] || { echo "Falta $name en la configuración: desplegá functions con CODE_REPO y volvé a instalar."; exit 1; }
done
for tool in curl git setpriv sha256sum systemctl tar; do
  command -v "$tool" >/dev/null || { echo "Falta $tool en esta máquina."; exit 1; }
done
case "$(uname -m)" in
  aarch64) NODE_ARCH=arm64 ;;
  x86_64) NODE_ARCH=x64 ;;
  *) echo "Esta arquitectura no es compatible: $(uname -m)."; exit 1 ;;
esac
COMMIT=$(git -C "$SRC" rev-parse HEAD)
echo "::commit $COMMIT"

echo "::step users"
id -u investigator-claude >/dev/null 2>&1 || useradd --system --create-home --home-dir "$CLAUDE_HOME" investigator-claude
id -u investigator >/dev/null 2>&1 || useradd --system investigator
id -u mysql-gateway >/dev/null 2>&1 || useradd --system mysql-gateway
id -u aditum-writer >/dev/null 2>&1 || useradd --system aditum-writer
id -u investigator-build >/dev/null 2>&1 || useradd --system --home-dir "$BUILD_HOME" investigator-build
# The runner hands each job's settings to Claude through this group.
usermod -aG investigator-claude investigator
install -d -m 755 "$APP" "$APP/releases"
install -d -o investigator -g investigator -m 755 "$STATE" "$STATE/checkouts"
install -d -o investigator -g investigator -m 700 "$STATE/mirror"
install -d -o investigator -g investigator -m 711 "$STATE/jobs"
install -d -o mysql-gateway -g mysql-gateway -m 700 "$GATEWAY_STATE"
install -d -m 700 "$CONFIG"
install -d -o investigator-build -g investigator-build -m 700 "$BUILD_HOME"

echo "::step node"
if [ "$("$APP/node/bin/node" --version 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  DOWNLOAD=$(mktemp -d)
  TARBALL=node-$NODE_VERSION-linux-$NODE_ARCH.tar.gz
  curl -fsSL -o "$DOWNLOAD/$TARBALL" "https://nodejs.org/dist/$NODE_VERSION/$TARBALL"
  curl -fsSL -o "$DOWNLOAD/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$DOWNLOAD" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c - >/dev/null)
  rm -rf "$APP/node.new"
  install -d -m 755 "$APP/node.new"
  tar -xzf "$DOWNLOAD/$TARBALL" -C "$APP/node.new" --strip-components=1 --no-same-owner
  rm -rf "$APP/node" "$DOWNLOAD"
  mv "$APP/node.new" "$APP/node"
fi

echo "::step build"
# Built by a user with no access to the secrets, and without running the dependencies' install scripts.
BUILD=$BUILD_HOME/build
rm -rf "$BUILD" "$BUILD_HOME/out"
install -d -o investigator-build -g investigator-build -m 700 "$BUILD"
git -C "$SRC" -c safe.directory='*' archive HEAD | as_builder tar -x -C "$BUILD"
as_builder bash -c "cd '$BUILD' \
  && corepack pnpm install --frozen-lockfile --ignore-scripts --filter '@aditum-chat/investigator...' \
  && corepack pnpm --filter @aditum-chat/investigator build \
  && corepack pnpm --filter @aditum-chat/investigator deploy --prod --ignore-scripts '$BUILD_HOME/out' \
  && cp -R services/investigator/dist '$BUILD_HOME/out/dist'"
RELEASE=$APP/releases/$COMMIT
rm -rf "$RELEASE"
mv "$BUILD_HOME/out" "$RELEASE"
chown -R root:root "$RELEASE"
chmod -R a+rX "$RELEASE"
rm -rf "$BUILD"
# Not `mv`: given a link to a directory it moves into that directory and the link keeps the old release.
ln -sfn "$RELEASE" "$APP/current"
# Keeps this release and the one before it.
(cd "$APP/releases" && ls -1t | tail -n +3 | xargs -r rm -rf)

echo "::step claude"
if ! "$APP/claude/bin/claude" --version 2>/dev/null | grep -q "^$CLAUDE_VERSION"; then
  rm -rf "$BUILD_HOME/claude"
  install -d -o investigator-build -g investigator-build -m 755 "$BUILD_HOME/claude"
  as_builder npm install --global --prefix "$BUILD_HOME/claude" "@anthropic-ai/claude-code@$CLAUDE_VERSION"
  rm -rf "$APP/claude"
  mv "$BUILD_HOME/claude" "$APP/claude"
  chown -R root:root "$APP/claude"
  chmod -R a+rX "$APP/claude"
fi

echo "::step config"
# Kept across updates: the runner and the gateway authenticate to each other with it.
ADMIN_TOKEN=$(existing "$CONFIG/gateway.env" GATEWAY_ADMIN_TOKEN)
[ -n "$ADMIN_TOKEN" ] || ADMIN_TOKEN=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
RO_DB_CA_FILE_VALUE=$(existing "$CONFIG/gateway.env" RO_DB_CA_FILE)
WRITE_DB_CA_FILE_VALUE=$(existing "$CONFIG/writer.env" WRITE_DB_CA_FILE)
(
  umask 077
  cat >"$CONFIG/runner.env.new" <<RUNNER
PATH=$APP/node/bin:$APP/claude/bin:/usr/bin:/bin
HOME=$CLAUDE_HOME
INVESTIGATOR_STATE_DIR=${STATE#"$ROOT"}
RUNNER_FUNCTION_URL=$(setting RUNNER_FUNCTION_URL)
RUNNER_SHARED_SECRET=$(setting RUNNER_SHARED_SECRET)
GATEWAY_ADMIN_TOKEN=$ADMIN_TOKEN
GITHUB_CODE_TOKEN=$(setting GITHUB_CODE_TOKEN)
REPO_URL=$(setting REPO_URL)
REPO_BRANCH=$(setting REPO_BRANCH)
CLAUDE_CODE_OAUTH_TOKEN=$(setting CLAUDE_CODE_OAUTH_TOKEN)
CLAUDE_TOKEN_ISSUED_AT=$(setting CLAUDE_TOKEN_ISSUED_AT)
CLAUDE_BIN=${APP#"$ROOT"}/claude/bin/claude
CLAUDE_UID=$(id -u investigator-claude)
CLAUDE_GID=$(id -g investigator-claude)
DISABLE_AUTOUPDATER=1
RUNNER
  cat >"$CONFIG/gateway.env.new" <<GATEWAY
GATEWAY_ADMIN_TOKEN=$ADMIN_TOKEN
GATEWAY_LOG_DIR=${GATEWAY_STATE#"$ROOT"}/queries
GATEWAY_FUNCTION_URL=$(setting GATEWAY_FUNCTION_URL)
GATEWAY_SHARED_SECRET=$(setting GATEWAY_SHARED_SECRET)
RO_DB_CA_FILE=$RO_DB_CA_FILE_VALUE
GATEWAY
  cat >"$CONFIG/writer.env.new" <<WRITER
WRITER_FUNCTION_URL=$(setting WRITER_FUNCTION_URL)
WRITER_SHARED_SECRET=$(setting WRITER_SHARED_SECRET)
WRITE_DB_CA_FILE=${WRITE_DB_CA_FILE_VALUE:-$RO_DB_CA_FILE_VALUE}
WRITER
  mv -f "$CONFIG/runner.env.new" "$CONFIG/runner.env"
  mv -f "$CONFIG/gateway.env.new" "$CONFIG/gateway.env"
  mv -f "$CONFIG/writer.env.new" "$CONFIG/writer.env"
)

echo "::step services"
install -m 644 "$SRC/services/investigator/deploy/aditum-mysql-gateway.service" "$UNITS/aditum-mysql-gateway.service"
install -m 644 "$SRC/services/investigator/deploy/aditum-investigator.service" "$UNITS/aditum-investigator.service"
install -m 644 "$SRC/services/investigator/deploy/aditum-writer.service" "$UNITS/aditum-writer.service"
systemctl daemon-reload
systemctl enable --quiet aditum-mysql-gateway aditum-investigator aditum-writer
# A write cut short by this is resolved when the writer comes back: it reads the rows and never retries.
systemctl restart aditum-mysql-gateway aditum-investigator aditum-writer

echo "::step verify"
[ "$(readlink "$APP/current")" = "$RELEASE" ] || { echo "La versión activa no es la que se acaba de instalar."; exit 1; }
sleep 15
for service in aditum-mysql-gateway aditum-investigator aditum-writer; do
  if ! systemctl is-active --quiet "$service"; then
    echo "$service no arrancó:"
    journalctl -u "$service" -n 15 --no-pager -o cat || true
    exit 1
  fi
done
echo "::done"
