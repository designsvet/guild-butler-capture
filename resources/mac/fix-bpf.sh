#!/bin/sh
# Guild Butler Capture — boot-time BPF permission fix.
#
# Installed to /Library/Application Support/Guild Butler Capture/ and run at
# every boot by the com.guildbutler.capture.bpf LaunchDaemon (as root). This is
# Wireshark's ChmodBPF approach, reimplemented: devfs recreates /dev/bpf* with
# root-only permissions on every boot, so a one-shot chmod cannot stick — a
# boot daemon is the mechanism, an access_bpf group is the scope (capture stays
# limited to users deliberately added to that group, never world-readable).

GROUP="access_bpf"

# Force a handful of bpf devices to exist before relaxing them: macOS clones
# the next device on open, and a freshly booted machine may only show bpf0.
FORCE_DEVICES=8
n=0
while [ "$n" -lt "$FORCE_DEVICES" ]; do
  # Opening the device is enough to materialise it; failure (busy) is fine.
  head -c 0 "/dev/bpf$n" >/dev/null 2>&1
  n=$((n + 1))
done

chgrp "$GROUP" /dev/bpf* 2>/dev/null
chmod g+rw /dev/bpf* 2>/dev/null

exit 0
