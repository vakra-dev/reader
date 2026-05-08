#!/usr/bin/env bash
#
# Release script for reader
#
# Usage:
#   ./scripts/release.sh 0.2.0
#   ./scripts/release.sh 0.2.0 --dry-run
#
# What it does (in order):
#   1. Validates: clean working tree, on main, tag doesn't exist
#   2. Bumps version in package.json + package-lock.json
#   3. Runs all checks (typecheck, lint, format, test, build)
#   4. If checks fail: reverts version bump, exits
#   5. If checks pass: commits, tags, pushes commit+tag, creates release
#
# Nothing is pushed until all checks pass. Dry run never modifies files.
#

set -euo pipefail

VERSION="${1:-}"
DRY_RUN="${2:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version> [--dry-run]"
  echo "Example: ./scripts/release.sh 0.2.0"
  exit 1
fi

if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: Version must be in X.Y.Z format, got: $VERSION"
  exit 1
fi

TAG="v$VERSION"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Load nvm if available
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use v22 > /dev/null 2>&1 || true

echo "=== reader release $TAG ==="
echo ""

# ─── Preflight ────────────────────────────────────────────────────────

if ! command -v gh &>/dev/null; then
  echo "Error: GitHub CLI (gh) is required. Install: brew install gh"
  exit 1
fi

BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "Error: Must be on main branch (currently on $BRANCH)"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is dirty. Commit or stash changes first."
  git status --short
  exit 1
fi

if git rev-parse "$TAG" &>/dev/null; then
  echo "Error: Tag $TAG already exists"
  exit 1
fi

CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current: $CURRENT_VERSION"
echo "Release: $VERSION"
echo ""

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "[DRY RUN] No files will be modified."
  echo ""
fi

# ─── Step 1: Bump version ────────────────────────────────────────────

echo "[1/5] Bumping version..."
if [ "$DRY_RUN" != "--dry-run" ]; then
  npm version "$VERSION" --no-git-tag-version --allow-same-version > /dev/null
fi
echo "  $CURRENT_VERSION -> $VERSION"

# ─── Step 2: Run all checks ──────────────────────────────────────────

echo "[2/5] Running checks..."

# If any check fails, revert the version bump before exiting
revert_on_failure() {
  if [ "$DRY_RUN" != "--dry-run" ]; then
    git checkout -- package.json package-lock.json 2>/dev/null || true
    echo ""
    echo "  Version bump reverted. Fix the issue and re-run."
  fi
}
trap revert_on_failure ERR

echo "  Typecheck..."
npx tsc --noEmit

echo "  Lint..."
npm run lint > /dev/null 2>&1

echo "  Format..."
npm run format:check > /dev/null 2>&1

echo "  Test..."
TEST_OUTPUT=$(npm test 2>&1)
echo "$TEST_OUTPUT" | grep -E "Test Files|Tests " | sed 's/^/  /'

echo "  Build..."
npm run build > /dev/null 2>&1

trap - ERR
echo "  All checks passed."

# ─── Step 3: Commit + tag ────────────────────────────────────────────

echo "[3/5] Committing..."
if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "  Would commit: chore: release $TAG"
else
  git add package.json package-lock.json
  git commit -m "chore: release $TAG"
  git tag "$TAG"
  echo "  Committed and tagged $TAG"
fi

# ─── Step 4: Push ────────────────────────────────────────────────────

echo "[4/5] Pushing..."
if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "  Would push main + $TAG"
else
  git push origin main --tags --no-verify
  echo "  Pushed main + $TAG"
fi

# ─── Step 5: GitHub release ──────────────────────────────────────────

echo "[5/5] Creating release..."

PREV_TAG=$(git describe --tags --abbrev=0 "$TAG^" 2>/dev/null || echo "")
if [ -n "$PREV_TAG" ]; then
  NOTES=$(git log "$PREV_TAG..$TAG" --pretty=format:"- %s" --no-merges)
else
  NOTES="Initial release"
fi

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "  Would create release $TAG with notes:"
  echo "$NOTES" | sed 's/^/    /'
  echo ""
  echo "[DRY RUN] Nothing was modified."
else
  gh release create "$TAG" --title "$TAG" --notes "$NOTES"
  echo "  https://github.com/vakra-dev/reader/releases/tag/$TAG"
fi

echo ""
echo "=== Done ==="
