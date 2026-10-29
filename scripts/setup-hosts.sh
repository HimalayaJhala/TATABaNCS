#!/bin/sh
# Maps the BaNCS host names (open and closed book) to this machine so the address bar reads like the real thing.
# Needs sudo. Safe to run twice.
set -e
for h in online.bancs.omapps.net online.bancscb.omapps.net; do
  if grep -qE "^[^#]*[[:space:]]$h([[:space:]]|$)" /etc/hosts; then
    echo "already mapped: $h"
  else
    echo "127.0.0.1 $h" | sudo tee -a /etc/hosts >/dev/null
    echo "added: $h"
  fi
done
