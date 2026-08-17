#!/usr/bin/env node
/**
 * Stage-0 Linear triage bot for the AIMS project.
 *
 * Polls Linear for NEW issues in the AIMS project, runs a read-only Claude Code
 * diagnosis against the local repo, posts the diagnosis back as a comment, and
 * tags the issue with a "claude-triaged" label so it is never processed twice.
 *
 * Auth:
 *  - LINEAR_API_KEY  : Linear personal API key (Settings → Security & access → API keys)
 *  - Diagnosis runs via the local `claude` CLI → uses this machine's Claude login (Max plan).
 *
 * Env (all optional except LINEAR_API_KEY):
 *  - REPO_DIR      : repo to diagnose against (default: parent of this folder)
 *  - PROJECT_NAME  : Linear project to watch (default "AIMS")
 *  - TEAM_KEY      : Linear team key (default "OSI")
 *  - TRIAGE_LABEL  : label marking processed issues (default "claude-triaged")
 *  - MAX_PER_RUN   : max issues to diagnose per run (default 3)
 *  - GIT_PULL      : "1" to git pull before diagnosing (default 0 — NEVER turn on
 *                    on a machine with uncommitted work; meant for the dedicated PC)
 *  - CLAUDE_BIN    : claude binary (default "claude")
 *  - CLAUDE_MODEL  : model for diagnosis (default: CLI default; try "sonnet" to save quota)
 *  - FORCE_ISSUE   : e.g. "OSI-69" — triage that one issue now, even if old/labeled (testing)
 *  - DRY_RUN       : "1" = print diagnosis, don't post to Linear
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pExecFile = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

const {
  LINEAR_API_KEY,
  REPO_DIR = resolve(HERE, '..'),
  PROJECT_NAME = 'AIMS',
  TEAM_KEY = 'OSI',
  TRIAGE_LABEL = 'claude-triaged',
  MAX_PER_RUN = '3',
  GIT_PULL = '0',
  CLAUDE_BIN = 'claude',
  CLAUDE_MODEL = '',
  FORCE_ISSUE = '',
  DRY_RUN = '0',
} = process.env;

if (!LINEAR_API_KEY) {
  console.error('LINEAR_API_KEY is not set. Create one in Linear: Settings → Security & access → API keys.');
  process.exit(1);
}

const STATE_FILE = join(HERE, '.state.json');
const PROMPT_TEMPLATE = readFileSync(join(HERE, 'DIAGNOSIS_PROMPT.md'), 'utf8');

// ---------- Linear GraphQL helpers ----------

async function linear(query, variables = {}) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: LINEAR_API_KEY },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error('Linear API error: ' + JSON.stringify(json.errors));
  return json.data;
}

async function getTeamAndLabel() {
  const data = await linear(
    `query($key: String!) {
       teams(filter: { key: { eq: $key } }) {
         nodes { id key labels { nodes { id name } } }
       }
     }`,
    { key: TEAM_KEY },
  );
  const team = data.teams.nodes[0];
  if (!team) throw new Error(`Team with key ${TEAM_KEY} not found`);
  let label = team.labels.nodes.find((l) => l.name.toLowerCase() === TRIAGE_LABEL.toLowerCase());
  if (!label) {
    const created = await linear(
      `mutation($input: IssueLabelCreateInput!) {
         issueLabelCreate(input: $input) { issueLabel { id name } }
       }`,
      { input: { teamId: team.id, name: TRIAGE_LABEL, color: '#6b7280' } },
    );
    label = created.issueLabelCreate.issueLabel;
    console.log(`Created label "${TRIAGE_LABEL}"`);
  }
  return { teamId: team.id, labelId: label.id };
}

async function fetchCandidateIssues(sinceISO) {
  // New, open, not-yet-triaged issues in the target project.
  const data = await linear(
    `query($filter: IssueFilter!) {
       issues(filter: $filter, first: 25, orderBy: createdAt) {
         nodes {
           id identifier title description createdAt
           state { name type }
           project { name }
           labels { nodes { id name } }
         }
       }
     }`,
    {
      filter: {
        project: { name: { eq: PROJECT_NAME } },
        createdAt: { gt: sinceISO },
        state: { type: { in: ['backlog', 'unstarted', 'started'] } },
      },
    },
  );
  return data.issues.nodes.filter(
    (i) => !i.labels.nodes.some((l) => l.name.toLowerCase() === TRIAGE_LABEL.toLowerCase()),
  );
}

async function fetchIssueByIdentifier(identifier) {
  const data = await linear(
    `query($id: String!) {
       issue(id: $id) {
         id identifier title description createdAt
         state { name type }
         project { name }
         labels { nodes { id name } }
       }
     }`,
    { id: identifier },
  );
  return data.issue;
}

async function postComment(issueId, body) {
  await linear(
    `mutation($input: CommentCreateInput!) {
       commentCreate(input: $input) { success }
     }`,
    { input: { issueId, body } },
  );
}

async function addLabel(issueId, labelId) {
  await linear(
    `mutation($id: String!, $labelId: String!) {
       issueAddLabel(id: $id, labelId: $labelId) { success }
     }`,
    { id: issueId, labelId },
  );
}

// ---------- Diagnosis via local Claude Code (Max plan) ----------

async function diagnose(issue) {
  const prompt = PROMPT_TEMPLATE
    .replaceAll('{{IDENTIFIER}}', issue.identifier)
    .replaceAll('{{TITLE}}', issue.title)
    .replaceAll('{{DESCRIPTION}}', issue.description || '(no description provided)');

  const args = ['-p', prompt, '--allowedTools', 'Read,Grep,Glob'];
  if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL);

  console.log(`  → running claude diagnosis (repo: ${REPO_DIR}) ...`);
  const { stdout } = await pExecFile(CLAUDE_BIN, args, {
    cwd: REPO_DIR,
    timeout: 15 * 60 * 1000, // 15 min hard cap per issue
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
  });
  return stdout.trim();
}

// ---------- State (watermark so old backlog isn't mass-triaged) ----------

function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  const fresh = { watermark: new Date().toISOString() };
  writeFileSync(STATE_FILE, JSON.stringify(fresh, null, 2));
  console.log(`First run — watermark set to ${fresh.watermark}. Only issues created after this are triaged.`);
  return fresh;
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------- Main ----------

async function main() {
  const state = loadState();
  const { labelId } = await getTeamAndLabel();

  if (GIT_PULL === '1') {
    console.log('git pull --ff-only ...');
    await pExecFile('git', ['pull', '--ff-only'], { cwd: REPO_DIR });
  }

  let issues;
  if (FORCE_ISSUE) {
    const one = await fetchIssueByIdentifier(FORCE_ISSUE);
    if (!one) throw new Error(`Issue ${FORCE_ISSUE} not found`);
    issues = [one];
  } else {
    issues = (await fetchCandidateIssues(state.watermark)).slice(0, Number(MAX_PER_RUN));
  }

  if (issues.length === 0) {
    console.log('No new issues to triage.');
    return;
  }

  for (const issue of issues) {
    console.log(`Triaging ${issue.identifier}: ${issue.title}`);
    let diagnosis;
    try {
      diagnosis = await diagnose(issue);
    } catch (err) {
      console.error(`  ✗ diagnosis failed for ${issue.identifier}: ${err.message}`);
      continue; // no label → retried next run
    }

    const body = `🤖 **Claude Triage** — automated first-pass diagnosis\n\n${diagnosis}\n\n---\n*Read-only analysis against \`${REPO_DIR.split('/').pop()}\` @ local HEAD. A dev must approve before any fix is implemented.*`;

    if (DRY_RUN === '1') {
      console.log('\n===== DRY RUN — would post to', issue.identifier, '=====\n');
      console.log(body);
      console.log('\n===== END DRY RUN =====\n');
    } else {
      await postComment(issue.id, body);
      await addLabel(issue.id, labelId);
      console.log(`  ✓ posted diagnosis + labeled ${issue.identifier}`);
    }
  }

  // Advance watermark to newest processed issue so reruns skip them even if labeling failed.
  if (!FORCE_ISSUE && DRY_RUN !== '1') {
    const newest = issues.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    state.watermark = newest.createdAt;
    saveState(state);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
