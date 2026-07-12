#!/usr/bin/env bash
# @koyomi-cal/react の公開物スモークテスト。
#
# `npm pack` で作った tarball を一時ディレクトリへインストールし、
# 素の Node から次の 4 経路すべてで読み込めることを確認する。
#   - ESM import  トップレベル（@koyomi-cal/react）
#   - ESM import  ./core（@koyomi-cal/react/core）
#   - CJS require トップレベル
#   - CJS require ./core
# あわせて RRULE 展開が期待どおり動くことも検証する（rrule のバンドルが
# devDependency の状態でも動作することの確認が本質）。
#
# リポジトリルートから実行する: bash scripts/pack-smoke-test.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/react-calendar"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> tarball を作成"
TARBALL="$(cd "$PKG_DIR" && npm pack --pack-destination "$WORK_DIR" | tail -1)"

SMOKE_DIR="$WORK_DIR/smoke"
mkdir -p "$SMOKE_DIR"
cd "$SMOKE_DIR"

echo "==> tarball をインストール"
npm init -y >/dev/null
npm install --no-save "$WORK_DIR/$TARBALL" react react-dom >/dev/null

RUN_JS='
function run(m, label) {
  const cal = m.createCalendar({
    timeZone: "Asia/Tokyo",
    events: [{ id: "1", title: "t", start: "2026-07-01T10:00", rrule: "FREQ=DAILY;COUNT=3" }],
  });
  const count = cal.getOccurrences({
    start: new Date("2026-06-30T00:00:00Z"),
    end: new Date("2026-07-10T00:00:00Z"),
  }).length;
  if (count !== 3) {
    throw new Error("RRULE 展開が期待どおりでない: " + count);
  }
  console.log(label + " OK");
}
'

echo "==> ESM import（トップレベル / ./core）"
node --input-type=module -e "
$RUN_JS
const top = await import('@koyomi-cal/react');
run(top, 'ESM import（トップレベル）');
const core = await import('@koyomi-cal/react/core');
run(core, 'ESM import（./core）');
"

echo "==> CJS require（トップレベル / ./core）"
node -e "
$RUN_JS
run(require('@koyomi-cal/react'), 'CJS require（トップレベル）');
run(require('@koyomi-cal/react/core'), 'CJS require（./core）');
"

echo "==> スモークテスト全経路 OK"
