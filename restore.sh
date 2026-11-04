#!/bin/bash
# 还原为英文原版
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
exec "$HERE/install.sh" --restore "$@"
