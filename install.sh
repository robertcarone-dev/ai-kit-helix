#!/bin/sh
# Convenience entry point; all installation behavior lives in scripts/install.mjs.
set -eu

if [ "$#" -eq 0 ] || [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  cat <<'HELP'
Usage: ./install.sh preview|install|update|remove --project-root DIR [OPTIONS]

Options forwarded to the Node installer:
  --rules helix|all|none  Reference rules, all workflow rules, or none (default)
  --init                 Create absent project configuration templates
  --unity-helper         Install optional Unity Editor comparison infrastructure
  --copy-skills          Copy Codex skills instead of using local symlinks
  --adopt-legacy         Accept only exact known pre-extraction file hashes

Start with:
  ./install.sh preview --project-root /path/to/project --rules helix --init
  ./install.sh install --project-root /path/to/project --rules helix --init

Requires Node.js >=22.18. Installs project files only. Then run:
  npm ci --prefix /path/to/project/Tools/Helix
  npm run install-browser --prefix /path/to/project/Tools/Helix
HELP
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js >=22.18 is required on PATH. Install Node, then retry.' >&2
  exit 1
fi
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1)'; then
  echo 'Node.js >=22.18 is required. Upgrade Node, then retry.' >&2
  exit 1
fi

TOOLKIT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec node "$TOOLKIT_DIR/scripts/install.mjs" "$@"
