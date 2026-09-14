#!/bin/sh
set -eu

tracked_forbidden="$(git ls-files | rg '(^|/)(node_modules|dist|coverage)(/|$)|\.(db|sqlite|sqlite3|jpg|jpeg|png|webp|gif)$' || true)"
tracked_env="$(git ls-files | rg '(^|/)\.env($|\.)' | rg -v '(^|/)\.env\.example$' || true)"

if [ -n "$tracked_forbidden" ] || [ -n "$tracked_env" ]; then
  echo "Repository audit failed: forbidden generated, database, image or environment files are tracked." >&2
  exit 1
fi

if git grep -q -i -E '(bankrupt|bankrot|ruslan|threads-bankruptcy|72\.56\.73\.47|teletype)' -- ':!package-lock.json' ':!miniapp/package-lock.json' ':!scripts/audit-repository.sh'; then
  echo "Repository audit failed: isolated client markers were found." >&2
  exit 1
fi

if git grep -q -E '(BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|sk-[A-Za-z0-9_-]{20,}|[0-9]{8,10}:[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})' -- ':!package-lock.json' ':!miniapp/package-lock.json'; then
  echo "Repository audit failed: a credential-like value was found." >&2
  exit 1
fi

echo "Repository audit passed."
