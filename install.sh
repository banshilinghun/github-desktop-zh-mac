#!/bin/bash
# GitHub Desktop 3.6.10 简体中文补丁 · macOS 版安装器
# 用法:
#   ./install.sh                      应用补丁（默认 /Applications/GitHub Desktop.app）
#   ./install.sh --restore            还原英文原版
#   ./install.sh --verify             只校验兼容性，不改动任何文件
#   ./install.sh --app "/path/GitHub Desktop.app"   指定应用位置
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PAYLOAD="$HERE/payload"
MANIFEST="$PAYLOAD/manifest.json"
APP="/Applications/GitHub Desktop.app"
MODE="install"
PY=/usr/bin/python3

while [ $# -gt 0 ]; do
  case "$1" in
    --restore) MODE="restore" ;;
    --verify)  MODE="verify" ;;
    --app)     shift; APP="${1:-}"; [ -n "$APP" ] || { echo "缺少 --app 的路径参数" >&2; exit 2; } ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -d "$APP" ] || { echo "找不到应用: $APP" >&2; exit 1; }
APP="$(cd "$APP" && pwd)"
RES="$APP/Contents/Resources/app"
[ -f "$RES/package.json" ] || { echo "不是 GitHub Desktop 应用包: $APP" >&2; exit 1; }
[ -f "$MANIFEST" ] || { echo "缺少 payload/manifest.json，请在完整解压后的目录里执行" >&2; exit 1; }
command -v "$PY" >/dev/null || { echo "需要 python3（macOS 命令行工具自带）" >&2; exit 1; }

sha() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print toupper($1)}'; }

# 一次性读出清单: 第一行 version<TAB>occurrences，之后每行 name<TAB>original<TAB>patched
TABLE="$("$PY" - "$MANIFEST" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print(f"{m['version']}\t{m['occurrences']}")
for f in m["files"]:
    print(f"{f['name']}\t{f['original']}\t{f['patched']}")
PY
)"
MANIFEST_VERSION="$(printf '%s\n' "$TABLE" | sed -n '1p' | cut -f1)"
COUNT="$(printf '%s\n' "$TABLE" | sed -n '1p' | cut -f2)"
ROWS="$(printf '%s\n' "$TABLE" | sed -n '2,$p')"
FILES="$(printf '%s\n' "$ROWS" | cut -f1)"

row() { printf '%s\n' "$ROWS" | /usr/bin/awk -F'\t' -v n="$1" '$1==n{print $2"\t"$3}'; }

PRODUCT="$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1]))["name"])' "$RES/package.json")"
VERSION="$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$RES/package.json")"
[ "$PRODUCT" = "desktop" ] || { echo "不支持的产品: $PRODUCT" >&2; exit 1; }
[ "$VERSION" = "$MANIFEST_VERSION" ] || {
  echo "版本不符: 应用 $VERSION / 补丁 ${MANIFEST_VERSION}。未改动任何文件。" >&2; exit 1; }

if [ "$MODE" != "verify" ] && pgrep -f "$APP/Contents/MacOS/GitHub Desktop" >/dev/null 2>&1; then
  echo "GitHub Desktop 正在运行，请先完全退出（⌘Q）后重试。未改动任何文件。" >&2
  exit 1
fi

BACKUP="$RES/.zh-original-$MANIFEST_VERSION"
PLANS=()
for f in $FILES; do
  target="$RES/$f"; payload="$PAYLOAD/$f"; backup="$BACKUP/$f"
  [ -f "$target" ] || { echo "缺少目标文件: $target" >&2; exit 1; }
  [ -f "$payload" ] || { echo "缺少补丁文件: ${payload}（请完整解压）" >&2; exit 1; }
  IFS=$'\t' read -r orig patched <<<"$(row "$f")"
  current="$(sha "$target")"
  # 安装要求当前文件处于"原始"或"本补丁"状态；还原只以备份为准，允许当前文件是任何旧版补丁。
  if [ "$MODE" = "install" ] && [ "$current" != "$orig" ] && [ "$current" != "$patched" ]; then
    echo "文件已被其他工具修改或被更新，拒绝安装: ${f}（未改动任何文件）" >&2; exit 1
  fi
  [ "$(sha "$payload")" = "$patched" ] || { echo "补丁文件校验失败: ${f}（未改动任何文件）" >&2; exit 1; }
  if [ -f "$backup" ] && [ "$(sha "$backup")" != "$orig" ]; then
    echo "原始备份校验失败: ${backup}（未改动任何文件）" >&2; exit 1
  fi
  if [ "$MODE" = "restore" ]; then
    [ "$current" = "$orig" ] && continue
    [ -f "$backup" ] || { echo "缺少原始备份，无法还原: $f" >&2; exit 1; }
  else
    [ "$current" = "$patched" ] && continue
  fi
  PLANS+=("$f")
done

if [ "$MODE" = "verify" ]; then
  echo "校验通过：GitHub Desktop ${VERSION}，清单内 3 个文件均匹配。未改动任何文件。"
  exit 0
fi
if [ "${#PLANS[@]}" -eq 0 ]; then
  echo "已经是目标状态，无需改动。"
  exit 0
fi

if [ "$MODE" = "install" ]; then
  /bin/mkdir -p "$BACKUP"
  for f in "${PLANS[@]}"; do
    [ -f "$BACKUP/$f" ] || /bin/cp -p "$RES/$f" "$BACKUP/$f"
  done
fi

DONE=()
rollback() {
  for f in ${DONE[@]+"${DONE[@]}"}; do
    if [ "$MODE" = "restore" ]; then /bin/cp -p "$PAYLOAD/$f" "$RES/$f" 2>/dev/null || true
    else /bin/cp -p "$BACKUP/$f" "$RES/$f" 2>/dev/null || true; fi
  done
}
trap rollback ERR

for f in "${PLANS[@]}"; do
  src="$PAYLOAD/$f"; [ "$MODE" = "restore" ] && src="$BACKUP/$f"
  /bin/cp -p "$src" "$RES/$f.zh-stage"
  /bin/mv -f "$RES/$f.zh-stage" "$RES/$f"
  DONE+=("$f")
done
trap - ERR

for f in $FILES; do
  IFS=$'\t' read -r orig patched <<<"$(row "$f")"
  want="$patched"; [ "$MODE" = "restore" ] && want="$orig"
  if [ "$(sha "$RES/$f")" != "$want" ]; then
    echo "最终校验失败，正在回滚: $f" >&2; rollback; exit 1
  fi
done

# 改动 Resources 会让 GitHub 的代码签名与公证信息失效，这里重新做本地临时签名，
# 否则 macOS 可能以“应用已损坏”为由拒绝启动。
SIG="已重新签名（本地临时签名，取代 GitHub 官方签名）"
if ! /usr/bin/codesign --force --deep --sign - "$APP" >/dev/null 2>&1; then
  SIG="重新签名失败；若无法启动，请手动执行: codesign --force --deep --sign - \"$APP\""
fi
/usr/bin/xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1 || true

if [ "$MODE" = "install" ]; then
  echo "安装完成：替换 $COUNT 处文案。$SIG"
  echo "原始备份: $BACKUP"
  echo "现在可以重新打开 GitHub Desktop。"
else
  echo "还原完成。$SIG"
fi
