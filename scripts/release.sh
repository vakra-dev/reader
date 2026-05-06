#!/usr/bin/env bash
#
# Release script for reader
#
# Usage:
#   ./scripts/release.sh 0.2.0
#   ./scripts/release.sh 0.2.0 --dry-run
#
# Idempotent: safe to rerun after a failure. Every step checks current
# state and skips if already done. No manual cleanup needed.
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

echo "=== reader release $TAG ==="
echo ""

if ! command -v gh &>/dev/null; then
  echo "Error: GitHub CLI (gh) is required. Install: brew install gh"
  exit 1
fi

BRANCH=$(git branch --show-current)
echo "Branch: $BRANCH"
echo "Version: $VERSION"
echo ""

# --- Step 1: Bump version ---
echo "[1/7] Checking version..."

CURRENT_VERSION=$(node -p "require('./package.json').version")

if [ "$CURRENT_VERSION" != "$VERSION" ]; then
  npm version "$VERSION" --no-git-tag-version --allow-same-version
  echo "  package.json: $CURRENT_VERSION -> $VERSION"
  NEED_BUMP=true
else
  echo "  package.json: already $VERSION"
  NEED_BUMP=false
fi

# --- Step 2: Typecheck ---
echo ""
echo "[2/7] Typechecking..."
npx tsc --noEmit
echo "  Typecheck passed."

# --- Step 3: Lint ---
echo ""
echo "[3/7] Linting..."
npm run lint
echo "  Lint passed."

# --- Step 4: Test ---
echo ""
echo "[4/7] Running tests..."
npm test
echo "  All tests passed."

# --- Step 5: Build ---
echo ""
echo "[5/7] Building..."
npm run build
echo "  Build succeeded."

# --- Step 6: Commit version bump if needed ---
echo ""
echo "[6/7] Committing..."

if [ "$NEED_BUMP" = true ]; then
  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  [dry-run] Would commit version bump to $VERSION"
  else
    git add package.json package-lock.json
    git commit -m "chore: bump version to $VERSION"
    echo "  Committed version bump."
  fi
else
  echo "  Version already correct, nothing to commit."
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "  Note: working tree has uncommitted changes (not included in release)."
fi

# --- Step 7: Push, tag, release ---
echo ""
echo "[7/7] Tagging and releasing..."

if [ "$BRANCH" = "main" ]; then
  if [ "$DRY_RUN" != "--dry-run" ]; then
    git push origin main 2>/dev/null || true
  fi
else
  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  [dry-run] Would merge $BRANCH -> main"
  else
    git push origin "$BRANCH" 2>/dev/null || true
    git checkout main
    git pull origin main
    git merge "$BRANCH" --no-edit
    git push origin main
    echo "  Merged $BRANCH -> main and pushed."
  fi
fi

if git rev-parse "$TAG" &>/dev/null; then
  echo "  Tag $TAG already exists, skipping."
else
  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  [dry-run] Would create tag $TAG"
  else
    git tag "$TAG"
    git push origin "$TAG"
    echo "  Created and pushed $TAG."
  fi
fi

if gh release view "$TAG" &>/dev/null 2>&1; then
  echo "  Release $TAG already exists, skipping."
else
  PREV_TAG=$(git describe --tags --abbrev=0 "$TAG^" 2>/dev/null || echo "")
  if [ -n "$PREV_TAG" ]; then
    NOTES=$(git log "$PREV_TAG..$TAG" --pretty=format:"- %s" --no-merges)
  else
    NOTES="Initial release"
  fi

  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  [dry-run] Would create release $TAG"
    echo "  Notes:"
    echo "$NOTES" | sed 's/^/    /'
  else
    gh release create "$TAG" --title "$TAG" --notes "$NOTES"
    echo "  Release created."
    echo "  -> publish.yml will build + publish to npm"
  fi
fi

echo ""
echo "=== Done ==="
