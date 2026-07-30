# opencode integration

Three files, two of them optional.

The installer does all of it:

```sh
./install.sh --harness opencode --with-nudge
```

Drop `--with-nudge` to skip the plugin. The rest of this page is what the installer does, for anyone who'd rather do it by hand or wants to know what changed.

## 1. The command (required)

```sh
mkdir -p ~/.config/opencode/commands
cp integrations/opencode/commands/reflect.md ~/.config/opencode/commands/
```

Gives you `/reflect`.

## 2. The subagent (recommended)

```sh
mkdir -p ~/.config/opencode/agent
cp integrations/opencode/agent/reflector.md ~/.config/opencode/agent/
```

Runs the analysis in a fresh context with write access scoped to the report directory only. Without it, `/reflect` will analyze in your main session, which costs foreground context and lets the analyzer see your current conversation — both of which reduce the quality of the result.

## 3. The nudge plugin (optional)

```sh
mkdir -p ~/.config/opencode/plugins
cp integrations/opencode/plugins/reflect-nudge.ts ~/.config/opencode/plugins/
```

Shows one toast when 20+ qualifying sessions have accumulated. Requires `@opencode-ai/plugin` in a `package.json` in your opencode config directory:

```sh
cd ~/.config/opencode && npm install @opencode-ai/plugin
```

The plugin needs to find the CLI. Either put `reflect` on your PATH, or set `REFLECT_HOME` to your checkout:

```sh
export REFLECT_HOME="$HOME/projects/reflect"
```

If it finds neither it logs that fact and does nothing. It never throws — a throw in an opencode event hook can kill the session, and a reminder is not worth that risk.

### Why it listens to `session.idle`

`session.created` looks like the obvious trigger and is the wrong one. Resuming a session never fires it, and resuming is the common case — two consecutive opencode restarts produced zero `session.created` events because both resumed. `session.idle` fires in any session actually in use.

Because idle fires often, a `lastCheckAt` watermark bounds how often the counting command runs (30 minutes by default), separately from the 24-hour nudge cooldown.

### Debugging it

Errors are swallowed by design, so every branch writes to `nudge.log` in your state directory:

```sh
tail ~/.local/state/reflect/nudge.log
```

A working sequence looks like:

```
init: loaded (runner: reflect)
event: session.idle — running check
count: raw="66" parsed=66 threshold=20
toast: shown
state: lastNudgeAt written
```

## Environment

| Variable | Default |
|---|---|
| `REFLECT_NUDGE_THRESHOLD` | `20` |
| `REFLECT_NUDGE_COOLDOWN_MS` | `86400000` (24h) |
| `REFLECT_NUDGE_CHECK_INTERVAL_MS` | `1800000` (30m) |
| `REFLECT_HOME` | unset |
| `REFLECT_STATE_DIR` | `~/.local/state/reflect` |
