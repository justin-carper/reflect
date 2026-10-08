#!/bin/sh
# reflect installer.
#
# Symlinks the CLI onto your PATH and copies the harness integration files for
# whichever harnesses are present on this machine. Safe to re-run: files that
# match are left alone, files you have edited are reported and skipped.
#
#   ./install.sh                 install for every detected harness
#   ./install.sh --update        git pull, then re-sync
#   ./install.sh --dry-run       show what would happen, change nothing
#   ./install.sh --uninstall     remove what this script installed
#
# Run with --help for the full list of options.

set -eu

ROOT=$(cd "$(dirname "$0")" && pwd)
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
OC_DIR="$HOME/.config/opencode"
CC_DIR="$HOME/.claude"
PI_DIR="$HOME/.pi/agent"
OMP_DIR="$HOME/.omp/agent"

# Same default the CLI uses, so the manifest sits beside your corpus and state.
STATE_DIR="${REFLECT_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/reflect}"
# What this script last wrote, as "destination<TAB>checksum". Without it an
# update is indistinguishable from a local edit: both leave the installed file
# differing from the repo copy, and the script would skip real updates forever.
MANIFEST="$STATE_DIR/installed.tsv"

DO_UPDATE=0
FORCE=0
DRY_RUN=0
UNINSTALL=0
WITH_NUDGE=0
ONLY_HARNESS=""

n_installed=0
n_updated=0
n_current=0
n_skipped=0
n_removed=0

die() {
  echo "install.sh: $1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
reflect installer

Usage: ./install.sh [options]

Options:
  --update           git pull --ff-only in this clone, then re-sync files
  --force            overwrite integration files you have modified locally
  --harness NAME     limit to one harness: opencode | claude-code | pi | omp
  --with-nudge       also install the optional opencode nudge plugin
  --dry-run          print every action without changing anything
  --uninstall        remove the symlink and any unmodified installed file
  -h, --help         this text

The CLI is symlinked, not copied, so `git pull` in this clone updates it
immediately. Integration files are copied, so re-run this script after a pull
to sync them.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --update) DO_UPDATE=1 ;;
    --force) FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --with-nudge) WITH_NUDGE=1 ;;
    --harness)
      shift
      [ $# -gt 0 ] || die "--harness needs a value: opencode | claude-code | pi | omp"
      ONLY_HARNESS="$1"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown option \"$1\" (try --help)" ;;
  esac
  shift
done

case "$ONLY_HARNESS" in
  "" | opencode | claude-code | pi | omp) ;;
  *) die "unknown harness \"$ONLY_HARNESS\" (expected opencode, claude-code, pi, or omp)" ;;
esac

# ---------------------------------------------------------------- preflight

[ -f "$ROOT/src/cli.mjs" ] ||
  die "$ROOT does not look like a reflect checkout (no src/cli.mjs)"

command -v node >/dev/null 2>&1 ||
  die "node not found. reflect needs Node 18 or newer."

node -e 'process.exit(parseInt(process.versions.node, 10) >= 18 ? 0 : 1)' 2>/dev/null ||
  die "node $(node --version) is too old. reflect needs Node 18 or newer."

# ------------------------------------------------------------------ helpers

# Every file this script manages, as "harness|source|destination".
# Kept in one place so install, uninstall, and the tests agree on the set.
managed_files() {
  echo "opencode|$ROOT/integrations/opencode/commands/reflect.md|$OC_DIR/commands/reflect.md"
  echo "opencode|$ROOT/integrations/opencode/agent/reflector.md|$OC_DIR/agent/reflector.md"
  if [ "$WITH_NUDGE" -eq 1 ] || [ "$UNINSTALL" -eq 1 ]; then
    echo "opencode|$ROOT/integrations/opencode/plugins/reflect-nudge.ts|$OC_DIR/plugins/reflect-nudge.ts"
    echo "opencode|$ROOT/integrations/opencode/plugins/reflect-nudge-tui/tui.ts|$OC_DIR/plugins/reflect-nudge-tui/tui.ts"
  fi
  echo "claude-code|$ROOT/integrations/claude-code/commands/reflect.md|$CC_DIR/commands/reflect.md"
  echo "pi|$ROOT/integrations/pi/prompts/reflect.md|$PI_DIR/prompts/reflect.md"
  echo "omp|$ROOT/integrations/omp/commands/reflect.md|$OMP_DIR/commands/reflect.md"
}

harness_present() {
  case "$1" in
    opencode) [ -d "$OC_DIR" ] ;;
    claude-code) [ -d "$CC_DIR" ] ;;
    pi) [ -d "$PI_DIR" ] ;;
    omp) [ -d "$OMP_DIR" ] ;;
    *) return 1 ;;
  esac
}

harness_wanted() {
  [ -z "$ONLY_HARNESS" ] || [ "$ONLY_HARNESS" = "$1" ]
}

# Print a path with $HOME collapsed to ~, so output is readable and does not
# leak a username into a terminal someone might paste into an issue.
tilde() {
  case "$1" in
    "$HOME"/*) echo "~${1#"$HOME"}" ;;
    *) echo "$1" ;;
  esac
}

# cksum is POSIX and everywhere. This detects edits, not tampering.
sum_of() {
  cksum < "$1" | awk '{ print $1 "-" $2 }'
}

manifest_get() {
  [ -f "$MANIFEST" ] || return 0
  awk -F'\t' -v d="$1" '$1 == d { s = $2 } END { if (s) print s }' "$MANIFEST"
}

manifest_set() {
  [ "$DRY_RUN" -eq 1 ] && return 0
  mkdir -p "$STATE_DIR"
  if [ -f "$MANIFEST" ]; then
    awk -F'\t' -v d="$1" '$1 != d' "$MANIFEST" > "$MANIFEST.tmp"
    mv "$MANIFEST.tmp" "$MANIFEST"
  fi
  printf '%s\t%s\n' "$1" "$2" >> "$MANIFEST"
}

manifest_forget() {
  [ "$DRY_RUN" -eq 1 ] && return 0
  [ -f "$MANIFEST" ] || return 0
  awk -F'\t' -v d="$1" '$1 != d' "$MANIFEST" > "$MANIFEST.tmp"
  mv "$MANIFEST.tmp" "$MANIFEST"
}

# Was this file last written by us, and untouched since?
ours_and_unchanged() {
  oau_recorded=$(manifest_get "$1")
  [ -n "$oau_recorded" ] || return 1
  [ "$oau_recorded" = "$(sum_of "$1")" ]
}

sync_file() {
  sf_src="$1"
  sf_dest="$2"

  [ -f "$sf_src" ] || die "missing source file: $sf_src"

  if [ ! -e "$sf_dest" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "  would install   $(tilde "$sf_dest")"
    else
      mkdir -p "$(dirname "$sf_dest")"
      cp "$sf_src" "$sf_dest"
      manifest_set "$sf_dest" "$(sum_of "$sf_dest")"
      echo "  installed       $(tilde "$sf_dest")"
    fi
    n_installed=$((n_installed + 1))
  elif cmp -s "$sf_src" "$sf_dest"; then
    # Record it even though nothing changed: files installed by hand, or by a
    # version of this script that predates the manifest, become updatable.
    manifest_set "$sf_dest" "$(sum_of "$sf_dest")"
    echo "  up to date      $(tilde "$sf_dest")"
    n_current=$((n_current + 1))
  elif ours_and_unchanged "$sf_dest"; then
    # We wrote it, you never touched it, and the repo has moved on. Update it.
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "  would update    $(tilde "$sf_dest")"
    else
      cp "$sf_src" "$sf_dest"
      manifest_set "$sf_dest" "$(sum_of "$sf_dest")"
      echo "  updated         $(tilde "$sf_dest")"
    fi
    n_updated=$((n_updated + 1))
  elif [ "$FORCE" -eq 1 ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "  would overwrite $(tilde "$sf_dest")"
    else
      cp "$sf_src" "$sf_dest"
      manifest_set "$sf_dest" "$(sum_of "$sf_dest")"
      echo "  overwritten     $(tilde "$sf_dest")"
    fi
    n_installed=$((n_installed + 1))
  else
    echo "  skipped         $(tilde "$sf_dest")  (modified locally)"
    echo "                  diff \"$sf_src\" \"$sf_dest\""
    n_skipped=$((n_skipped + 1))
  fi
}

remove_file() {
  rf_src="$1"
  rf_dest="$2"

  if [ ! -e "$rf_dest" ]; then
    return 0
  fi
  # Remove it if it still matches the repo copy, or if it matches what we last
  # wrote. Anything else is your edit and stays.
  if cmp -s "$rf_src" "$rf_dest" || ours_and_unchanged "$rf_dest"; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "  would remove    $(tilde "$rf_dest")"
    else
      rm -f "$rf_dest"
      manifest_forget "$rf_dest"
      echo "  removed         $(tilde "$rf_dest")"
    fi
    n_removed=$((n_removed + 1))
  else
    echo "  kept            $(tilde "$rf_dest")  (modified locally)"
    n_skipped=$((n_skipped + 1))
  fi
}

# ------------------------------------------------------------------- update

if [ "$DO_UPDATE" -eq 1 ]; then
  command -v git >/dev/null 2>&1 || die "--update needs git"
  git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
    die "--update needs a git clone. $ROOT is not one."

  echo "Updating $(tilde "$ROOT")"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  would run       git pull --ff-only"
  else
    # --ff-only on purpose: an installer must never create a merge commit or
    # leave you in a conflicted tree.
    git -C "$ROOT" pull --ff-only || die "git pull --ff-only failed. Resolve your clone's state, then re-run."
  fi
  echo ""
fi

# ---------------------------------------------------------------- uninstall

if [ "$UNINSTALL" -eq 1 ]; then
  echo "Uninstalling reflect"

  link="$BIN_DIR/reflect"
  if [ -L "$link" ]; then
    if [ "$(readlink "$link")" = "$ROOT/src/cli.mjs" ]; then
      if [ "$DRY_RUN" -eq 1 ]; then
        echo "  would remove    $(tilde "$link")"
      else
        rm -f "$link"
        echo "  removed         $(tilde "$link")"
      fi
      n_removed=$((n_removed + 1))
    else
      echo "  kept            $(tilde "$link")  (points elsewhere)"
      n_skipped=$((n_skipped + 1))
    fi
  fi

  # Heredoc rather than a pipe: a pipeline would run the loop in a subshell and
  # the counters would not survive it.
  while IFS='|' read -r harness src dest; do
    [ -n "${harness:-}" ] || continue
    harness_wanted "$harness" || continue
    remove_file "$src" "$dest"
  done <<EOF
$(managed_files)
EOF

  echo ""
  echo "$n_removed removed, $n_skipped kept"
  echo ""
  echo "Your state directory was left alone. It holds your corpus, reports, and"
  echo "watermark. Remove it yourself if you want it gone:"
  echo "  rm -rf \"\${REFLECT_STATE_DIR:-\$HOME/.local/state/reflect}\""
  exit 0
fi

# ------------------------------------------------------------------ the CLI

echo "Installing reflect from $(tilde "$ROOT")"
echo ""

link="$BIN_DIR/reflect"
target="$ROOT/src/cli.mjs"

if [ -e "$link" ] && [ ! -L "$link" ]; then
  die "$(tilde "$link") exists and is not a symlink. Move it aside, then re-run."
fi

if [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ]; then
  echo "  up to date      $(tilde "$link")"
  n_current=$((n_current + 1))
elif [ "$DRY_RUN" -eq 1 ]; then
  echo "  would link      $(tilde "$link") -> $(tilde "$target")"
  n_installed=$((n_installed + 1))
else
  mkdir -p "$BIN_DIR"
  ln -sfn "$target" "$link"
  [ -x "$target" ] || chmod +x "$target"
  echo "  linked          $(tilde "$link") -> $(tilde "$target")"
  n_installed=$((n_installed + 1))
fi

# ------------------------------------------------------------- integrations

any_harness=0
for h in opencode claude-code pi omp; do
  harness_wanted "$h" || continue
  harness_present "$h" || continue
  any_harness=1
  echo ""
  echo "$h"
  # Heredoc rather than a pipe, so sync_file's counters survive the loop.
  while IFS='|' read -r harness src dest; do
    [ -n "${harness:-}" ] || continue
    [ "$harness" = "$h" ] || continue
    sync_file "$src" "$dest"
  done <<EOF
$(managed_files)
EOF
done

if [ "$any_harness" -eq 0 ]; then
  echo ""
  echo "No supported harness found on this machine."
  echo "Looked for $(tilde "$OC_DIR"), $(tilde "$CC_DIR"), $(tilde "$PI_DIR"), and $(tilde "$OMP_DIR")."
  echo "The CLI still works: reflect doctor"
fi

# ------------------------------------------------- opencode plugin its deps

if [ "$WITH_NUDGE" -eq 1 ] && harness_wanted opencode && harness_present opencode; then
  echo ""
  echo "nudge plugin dependency"
  if (cd "$OC_DIR" && node -e "require.resolve('@opencode-ai/plugin')") >/dev/null 2>&1; then
    echo "  up to date      @opencode-ai/plugin already resolvable"
  elif [ "$DRY_RUN" -eq 1 ]; then
    echo "  would run       npm install @opencode-ai/plugin  (in $(tilde "$OC_DIR"))"
  elif command -v npm >/dev/null 2>&1; then
    echo "  installing      @opencode-ai/plugin in $(tilde "$OC_DIR")"
    echo "                  this writes node_modules and package.json there"
    (cd "$OC_DIR" && npm install --silent @opencode-ai/plugin) ||
      echo "  WARNING         npm install failed. The plugin will log and do nothing until it resolves."
  else
    echo "  WARNING         npm not found. Install @opencode-ai/plugin in $(tilde "$OC_DIR") yourself."
  fi
fi

# ----------------------------------------------------------------- the PATH

echo ""
case ":$PATH:" in
  *":$BIN_DIR:"*)
    echo "$(tilde "$BIN_DIR") is on your PATH."
    ;;
  *)
    echo "$(tilde "$BIN_DIR") is not on your PATH. Add this to your shell profile:"
    echo ""
    echo "  export PATH=\"$(tilde "$BIN_DIR"):\$PATH\""
    echo ""
    echo "Until then, call the CLI directly: $(tilde "$ROOT")/src/cli.mjs doctor"
    ;;
esac

echo ""
if [ "$DRY_RUN" -eq 1 ]; then
  echo "would install $n_installed, update $n_updated; $n_current up to date, $n_skipped skipped"
  echo "nothing was changed"
else
  echo "$n_installed installed, $n_updated updated, $n_current up to date, $n_skipped skipped"
fi
if [ "$n_skipped" -gt 0 ]; then
  echo "Skipped files differ from this checkout and from what this script last wrote,"
  echo "so they look like your edits. Diff them, or re-run with --force."
fi

echo ""
echo "Next: reflect doctor"
if [ "$DO_UPDATE" -eq 0 ]; then
  echo "Later: ./install.sh --update  (pull and re-sync in one step)"
fi
