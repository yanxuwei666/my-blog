---
title: "【实践应用】为 DeepSeek Harness 构建 Debian 包"
description: "目前 DeepSeek Harnesee 非常的火热，但是它只支持两种安装方式，一种是 npm 一种是源码安装，这两种方式对于开发人员还好，但是对于不懂技术的人员来说上手还是有些门槛，所以有必要将已有的 DSH 打包成通用的 Deb 包直接发给别人直接使用更加方便。"
pubDate: 2026-10-08
updatedDate: 2026-10-09
category: "AI 大模型"
tags: ["DeepSeek Harness", "AI 工具", "Debian", "Linux"]
draft: false
source: "siyuan"
siyuanId: "20260826094051-8ophd7i"
slug: "deepseek-harness-deb-05e2f11a"
sourceHash: "sha256:f014dfd34debbe2e8e8ed6679a898f5528242b5e97efedaba5368c3219f78947"
---
## 前言

目前 DeepSeek Harnesee 非常的火热，但是它只支持两种安装方式，一种是 npm 一种是源码安装，这两种方式对于开发人员还好，但是对于不懂技术的人员来说上手还是有些门槛，所以有必要将已有的 DSH 打包成通用的 Deb 包直接发给别人直接使用更加方便。

## 执行步骤

### 安装构建依赖

```bash
sudo apt update
sudo apt install -y ca-certificates curl xz-utils dpkg-dev build-essential python3 pkg-config
```

### 编写 Deb 生成脚本

在用户家目录下新建一个独立目录例如 `dsh-linux-packaging`​，然后创建 `build-deb.sh`，脚本内容如下：

```shell
#!/usr/bin/env bash
set -Eeuo pipefail

# 固定版本：构建时联网一次，把 Node / pnpm / DSH 源码 / node_modules 全部打进 deb。
# 目标机器（内网）运行 dsh / dsh web 不再访问 npm registry 或 GitHub。
DSH_VERSION="${DSH_VERSION:-0.1.1-rc.2}"
DSH_TAG="${DSH_TAG:-dsh-v0.1.1-rc.2}"
DEB_VERSION="${DEB_VERSION:-0.1.1~rc.2+2}"
NODE_VERSION="${NODE_VERSION:-24.19.0}"
PNPM_VERSION="${PNPM_VERSION:-11.7.0}"
OUTPUT_DIR="${OUTPUT_DIR:-$PWD/dist}"

# 设为 0 可跳过 Web 启动冒烟测试；默认必须测试。
RUN_WEB_SMOKE="${RUN_WEB_SMOKE:-1}"

for cmd in curl git tar dpkg dpkg-deb; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "缺少构建命令: $cmd" >&2
    echo "Ubuntu 20.04 可执行: sudo apt-get install -y curl git tar xz-utils dpkg-dev ca-certificates" >&2
    exit 1
  fi
done

DEB_ARCH="$(dpkg --print-architecture)"

case "$DEB_ARCH" in
  amd64)
    NODE_ARCH="x64"
    ;;
  arm64)
    NODE_ARCH="arm64"
    ;;
  *)
    echo "暂不支持的 Debian 架构: $DEB_ARCH" >&2
    exit 1
    ;;
esac

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

ROOT="$WORK_DIR/root"
PREFIX="$ROOT/usr/lib/deepseek-harness"
SOURCE_DIR="$PREFIX/source"
TOOLING_DIR="$PREFIX/tooling"

NODE_TARBALL="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"

PACKAGE_FILE="$OUTPUT_DIR/deepseek-harness_${DEB_VERSION}_${DEB_ARCH}.deb"

if [ -e "$PACKAGE_FILE" ]; then
  echo "目标包已存在，不覆盖: $PACKAGE_FILE" >&2
  exit 1
fi

mkdir -p \
  "$OUTPUT_DIR" \
  "$ROOT/usr/bin" \
  "$ROOT/usr/share/applications" \
  "$ROOT/usr/share/doc/deepseek-harness" \
  "$ROOT/DEBIAN" \
  "$PREFIX"

echo "==> 构建机: $(uname -a)"
echo "==> Git: $(git --version)"

echo "==> 下载 Node.js ${NODE_VERSION} (${NODE_ARCH})"
curl -fsSLo "$WORK_DIR/$NODE_TARBALL" "$NODE_URL"

echo "==> 解压 Node.js"
tar -xJf "$WORK_DIR/$NODE_TARBALL" -C "$WORK_DIR"

cp -a \
  "$WORK_DIR/node-v${NODE_VERSION}-linux-${NODE_ARCH}" \
  "$PREFIX/node"

# npm/pnpm 的 shebang 是 `#!/usr/bin/env node`。构建机（尤其是 Ubuntu 20 内网机）
# 不一定有系统 Node，必须把捆绑 Node 放到 PATH 最前。
export PATH="$PREFIX/node/bin:$PATH"

echo "==> 捆绑 Node: $("$PREFIX/node/bin/node" --version)"

PNPM_BIN="$TOOLING_DIR/node_modules/.bin/pnpm"

echo "==> 安装包内 pnpm ${PNPM_VERSION}"
"$PREFIX/node/bin/npm" install \
  --prefix "$TOOLING_DIR" \
  --omit=dev \
  --no-audit \
  --no-fund \
  "pnpm@${PNPM_VERSION}"

test -x "$PNPM_BIN"

echo "==> 克隆官方 DSH 源码: ${DSH_TAG}"
git clone \
  --depth 1 \
  --branch "$DSH_TAG" \
  "https://github.com/deepseek-ai/deepseek-harness.git" \
  "$SOURCE_DIR"

# 打包不需要开发者 Git hooks。上游根目录 postinstall 会跑 install-lefthook.mjs，
# 要求 Git >= 2.26（Ubuntu 20.04 自带 2.25.1），否则 pnpm install 直接失败。
# 只挖空这一个脚本，保留 subprocess-local 的 ensure-spawn-helper（运行时需要）。
printf '%s\n' '#!/usr/bin/env node' 'process.exit(0)' \
  > "$SOURCE_DIR/scripts/install-lefthook.mjs"

# 把 store 里的文件复制进包内，避免 node_modules 硬链到构建机全局 pnpm store，
# 打成 deb / 拷到内网后出现断链。
cat >> "$SOURCE_DIR/.npmrc" <<'EOF'
package-import-method=copy
EOF

echo "==> 安装完整 DSH workspace 依赖（仅构建时联网）"
(
  cd "$SOURCE_DIR"

  # CI=true / GITHUB_ACTIONS=true 是上游 install-lefthook.mjs 的官方跳过开关。
  export CI=true
  export GITHUB_ACTIONS=true
  export PATH="$PREFIX/node/bin:$TOOLING_DIR/node_modules/.bin:$PATH"

  "$PNPM_BIN" install --frozen-lockfile

  echo "==> 确认依赖树可离线复用（失败说明安装不完整，内网必挂）"
  "$PNPM_BIN" install --offline --frozen-lockfile

  echo "==> 构建 DSH"
  "$PNPM_BIN" run build
)

echo "==> 去掉运行时不需要的 .git"
rm -rf "$SOURCE_DIR/.git"

echo "==> 审计 node_modules：不允许链接到包外部"

audit_symlinks() {
  local tree="$1"
  local link_path
  local resolved_path

  while IFS= read -r -d '' link_path; do
    resolved_path="$(readlink -f "$link_path")"

    case "$resolved_path" in
      "$tree"/*)
        ;;
      *)
        echo "发现包外部符号链接：" >&2
        echo "  链接: $link_path" >&2
        echo "  指向: $resolved_path" >&2
        exit 1
        ;;
    esac
  done < <(find "$tree" -type l -print0)
}

audit_symlinks "$SOURCE_DIR"
audit_symlinks "$TOOLING_DIR"

echo "==> 创建可安装、也可直接解压运行的 dsh 启动器"

cat > "$ROOT/usr/bin/dsh" <<'EOF'
#!/bin/sh
set -eu

# 支持两种形式：
#
# 1. dpkg 安装后：
#    /usr/bin/dsh web
#
# 2. 直接解压 deb 后：
#    <解压目录>/usr/bin/dsh web
#
BIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DSH_ROOT="$(CDPATH= cd -- "$BIN_DIR/../lib/deepseek-harness" && pwd)"

# pnpm 只在 `dsh plugin ...` 管理第三方插件时使用。
# 普通 dsh 启动不调用 pnpm/npm，也不访问 npm registry。
export PATH="$DSH_ROOT/node/bin:$DSH_ROOT/tooling/node_modules/.bin:$PATH"

# 禁止 corepack 在内网尝试再下载一份 pnpm。
export COREPACK_ENABLE_NETWORK=0
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

cd "$DSH_ROOT/source"

# 等同于源码 package.json 的 pnpm dsh，
# 但直接使用 deb 内置的 Node.js，不要求系统存在 Node/npm/pnpm。
exec "$DSH_ROOT/node/bin/node" \
  --import tsx/esm \
  apps/cli/src/bin.ts \
  "$@"
EOF

chmod 0755 "$ROOT/usr/bin/dsh"

echo "==> 创建桌面启动项"

cat > "$ROOT/usr/share/applications/deepseek-harness.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=DeepSeek Harness
Comment=Run DeepSeek Harness Web UI
Exec=dsh web
Terminal=false
Categories=Development;Utility;
EOF

echo "==> 写入许可证与第三方声明"

cp "$SOURCE_DIR/LICENSE" \
  "$ROOT/usr/share/doc/deepseek-harness/copyright"

cp "$SOURCE_DIR/THIRD_PARTY_NOTICES.md" \
  "$ROOT/usr/share/doc/deepseek-harness/THIRD_PARTY_NOTICES.md"

echo "==> 创建 Debian 控制信息"

cat > "$ROOT/DEBIAN/control" <<EOF
Package: deepseek-harness
Version: ${DEB_VERSION}
Section: devel
Priority: optional
Architecture: ${DEB_ARCH}
Maintainer: Your Name <you@example.com>
Depends: libc6 (>= 2.31), libstdc++6, zlib1g, ca-certificates
Recommends: xdg-utils
Description: DeepSeek Harness with fully bundled offline runtime
 DeepSeek Harness (DSH) Web UI with bundled Node.js, pnpm,
 source build, workspace packages, and all runtime dependencies.
 No Node.js, npm, pnpm, or DSH dependency download is required
 on the target machine.
EOF

echo "==> 构建 deb 包"

dpkg-deb --root-owner-group --build "$ROOT" "$PACKAGE_FILE"

echo "==> 验证：直接解压 deb 后也可运行"

EXTRACT_DIR="$WORK_DIR/extracted"

dpkg-deb -x "$PACKAGE_FILE" "$EXTRACT_DIR"

DSH_HOME="$WORK_DIR/extracted-dsh-home" \
  "$EXTRACT_DIR/usr/bin/dsh" --version

if [ "$RUN_WEB_SMOKE" = "1" ]; then
  echo "==> 验证：直接解压 deb 后可启动 DSH Web"

  SMOKE_LOG="$WORK_DIR/dsh-web-smoke.log"

  set +e
  DSH_HOME="$WORK_DIR/extracted-dsh-home" \
    timeout 45s "$EXTRACT_DIR/usr/bin/dsh" web --no-open \
    >"$SMOKE_LOG" 2>&1
  SMOKE_STATUS=$?
  set -e

  if ! grep -q "dsh web: http://" "$SMOKE_LOG"; then
    echo "DSH Web 冒烟测试失败，日志如下：" >&2
    cat "$SMOKE_LOG" >&2
    exit 1
  fi

  case "$SMOKE_STATUS" in
    0|124)
      ;;
    *)
      echo "DSH Web 异常退出，退出码: $SMOKE_STATUS" >&2
      cat "$SMOKE_LOG" >&2
      exit 1
      ;;
  esac
fi

echo
echo "构建成功：$PACKAGE_FILE"
echo
echo "可直接解压验证："
echo "  mkdir dsh-extracted"
echo "  dpkg-deb -x \"$PACKAGE_FILE\" dsh-extracted"
echo "  dsh-extracted/usr/bin/dsh web"
echo
echo "内网说明：普通 dsh / dsh web 不再访问 npm registry。"
echo "仅 \`dsh plugin add <包>\` 安装第三方插件时才需要可达的 registry。"
```

### 构建 Deb 包

执行命令如下：

```bash
# 赋予deb包可执行权限
chmod +x ~/dsh-linux-packaging/build-deb.sh

# 执行脚本生成deb包
~/dsh-linux-packagingbuild-deb.sh

# 生成的产物会在dist目录下有个类似deepseek-harness_0.1.1~rc.2+1_amd64.deb的包
```

### 解压缩 Deb 包

执行命令如下：

```bash
sudo dpkg -i dist/deepseek-harness_0.1.1~rc.2+1_amd64.deb

# 查看生成deepseek harness目录
ll /usr/lib/deepseek-harness

# 查看可执行的dsh命令
ll /usr/bin/dsh
```

### 清除解压缩的 Deb 包

```bash
sudo dpkg -P deepseek-harness
sudo rm -rf /usr/lib/deepseek-harness
rm -f dist/deepseek-harness_*.deb
```
