# CLAUDE.md — Dedicated Triage PC Setup

This machine runs the **Linear → Claude triage bot** for the AIMS project:
when a new issue is filed in Linear, this PC diagnoses it against the latest
code and posts the diagnosis back on the issue within ~5 minutes.

If you are Claude Code reading this on the triage PC: your job here is
**read-only diagnosis only** — never edit code, never commit/push, never touch
any database from this machine.

---

## 1. What runs here (the flow)

```
BD files issue in Linear (AIMS project)
        │
        ▼   (every 5 min)
run-loop.sh → triage.mjs
   1. git pull --ff-only          (latest elroy/dev)
   2. poll Linear API             (new issues, no "claude-triaged" label)
   3. claude -p <DIAGNOSIS_PROMPT>  ← read-only: Read/Grep/Glob only
   4. post diagnosis as comment on the issue
   5. add label "claude-triaged"  (never processed twice)
```

Costs nothing per-issue: the `claude` CLI is logged in with the dedicated
**Max 20x** account, not an API key.

## 2. One-time setup

### 2.1 Install prerequisites

```bash
# Node 18+ (fetch built-in). Check:
node --version

# git, and access to the repo (SSH key or gh auth login)
git --version

# Claude Code CLI
curl -fsSL https://claude.ai/install.sh | bash     # macOS/Linux
claude --version
```

### 2.2 Log in with the DEDICATED Max account

```bash
claude login
```

- Use the **dedicated** Claude account (Max 20x plan) — NOT a personal login.
- This is interactive (browser). It persists on this machine; you only redo it
  if the session expires (see Troubleshooting).

### 2.3 Clone the repo

```bash
mkdir -p ~/triage && cd ~/triage
git clone git@github.com:<ORG>/aims.git        # or https + gh auth
cd aims
git checkout elroy/dev
```

⚠️ This checkout must stay **clean** — no manual edits, ever. The bot runs
`git pull --ff-only`; any local change breaks the pull and stalls the loop.

### 2.4 Linear API key

Create a key: Linear → **Settings → Security & access → API keys** (personal
settings, https://linear.app/settings/account/security) → New key, name it
`claude-triage-pc`.

> Use a key from an account whose comments the team should see. Consider a
> dedicated "AIMS Bot" Linear seat so triage comments don't post as a person.

Store it for the shell (and for launchd/pm2, see §4):

```bash
echo 'export LINEAR_API_KEY=lin_api_...' >> ~/.zshrc && source ~/.zshrc
```

### 2.5 Configure the bot's environment

The bot lives in `linear-triage/` inside the repo. On THIS machine set:

```bash
export GIT_PULL=1          # pull latest before every run (clean checkout only!)
export CLAUDE_MODEL=sonnet # cheaper on Max quota; drop for default model
export MAX_PER_RUN=3       # burst cap per 5-min tick
export INTERVAL=300        # poll every 5 min
```

## 3. First run — verify before going live

```bash
cd ~/triage/aims/linear-triage

# 1. Dry-run one known issue: prints the diagnosis, posts NOTHING
DRY_RUN=1 FORCE_ISSUE=OSI-69 node triage.mjs

# 2. Happy with the output? Start the watcher:
./run-loop.sh
```

First live run writes `.state.json` with a watermark = now → the old backlog
is ignored; **only issues created after this moment get triaged**.

## 4. Keep it alive across reboots

Simplest (pick one):

**tmux (quick):**
```bash
tmux new -s triage
cd ~/triage/aims/linear-triage && ./run-loop.sh
# detach: Ctrl-B then D    reattach: tmux attach -t triage
```

**pm2 (survives reboot):**
```bash
npm i -g pm2
cd ~/triage/aims/linear-triage
pm2 start ./run-loop.sh --name linear-triage
pm2 save && pm2 startup     # follow the printed instruction once
pm2 logs linear-triage      # tail output
```

macOS sleep will pause the loop — set the machine to never sleep
(System Settings → Energy) or use `caffeinate -s ./run-loop.sh`.

## 5. Safety rails (do not remove)

- Diagnosis runs `claude -p` with `--allowedTools Read,Grep,Glob` — it cannot
  edit files, run arbitrary shell, or touch databases.
- The bot only **comments + labels** in Linear. It never changes issue state,
  assignee, or content.
- `MAX_PER_RUN` caps a BD issue-burst from draining the Max quota in one tick.
- Failed diagnoses are NOT labeled → automatically retried next tick.
- Implementation of fixes is **out of scope on this machine** until the team
  explicitly builds stage-1 (dev-approved, PR-only, likely API-billed in CI).

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `LINEAR_API_KEY is not set` | Export it (§2.4); for pm2, `pm2 restart linear-triage --update-env` after exporting |
| `Linear API error ... AUTHENTICATION_ERROR` | Key revoked/rotated — create a new one |
| `claude: command not found` in pm2 | pm2 doesn't read your shell rc; start pm2 from a shell where `claude` resolves, or set `CLAUDE_BIN=/full/path/to/claude` |
| Diagnosis exits with login/auth error | Max session expired → run `claude login` again on this machine |
| Diagnoses stop mid-week, CLI mentions limits | Max weekly/rate cap hit — loop resumes when the window resets; consider `CLAUDE_MODEL=sonnet` (or haiku) to stretch quota |
| `git pull --ff-only` fails | Someone edited the checkout. `git status` → stash/reset to clean, keep this clone hands-off |
| Same issue triaged twice | The `claude-triaged` label was removed manually — re-add it or let it re-triage |
| Nothing gets triaged | Check `.state.json` watermark — issues must be created AFTER it. For a specific one: `FORCE_ISSUE=OSI-xx node triage.mjs` |

## 7. Files in this folder

| File | Purpose |
|---|---|
| `triage.mjs` | The bot (poll → diagnose → comment → label) |
| `DIAGNOSIS_PROMPT.md` | The triage prompt — tune output format/quality here |
| `run-loop.sh` | Poll loop wrapper |
| `ISSUE_SOP.md` | How BD should write issues so diagnosis lands well |
| `.state.json` | Watermark (created on first run) — delete to reset, but expect old-backlog triage if you also clear labels |

## 8. Later (stage-1, not on this PC)

When the team trusts the diagnoses: move the unattended half to an
**Anthropic API key** in CI (GitHub Action triggered by a Linear webhook —
instant instead of 5-min polls, ToS-clean, no quota stalls), same
`DIAGNOSIS_PROMPT.md`. Add the "implement on dev approval" stage there:
label-gated, branch + PR only, never direct pushes.
