const fs = require('fs');
const path = require('path');

const VERSION_FILE = path.join(process.cwd(), 'version.json');

// Matches "-security", "-bug", "-feature" (case-insensitive) at the end
// of the commit subject line, with optional surrounding whitespace.
const TAG_REGEX = /\s*-(security|bug|feature)\s*$/i;

function loadEventCommits() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH not set');
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  return event.commits || [];
}

function loadVersionFile() {
  if (fs.existsSync(VERSION_FILE)) {
    return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  }
  return {
    major: 1,
    minor: 0,
    patch: 0,
    current: 'v1.0.0',
    history: [],
  };
}

function parseCommit(commit) {
  const lines = commit.message.split('\n');
  const subjectRaw = lines[0].trim();
  const match = subjectRaw.match(TAG_REGEX);

  if (!match) return null; // untagged commit, skip.

  const type = match[1].toLowerCase();
  const subject = subjectRaw.replace(TAG_REGEX, '').trim();
  const description = lines.slice(1).join('\n').trim() || null;

  return {
    type,
    subject,
    description,
    hash: commit.id,
    shortHash: commit.id.substring(0, 7),
    author: commit.author?.name || 'unknown',
    date: commit.timestamp,
    url: commit.url,
  };
}

function bumpVersion(state, type) {
  if (type === 'feature') {
    state.minor += 1;
    state.patch = 0;
  } else {
    // bug or security both land as patch bumps
    state.patch += 1;
  }
  state.current = `v${state.major}.${state.minor}.${state.patch}`;
}

function main() {
  const commits = loadEventCommits();
  const state = loadVersionFile();

  let changed = false;

  for (const commit of commits) {
    const parsed = parseCommit(commit);
    if (!parsed) continue;

    bumpVersion(state, parsed.type);
    changed = true;

    state.history.push({
      version: state.current,
      type: parsed.type,
      security: parsed.type === 'security',
      summary: parsed.subject,
      description: parsed.description,
      hash: parsed.hash,
      shortHash: parsed.shortHash,
      author: parsed.author,
      date: parsed.date,
      url: parsed.url,
    });

    console.log(`${state.current} (${parsed.type}): ${parsed.subject}`);
  }

  if (!changed) {
    console.log('No tagged commits (-security / -bug / -feature) found in this push.');
    return;
  }

  fs.writeFileSync(VERSION_FILE, JSON.stringify(state, null, 2) + '\n');
  console.log(`version.json updated -> ${state.current}`);
}

main();
