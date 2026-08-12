/**
 * project-atlas · community scaffolding
 *
 * Generates the files a repository needs to run Issues, Discussions and a wiki well — **but only the ones its
 * host actually supports.** Writing an issue template into a repository with Issues disabled, or routing
 * questions to a Discussions tab that does not exist, is worse than writing nothing: it sends contributors to
 * a dead end and looks like neglect.
 *
 * Every file here is **seeded from the repository itself** — its real document counts, its real cluster names,
 * its real open items. A welcome post that says "12 documents across 5 clusters" is worth reading; one that
 * says "we're using Discussions as a place to connect with other members of our community" is the default
 * text everyone scrolls past.
 *
 * Nothing is overwritten without `--force`. A maintainer's edits to their own community files outrank
 * anything generated.
 */

import fs from 'node:fs';
import path from 'node:path';
import { num } from './format.mjs';

export function communityAssets(index, health, plan, host, caps, cfg) {
  const files = new Map();
  const skipped = [];
  const name = index.siteTitle;
  const slug = host.slug;
  const web = host.web || (slug ? `https://github.com/${slug}` : null);

  // A capability the probe could not check is treated as present: generating a file that turns out to be
  // unused is recoverable; withholding one because a network call failed is a silent gap.
  const on = (v) => v !== false;

  /* ---- Discussions -------------------------------------------------- */
  if (host.kind === 'gitlab') {
    skipped.push('Discussions — GitLab has no equivalent feature.');
  } else if (!on(caps.discussions)) {
    skipped.push(`Discussions — disabled on ${slug}. Enable at Settings → General → Features → Discussions, then re-run.`);
  } else {
    files.set('.github/DISCUSSIONS-WELCOME.md', welcomePost(name, index, health, plan, host, caps));
  }

  /* ---- Issues ------------------------------------------------------- */
  if (!on(caps.issues)) {
    skipped.push(`Issue templates — Issues are disabled on ${slug}.`);
  } else {
    files.set('.github/ISSUE_TEMPLATE/bug_report.yml', bugTemplate(name));
    files.set('.github/ISSUE_TEMPLATE/feature_request.yml', featureTemplate(name));
    files.set('.github/ISSUE_TEMPLATE/config.yml', issueConfig(host, caps));
  }

  /* ---- Always applicable -------------------------------------------- */
  files.set('.github/PULL_REQUEST_TEMPLATE.md', prTemplate());

  /* ---- Wiki --------------------------------------------------------- */
  if (host.kind !== 'unknown' && !on(caps.wiki)) {
    skipped.push(`Wiki publishing — the wiki is disabled on ${slug}. \`publish --target wiki\` will refuse until it is enabled.`);
  }
  if (caps.checked && caps.pages === false) {
    skipped.push('Pages — not configured. `publish --target pages` still stages, and pushing the branch is how you enable it.');
  }

  return { files, skipped, web };
}

export function writeCommunity(root, assets, { force = false } = {}) {
  const written = [], kept = [];
  for (const [rel, body] of assets.files) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs) && !force) { kept.push(rel); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
    written.push(rel);
  }
  return { written, kept };
}

/* ------------------------------------------------------------------ the welcome post */

function welcomePost(name, index, health, plan, host, caps) {
  const clusters = index.clusters.map((c) => c.title).join(' · ');
  const blocking = health.blockingCount;
  const roadmapLine = plan && !plan.missing
    ? `The [roadmap](${host.web}/blob/${caps.defaultBranch || 'main'}/${plan.source}) carries **${plan.stats.total} open items** with honest completion figures — ${plan.stats.estimated} of them marked estimated rather than measured. If something you need is on it, say so; that is how it gets prioritised.`
    : '';

  return `# Welcome post for GitHub Discussions

**Not rendered anywhere.** This is the body to paste into
[Discussions → New discussion → Announcements](${host.discussionsUrl}/new?category=announcements).

Title: \`Welcome to ${name} Discussions\`

Regenerate with \`atlas community --write --force\` after the project's shape changes.

---

## Welcome

**${name}** — ${index.stats.documents} documents, ${num(index.stats.lines)} lines, across ${index.stats.clusters} clusters: ${clusters}.

This is the place for anything that is **not** a defect and **not** a concrete proposal. Those belong in
[Issues](${host.issuesUrl}), which have templates that ask for what actually diagnoses a problem.

### Where to put what

| Category | Use it for |
|---|---|
| **Q&A** | "How do I…" — check the reference guides first; most answers are more precise there |
| **Ideas** | A change you want, before it is concrete enough for an issue |
| **Show and tell** | What this produced on *your* repository — genuinely the most useful thing to post |
| **General** | Everything else |
| **Announcements** | Maintainer-only |

### What is most useful to post

- **What the first run found in your repository**, and whether the findings were fair. Defaults are tuned
  against a handful of real corpora and will fit yours imperfectly. The shape of that mismatch is the single
  most valuable report there is.
- **A check that reported clean when it was not.** That is the most serious class of bug here, and it has
  happened before.
- **A configuration that worked** for a kind of project — a monorepo, a library, an ops repo. Directly
  reusable by everyone else.

### Before you post

Skim the [README](${host.web}) and the reference guides. ${roadmapLine}

${blocking === 0
  ? '_This repository currently reports no blocking documentation findings, and the tool is run against itself in CI._'
  : `_This repository currently reports ${blocking} blocking documentation finding(s) against itself — visible in CI, not hidden._`}
`;
}

/* ------------------------------------------------------------------ templates */

function bugTemplate(name) {
  return `name: Bug report
description: Something ${name} did wrong
labels: [bug]
body:
  - type: markdown
    attributes:
      value: |
        **If the tool reported something as clean that was not, say so at the top.**
        That is the most serious class of bug here and it jumps the queue.
  - type: textarea
    id: what
    attributes:
      label: What happened
      description: The command, what you expected, what you got.
    validations: { required: true }
  - type: textarea
    id: shape
    attributes:
      label: Repository shape
      description: Output of \`atlas scan\`. It tells us more than a description will.
      render: text
    validations: { required: true }
  - type: textarea
    id: config
    attributes:
      label: Your config
      description: Redact what you must; the cluster rules and suppressions are the useful part.
      render: json
  - type: input
    id: versions
    attributes:
      label: Node and git versions
      placeholder: "node v20.18.1, git 2.46.0"
    validations: { required: true }
`;
}

function featureTemplate(name) {
  return `name: Feature request
description: Something ${name} should do
labels: [enhancement]
body:
  - type: markdown
    attributes:
      value: |
        Please read the non-negotiables in CONTRIBUTING.md first — several plausible features are
        deliberately out of scope, and the reasons are written down.
  - type: textarea
    id: problem
    attributes:
      label: The problem
      description: What went wrong in a real repository. Not the feature — the problem behind it.
    validations: { required: true }
  - type: textarea
    id: proposal
    attributes:
      label: What you would like it to do
    validations: { required: true }
  - type: textarea
    id: against
    attributes:
      label: The case against
      description: Honestly written. A proposal without one usually has not been thought through yet.
    validations: { required: true }
`;
}

function issueConfig(host, caps) {
  const toDiscussions = host.kind === 'github' && caps.discussions !== false;
  return `blank_issues_enabled: false
${toDiscussions ? `contact_links:
  - name: Question or idea
    url: ${host.discussionsUrl}
    about: Anything that is not a defect or a concrete proposal belongs in Discussions.
` : '# Discussions is unavailable on this repository, so nothing is routed away from Issues.\n'}`;
}

function prTemplate() {
  return `## What this changes

<!-- The finding, in plain language. What was wrong, not what you patched. -->

## Evidence

<!-- For a fix: what failed, and how you reproduced it.
     For a feature: the real problem in a real repository that prompted it. -->

## Checklist

- [ ] Tests pass
- [ ] A bug fix comes with a test that **fails without the fix**
- [ ] No new runtime dependency
- [ ] Comments explain *why*, not *what*

## The case against

<!-- If this is a design change, argue the other side. -->
`;
}
