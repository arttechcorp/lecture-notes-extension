#!/usr/bin/env bash
# Serve the fixture from two ports (two origins) for cross-origin iframe testing.
cd "$(dirname "$0")"

python3 -m http.server 8123 & P8123=$!
python3 -m http.server 8124 & P8124=$!

cat <<EOF
Fixture servers running:
  http://localhost:8123/parent.html   cross-origin iframe video
  http://localhost:8123/nested.html   nested iframes (2 levels deep)
  http://localhost:8123/shadow.html   video inside shadow DOM
  http://localhost:8123/black.html    all-black video (protected)
  http://localhost:8124/frame.html    control: plain top-frame video

Press Ctrl-C to stop both servers (or: kill $P8123 $P8124).
EOF

trap 'kill $P8123 $P8124 2>/dev/null' INT TERM
wait
