#!/bin/sh
set -eu

PID=""
ARTIFACT=""
BUNDLE=""
ROOT=""
PORTABLE_DATA=""
LAUNCH=""

for ARG in "$@"; do
  case "$ARG" in
    --pid=*) PID="${ARG#--pid=}" ;;
    --artifact=*) ARTIFACT="${ARG#--artifact=}" ;;
    --bundle=*) BUNDLE="${ARG#--bundle=}" ;;
    --root=*) ROOT="${ARG#--root=}" ;;
    --portable-data=*) PORTABLE_DATA="${ARG#--portable-data=}" ;;
    --launch=*) LAUNCH="${ARG#--launch=}" ;;
  esac
done

if [ -z "$PID" ] || [ -z "$ARTIFACT" ] || [ -z "$BUNDLE" ] || [ -z "$ROOT" ]; then
  echo "portable-updater-mac: missing required args" >&2
  exit 1
fi

while kill -0 "$PID" 2>/dev/null; do
  sleep 1
done

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/clawclaw-portable-update.XXXXXX")"
EXTRACT_DIR="$TMP_DIR/extracted"
BACKUP_DATA="$TMP_DIR/portable-data"
mkdir -p "$EXTRACT_DIR"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [ -d "$PORTABLE_DATA" ]; then
  cp -R "$PORTABLE_DATA" "$BACKUP_DATA"
fi

unzip -q "$ARTIFACT" -d "$EXTRACT_DIR"

PACKAGE_ROOT="$(find "$EXTRACT_DIR" -maxdepth 1 -type d ! -path "$EXTRACT_DIR" | head -n 1)"
if [ -z "$PACKAGE_ROOT" ]; then
  PACKAGE_ROOT="$EXTRACT_DIR"
fi

NEW_BUNDLE="$(find "$PACKAGE_ROOT" -maxdepth 2 -name 'ClawClaw.app' -type d | head -n 1)"
if [ -z "$NEW_BUNDLE" ]; then
  echo "portable-updater-mac: ClawClaw.app not found in package" >&2
  exit 1
fi

rm -rf "$BUNDLE"
cp -R "$NEW_BUNDLE" "$BUNDLE"

if [ -d "$BACKUP_DATA" ]; then
  rm -rf "$BUNDLE/Contents/Resources/portable"
  mkdir -p "$BUNDLE/Contents/Resources"
  cp -R "$BACKUP_DATA" "$BUNDLE/Contents/Resources/portable"
fi

NEW_LAUNCHER="$(find "$PACKAGE_ROOT" -maxdepth 2 -name 'Start ClawClaw.command' -type f | head -n 1)"
if [ -n "$NEW_LAUNCHER" ]; then
  cp "$NEW_LAUNCHER" "$ROOT/Start ClawClaw.command"
  chmod +x "$ROOT/Start ClawClaw.command"
fi

if [ -n "$LAUNCH" ] && [ -e "$LAUNCH" ]; then
  if [ -x "$LAUNCH" ]; then
    nohup "$LAUNCH" >/dev/null 2>&1 &
  else
    nohup open "$LAUNCH" >/dev/null 2>&1 &
  fi
elif [ -e "$BUNDLE" ]; then
  nohup open "$BUNDLE" >/dev/null 2>&1 &
fi
