# Linear Triage Bot (stage-0 prototype)

Watches the **AIMS** project in Linear. When a new issue is filed (e.g. by BD),
it runs a **read-only Claude Code diagnosis** against this repo and posts the
result back on the issue as a comment, then labels the issue `claude-triaged`.

- **Diagnosis engine:** the local `claude` CLI → uses this machine's Claude
  login (Max plan). No API tokens billed.
- **Linear access:** a personal API key (stable — no OAuth expiry like the MCP).
- **Safety:** diagnosis is read-only (`Read,Grep,Glob` only). It never edits
  code, never pushes, never touches the DB. Implementation stays manual until
  the team trusts the diagnoses.

## Setup (once)

1. Create a Linear personal API key: **Linear → Settings → Security & access →
   API keys → New key**.
2. `export LINEAR_API_KEY=lin_api_...`

## Test it on one existing issue (safe — prints, doesn't post)

```bash
cd linear-triage
DRY_RUN=1 FORCE_ISSUE=OSI-69 node triage.mjs
```

Read the output. If the diagnosis quality is good, post it for real:

```bash
FORCE_ISSUE=OSI-69 node triage.mjs
```

## Run the watcher

```bash
./run-loop.sh                  # polls every 5 min
INTERVAL=120 ./run-loop.sh     # or every 2 min
```

First run writes `.state.json` with a watermark = "now": **only issues created
after that moment get auto-triaged** (the old backlog is left alone).

## Knobs (env vars)

| Var | Default | Meaning |
|---|---|---|
| `MAX_PER_RUN` | 3 | Cap diagnoses per tick (burst protection for Max quota) |
| `CLAUDE_MODEL` | CLI default | Set `sonnet` to spend less Max quota per diagnosis |
| `GIT_PULL` | 0 | Pull before diagnosing. **Only enable on the dedicated PC** (clean checkout) — never on a machine with uncommitted work |
| `DRY_RUN` | 0 | Print the diagnosis instead of posting to Linear |
| `FORCE_ISSUE` | — | Triage one specific issue (e.g. `OSI-69`) regardless of watermark/label |
| `PROJECT_NAME` / `TEAM_KEY` / `TRIAGE_LABEL` | AIMS / OSI / claude-triaged | Targeting |

## Dedicated-PC deployment (when moving off this machine)

1. Fresh clone of the repo on that PC, checkout `elroy/dev`.
2. Install + log in to Claude Code with the dedicated Max account (`claude login`).
3. `export LINEAR_API_KEY=...; export GIT_PULL=1` and run `./run-loop.sh`
   under `launchd`/`pm2`/`tmux` so it survives reboots.

## Known limits (stage-0, by design)

- Poll-based (up to `INTERVAL` late), not webhook-instant.
- Subscription ToS intends interactive use; this prototype is for **evaluating
  diagnosis quality**. The production version should run on an Anthropic API
  key in CI (GitHub Action), webhook-triggered — same prompt, different auth.
- No auto-implementation. That stage comes later, gated on dev approval, and
  should only ever open PRs.
