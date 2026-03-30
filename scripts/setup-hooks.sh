#!/bin/sh

# Install git hooks from scripts/ into .git/hooks/

set -e

root="$(cd "$(dirname "$0")/.." && pwd)"
hooks_dir="$root/.git/hooks"

if [ ! -d "$hooks_dir" ]; then
  echo "No .git/hooks directory found, skipping hook setup."
  exit 0
fi

ln -sf ../../scripts/pre-push "$hooks_dir/pre-push"
echo "Installed pre-push hook."
