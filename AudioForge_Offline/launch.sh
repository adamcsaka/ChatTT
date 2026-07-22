#!/usr/bin/env bash
#
# SoundSculpture – dedikált asztali ablakban indító (GNOME / X11 / Wayland)
#
# Miért jobb ez, mint egy sima böngészőfül?
#   - Külön ablak + külön folyamat, ezért a böngésző NEM teszi háttér-throttle
#     alá, amikor másik tabra/ablakra váltasz -> kevesebb / nincs recsegés.
#   - A throttle-tiltó kapcsolók csak új böngészőfolyamatnál érvényesülnek,
#     ezért dedikált --user-data-dir profilt használunk.
#
# Használat:  ./launch.sh
#
set -euo pipefail

# A script könyvtára (így akkor is működik, ha máshová másolod a mappát)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# A betöltendő HTML fájl (ugyanabban a mappában)
HTML_FILE="$SCRIPT_DIR/index.html"

if [ ! -f "$HTML_FILE" ]; then
  echo "HIBA: nem találom a fájlt: $HTML_FILE" >&2
  exit 1
fi

# file:// URL korrekt százalék-kódolással (szóközök, ékezetek)
FILE_URL="$(python3 - "$HTML_FILE" <<'PY'
import sys, pathlib
print(pathlib.Path(sys.argv[1]).resolve().as_uri())
PY
)"

# Külön profil, hogy a kapcsolók biztosan érvényesüljenek és ne zavarjon
# bele a normál böngésződ
PROFILE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/soundsculpture-profile"
mkdir -p "$PROFILE_DIR"

# Hangbarát kapcsolók
FLAGS=(
  --app="$FILE_URL"
  --user-data-dir="$PROFILE_DIR"
  --class=SoundSculpture
  --disable-background-timer-throttling
  --disable-renderer-backgrounding
  --disable-backgrounding-occluded-windows
  --disable-features=CalculateWindowOcclusion
  --enable-exclusive-audio
  --autoplay-policy=no-user-gesture-required
  --allow-file-access-from-files
)

# Elérhető böngésző kiválasztása (Chrome -> Chromium -> Brave flatpak)
if command -v google-chrome >/dev/null 2>&1; then
  exec google-chrome "${FLAGS[@]}"
elif command -v google-chrome-stable >/dev/null 2>&1; then
  exec google-chrome-stable "${FLAGS[@]}"
elif command -v chromium >/dev/null 2>&1; then
  exec chromium "${FLAGS[@]}"
elif command -v chromium-browser >/dev/null 2>&1; then
  exec chromium-browser "${FLAGS[@]}"
elif command -v brave-browser >/dev/null 2>&1; then
  exec brave-browser "${FLAGS[@]}"
elif command -v flatpak >/dev/null 2>&1 && flatpak info com.brave.Browser >/dev/null 2>&1; then
  exec flatpak run --filesystem=host com.brave.Browser "${FLAGS[@]}"
else
  echo "HIBA: nem találtam Chromium-alapú böngészőt (Chrome/Chromium/Brave)." >&2
  exit 1
fi
