#!/bin/sh
# Guild Butler Capture — one-time privileged install of the BPF helper.
#
# Run ONCE with admin rights (osascript "with administrator privileges" — the
# app itself never runs as root and never asks for sudo). Arguments:
#   $1  the login user to grant capture access to
#   $2  the directory holding fix-bpf.sh + the LaunchDaemon plist
#
# What it sets up (the ChmodBPF approach, see fix-bpf.sh):
#   1. an access_bpf group with the user in it
#   2. a LaunchDaemon that re-relaxes /dev/bpf* group access at every boot
#   3. a CURRENT-SESSION bridge: group membership is stamped at login, so the
#      freshly added user would otherwise have to log out and back in once.
#      Handing today's devices to the user directly covers the gap; devfs
#      forgets it at reboot, exactly when the daemon + group take over.

set -e

TARGET_USER="$1"
SRC_DIR="$2"
GROUP="access_bpf"
DEST="/Library/Application Support/Guild Butler Capture"
PLIST="/Library/LaunchDaemons/com.guildbutler.capture.bpf.plist"

if [ -z "$TARGET_USER" ] || [ -z "$SRC_DIR" ]; then
  echo "usage: install-bpf-helper.sh <user> <resource-dir>" >&2
  exit 2
fi

# 1. group + membership
if ! dscl . -read "/Groups/$GROUP" >/dev/null 2>&1; then
  dseditgroup -o create -r "Guild Butler Capture BPF access" "$GROUP"
fi
dseditgroup -o edit -a "$TARGET_USER" -t user "$GROUP"

# 2. boot daemon
mkdir -p "$DEST"
cp "$SRC_DIR/fix-bpf.sh" "$DEST/fix-bpf.sh"
chown root:wheel "$DEST/fix-bpf.sh"
chmod 755 "$DEST/fix-bpf.sh"
cp "$SRC_DIR/com.guildbutler.capture.bpf.plist" "$PLIST"
chown root:wheel "$PLIST"
chmod 644 "$PLIST"
launchctl bootstrap system "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null || true

# 3. make it work right now, this login session
sh "$DEST/fix-bpf.sh"
chown "$TARGET_USER" /dev/bpf* 2>/dev/null || true

exit 0
