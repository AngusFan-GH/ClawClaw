#!/bin/bash
# ClawClaw Portable Launcher (macOS)
# Double-click this file to start ClawClaw from USB.
#
# If macOS blocks the app with a Gatekeeper dialog ("cannot be opened"),
# run this script once from Terminal first:
#   chmod +x "Start ClawClaw.command"
#   ./Start ClawClaw.command
#
# All data is stored in the "portable/" directory next to the app bundle.

# ── Resolve script location ───────────────────────────────────────────────────
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)"

# ── Locate the app bundle ─────────────────────────────────────────────────────
# The script and .app are in the same directory (same level inside the zip).
APP_NAME="ClawClaw.app"
APP_PATH="$SCRIPT_PATH/$APP_NAME"

if [ ! -d "$APP_PATH" ]; then
    osascript -e "tell app \"System Events\" to display dialog \"$APP_NAME not found in: $SCRIPT_PATH\" buttons {\"OK\"} with title \"ClawClaw Portable\""
    exit 1
fi

# ── Clear macOS Gatekeeper quarantine ───────────────────────────────────────
# Files copied from USB drives retain the quarantine flag, which causes
# Gatekeeper to block app launch. Remove it so the app can run freely.
if [ "$(uname)" = "Darwin" ]; then
    if xattr -l "$APP_PATH" 2>/dev/null | grep -q "com.apple.quarantine"; then
        xattr -rd com.apple.quarantine "$APP_PATH" 2>/dev/null
        xattr -rd com.apple.quarantine "$SCRIPT_PATH" 2>/dev/null
    fi
fi

# ── Launch ───────────────────────────────────────────────────────────────────
open "$APP_PATH"
