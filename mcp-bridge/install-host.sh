#!/usr/bin/env bash
# 安装 Firefox native messaging 宿主清单。
# 用法：./install-host.sh <firefox-extension-id>
# extension id 可在 about:debugging 的“此 Firefox → 临时附加组件”或已安装扩展详情页查看。
set -euo pipefail

HOST_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$HOST_DIR/native-host.mjs"
MANIFEST_NAME="com.browsertoolbox.mcp.json"
TEMPLATE="$HOST_DIR/$MANIFEST_NAME.template"

EXT_ID="${1:-}"
if [ -z "$EXT_ID" ]; then
  echo "用法: $0 <firefox-extension-id>" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) TARGET="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts" ;;
  Linux*) TARGET="$HOME/.mozilla/native-messaging-hosts" ;;
  *) echo "仅支持 macOS / Linux" >&2; exit 1 ;;
esac

mkdir -p "$TARGET"
sed -e "s|__PATH__|$HOST_PATH|g" -e "s|__EXT_ID__|$EXT_ID|g" "$TEMPLATE" > "$TARGET/$MANIFEST_NAME"
chmod +x "$HOST_PATH"
echo "已安装宿主清单：$TARGET/$MANIFEST_NAME"
echo "宿主脚本：$HOST_PATH"
