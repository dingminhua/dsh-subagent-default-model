#!/usr/bin/env bash
# 修复 web profile 的 peer 依赖"模块双胞胎"问题。
#
# 成因：对 ~/.dsh/profiles/web 跑 pnpm install/add 后，pnpm 会把部分
# @deepseek-ai/* peer 依赖以真实目录装进 web/node_modules/@deepseek-ai/。
# 宿主 DSH 的包从 ~/.dsh/profiles/node_modules（npx 缓存 symlink）加载，
# Node 就近解析让 profile 内副本抢先 → 同一进程两份 dsh-tools。
# dsh-tools 用 Symbol()（非 Symbol.for）导出 TOOL_RUNTIME_SCHEDULER，
# 两份副本的 Symbol 不相等 → ctx.tools[...] 为 undefined →
# 任何工具调用 0ms 失败：Cannot read properties of undefined (reading 'prepare')
#
# 修复：把 web/node_modules/@deepseek-ai/ 下所有真实目录换成指向
# ~/.dsh/profiles/node_modules/@deepseek-ai/ 同名包的符号链接（原目录
# 备份到 node_modules/.dsh-twin-backup/），保证全进程单一实例。
#
# 幂等：可反复执行；已修复的会自动跳过。
# 用法：bash scripts/fix-module-twins.sh   （每次 pnpm install/add 后执行）

set -euo pipefail

PROFILE_DIR="${DSH_WEB_PROFILE:-$HOME/.dsh/profiles/web}"
SCOPE="$PROFILE_DIR/node_modules/@deepseek-ai"
TOP="$HOME/.dsh/profiles/node_modules/@deepseek-ai"
BAK="$PROFILE_DIR/node_modules/.dsh-twin-backup"

[ -d "$SCOPE" ] || { echo "未找到 $SCOPE，请确认 web profile 路径"; exit 1; }
mkdir -p "$BAK"

STAMP=$(date +%Y%m%d-%H%M%S)
fixed=0; skipped=0; missing_top=()
for dir in "$SCOPE"/*/; do
  pkg=$(basename "$dir")
  [ -L "${dir%/}" ] && { skipped=$((skipped+1)); continue; }   # 已是 symlink
  if [ ! -d "$TOP/$pkg" ]; then
    missing_top+=("$pkg"); continue                            # 顶层没有，无法指向
  fi
  dest="$BAK/$pkg"
  [ -e "$dest" ] && dest="$BAK/$pkg.$STAMP"                    # 已有旧备份则另存
  mv "${dir%/}" "$dest"
  ln -s "../../../node_modules/@deepseek-ai/$pkg" "$SCOPE/$pkg"
  echo "已修复: $pkg（备份于 $dest）"
  fixed=$((fixed+1))
done

echo "---"
echo "修复 $fixed 个，跳过（已是链接）$skipped 个"
((${#missing_top[@]})) && { echo "警告：顶层缺少同名包，未能修复：${missing_top[*]}"; }

# 自检：web profile 与宿主应解析到同一份
node -e '
const {createRequire}=require("module"), fs=require("fs"), os=require("os");
const w=createRequire(process.env.HOME+"/.dsh/profiles/web/package.json");
const h=createRequire(process.env.HOME+"/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js");
let bad=0;
for(const p of ["@deepseek-ai/dsh-tools","@deepseek-ai/cordis","@deepseek-ai/dsh-agent","@deepseek-ai/dsh-commands"]){
  try{
    const same=fs.realpathSync(w.resolve(p))===fs.realpathSync(h.resolve(p));
    console.log(p, same?"SAME":"TWIN!");
    if(!same) bad++;
  }catch(e){ console.log(p,"解析失败:",e.code||e.message); bad++; }
}
process.exit(bad?1:0);
' && echo "自检通过：全部 SAME" || { echo "自检失败：仍存在 TWIN，请把警告信息反馈给维护者"; exit 1; }

echo "完成。请重启 DSH web 进程使修复生效。"
