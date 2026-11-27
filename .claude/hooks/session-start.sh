#!/bin/bash
# 開新對話時自動同步最新的 main（杜杜龍 2026-11-20：不用每次叫 AI「先同步最新程式」）。
# 絕不破壞任何東西：有未提交的修改、或分支上有自己還沒合併的提交時，只提醒、不動程式。
# 輸出的文字會顯示給這次對話的 AI 看，所以寫成給 AI 的指示。
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# 開工簡報（杜杜龍 2026-11-27，與行動大學一致）：不論後面走哪條路都會印出，任何一步失敗都略過。
briefing() {
  echo "【開工簡報】"
  live=$(curl -s -m 5 https://id.hglobal1985.com/handoff/learn 2>/dev/null | head -1 | grep -o '版本 [0-9.-]*' | cut -d' ' -f2)
  code=$(git show origin/main:src/apps/handoff.ts 2>/dev/null | grep -o 'HANDOFF_VERSION = "[^"]*"' | cut -d'"' -f2)
  echo "- 串接指令：main 是 ${code:-?}，正式站是 ${live:-讀不到}$( [ -n "$live" ] && [ "$live" != "$code" ] && echo "（不一樣：main 還沒部署到正式站，或有人從別的分支部署）")"
  echo "- 最新 migration：$(git ls-tree --name-only origin/main migrations/ 2>/dev/null | tail -1 | sed 's|migrations/||')"
  echo "- main 最近合併的工作（新到舊）："
  git log origin/main -6 --format='  %cs %s' 2>/dev/null
  echo "- 守則：先讀 AGENTS.md；改串接指令要升版本號；本機 npm run ci 通過才開 PR；合併後先等 staging 成功再部署 production。"
}
trap briefing EXIT

if ! git fetch origin main --quiet 2>/dev/null; then
  echo "【自動同步】抓不到最新的 main（網路問題）。開工前請自己執行 git fetch origin main 確認。"
  exit 0
fi

branch=$(git rev-parse --abbrev-ref HEAD)
origin=$(git rev-parse origin/main)
head=$(git rev-parse HEAD)
short=$(git rev-parse --short origin/main)

if [ "$head" = "$origin" ]; then
  echo "【自動同步】已是最新的 main（$short）。請遵守 CLAUDE.md「多個 AI 輪流開發的協作守則」。"
  exit 0
fi

dirty=$(git status --porcelain)
ahead=$(git rev-list --count origin/main..HEAD)
behind=$(git rev-list --count HEAD..origin/main)

if [ -z "$dirty" ] && [ "$ahead" = "0" ]; then
  # 這個分支沒有任何自己的提交：直接移到最新的 main（只是移動指標，不會弄丟東西）。
  if git merge --ff-only origin/main --quiet 2>/dev/null; then
    echo "【自動同步】分支 $branch 已更新到最新的 main（$short，落後的 $behind 個提交已補上）。請在這份最新程式上開工。"
    exit 0
  fi
fi

echo "【自動同步】分支 $branch 比最新的 main（$short）落後 $behind 個提交、自己有 $ahead 個還沒合併的提交$( [ -n "$dirty" ] && echo "、而且有未提交的修改")。"
echo "為了不弄丟東西，這次沒有自動更新。開工前請先處理：把 origin/main 合併進目前分支（衝突時兩邊的內容都要保留），或先把目前的成果合併進 main。部署照 AGENTS.md「工作流程」（只由合併進 main 後的 CI 部署，不手動部署）。"
exit 0
