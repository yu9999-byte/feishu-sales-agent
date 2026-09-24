import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_PUBLISH_FILE_BYTES = 25 * 1024 * 1024;
const MAX_SCANNED_FILE_BYTES = 5 * 1024 * 1024;
const MAX_COMMAND_BUFFER_BYTES = 64 * 1024 * 1024;
const PUBLISH_KINDS = new Set(['daily', 'milestone']);
const BLOCKED_DIRECTORIES = new Set([
  '.runtime',
  'coverage',
  'dist',
  'logs',
  'node_modules',
  'temp',
  'tmp',
]);
const BLOCKED_SECRET_FILENAMES = [
  /^(?:credentials?|secrets?)\.(?:json|ya?ml|ini)$/iu,
  /^id_(?:dsa|ecdsa|ed25519|rsa)$/iu,
  /\.(?:key|p12|pem|pfx)$/iu,
];
const KNOWN_SECRET_PATTERNS = [
  {
    name: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gu,
  },
  {
    name: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu,
  },
  {
    name: 'aws-access-key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/gu,
  },
  {
    name: 'google-api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/gu,
  },
  {
    name: 'openai-style-key',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    name: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu,
  },
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu,
  },
  {
    name: 'credential-url',
    pattern: /https?:\/\/[^\s/:]+:[^\s/@]+@/gu,
  },
];
const SECRET_ASSIGNMENT_PATTERN =
  /(?:api[_-]?key|private[_-]?key|secret|token|password|passwd)[A-Za-z0-9_.-]*\s*[:=]\s*(["'])([^"']+)\1/giu;
const BENIGN_SECRET_VALUE_PATTERN =
  /(?:changeme|dummy|example|fake|mock|placeholder|process\.env|redacted|replace|test|your[-_]|\$\{|<[^>]+>)/iu;

class PublishError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'PublishError';
    this.details = details;
  }
}

function commandError(command, args, result) {
  const stderr = result.stderr ? String(result.stderr).trim() : '';
  const stdout = result.stdout ? String(result.stdout).trim() : '';
  const body = stderr || stdout || `exit code ${String(result.status)}`;
  return new PublishError(`${command} ${args.join(' ')} failed`, [body]);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding ?? 'utf8',
    env: options.env ?? process.env,
    input: options.input,
    maxBuffer: MAX_COMMAND_BUFFER_BYTES,
    stdio: options.stdio,
  });

  if (result.error) {
    throw new PublishError(`${command} could not start`, [result.error.message]);
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw commandError(command, args, result);
  }
  return result;
}

function npmInvocation(args) {
  if (process.platform !== 'win32') {
    return { args, command: 'npm' };
  }
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => existsSync(candidate));
  if (!npmCli) {
    throw new PublishError('Could not locate npm-cli.js for the quality gates');
  }
  return {
    args: [npmCli, ...args],
    command: process.execPath,
  };
}

function gitText(repoRoot, args, options = {}) {
  const result = runCommand('git', args, {
    ...options,
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return String(result.stdout ?? '').trim();
}

function gitBuffer(repoRoot, args, options = {}) {
  const result = runCommand('git', args, {
    ...options,
    cwd: repoRoot,
    encoding: null,
  });
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquirePublishLock(gitDirectory) {
  const lockPath = join(gitDirectory, 'github-publish.lock');
  const payload = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, 'wx');
      writeFileSync(descriptor, payload, 'utf8');
      closeSync(descriptor);
      return () => rmSync(lockPath, { force: true });
    } catch (error) {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      let existingPid = 0;
      try {
        const existing = JSON.parse(readFileSync(lockPath, 'utf8'));
        existingPid = Number(existing.pid);
      } catch {
        existingPid = 0;
      }
      if (isProcessAlive(existingPid)) {
        throw new PublishError(
          `Another GitHub publish is running with PID ${String(existingPid)}`,
        );
      }
      rmSync(lockPath, { force: true });
    }
  }

  throw new PublishError('Could not acquire the GitHub publish lock');
}

function normalizeRepositoryPath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function isBlockedPath(filePath) {
  const normalized = normalizeRepositoryPath(filePath);
  const parts = normalized.split('/');
  const fileName = parts.at(-1)?.toLowerCase() ?? '';
  const lowerParts = parts.map((part) => part.toLowerCase());

  if (lowerParts.some((part) => BLOCKED_DIRECTORIES.has(part))) {
    return 'generated-or-runtime-directory';
  }
  if (fileName === '.env') {
    return 'environment-file';
  }
  if (fileName.startsWith('.env.') && fileName !== '.env.example') {
    return 'environment-file';
  }
  if (BLOCKED_SECRET_FILENAMES.some((pattern) => pattern.test(fileName))) {
    return 'credential-file';
  }
  return null;
}

function shannonEntropy(value) {
  const counts = new Map();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function looksLikeCredential(value) {
  if (value.length < 16 || BENIGN_SECRET_VALUE_PATTERN.test(value)) {
    return false;
  }
  const categories = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
    .filter((pattern) => pattern.test(value)).length;
  return categories >= 2 && new Set(value).size >= 8 && shannonEntropy(value) >= 3.4;
}

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function scanSecretText(filePath, text) {
  const findings = [];
  for (const rule of KNOWN_SECRET_PATTERNS) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        path: filePath,
        line: lineNumberAt(text, match.index ?? 0),
        rule: rule.name,
      });
    }
  }

  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(SECRET_ASSIGNMENT_PATTERN)) {
    const value = match[2] ?? '';
    if (looksLikeCredential(value)) {
      findings.push({
        path: filePath,
        line: lineNumberAt(text, match.index ?? 0),
        rule: 'credential-like-assignment',
      });
    }
  }
  return findings;
}

function parseIndexEntries(output) {
  return output
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const tabIndex = entry.indexOf('\t');
      const metadata = entry.slice(0, tabIndex).split(' ');
      return {
        mode: metadata[0],
        objectId: metadata[1],
        stage: metadata[2],
        path: entry.slice(tabIndex + 1),
      };
    })
    .filter((entry) => entry.stage === '0');
}

function findSnapshotViolations(repoRoot, entries) {
  const violations = [];
  const scannedObjects = new Set();

  for (const entry of entries) {
    const blockedReason = isBlockedPath(entry.path);
    if (blockedReason) {
      violations.push(`${entry.path} [${blockedReason}]`);
      continue;
    }

    const size = Number(gitText(repoRoot, ['cat-file', '-s', entry.objectId]));
    if (!Number.isFinite(size)) {
      violations.push(`${entry.path} [unreadable-object]`);
      continue;
    }
    if (size > MAX_PUBLISH_FILE_BYTES) {
      violations.push(`${entry.path} [file-over-25-MiB]`);
      continue;
    }
    if (
      entry.mode === '120000'
      || size > MAX_SCANNED_FILE_BYTES
      || scannedObjects.has(entry.objectId)
    ) {
      continue;
    }

    scannedObjects.add(entry.objectId);
    const contents = gitBuffer(repoRoot, ['cat-file', 'blob', entry.objectId]);
    if (contents.includes(0)) {
      continue;
    }
    const findings = scanSecretText(entry.path, contents.toString('utf8'));
    for (const finding of findings) {
      violations.push(
        `${finding.path}:${String(finding.line)} [${finding.rule}]`,
      );
    }
  }

  return [...new Set(violations)].sort();
}

function normalizeSummary(summary) {
  const normalized = String(summary ?? '').trim().replace(/\s+/gu, ' ');
  if (!normalized) {
    throw new PublishError('A non-empty --summary is required');
  }
  if (/\p{Cc}/u.test(normalized)) {
    throw new PublishError('The checkpoint summary contains control characters');
  }
  if (normalized.length > 72) {
    throw new PublishError('The checkpoint summary must be 72 characters or fewer');
  }
  return normalized;
}

function assertSafeRefName(value, label) {
  if (!/^[A-Za-z0-9._/-]+$/u.test(value) || value.includes('..')) {
    throw new PublishError(`${label} contains unsupported characters`);
  }
}

function assertPublishOptions(options) {
  if (!PUBLISH_KINDS.has(options.kind)) {
    throw new PublishError('--kind must be either milestone or daily');
  }
  assertSafeRefName(options.remote, 'Remote name');
  assertSafeRefName(options.branch, 'Branch name');
  gitText(options.repoRoot, ['check-ref-format', '--branch', options.branch]);
}

function createSnapshot(repoRoot) {
  const temporaryIndex = join(
    tmpdir(),
    `github-publish-${process.pid}-${randomUUID()}.index`,
  );
  const indexEnvironment = {
    ...process.env,
    GIT_INDEX_FILE: temporaryIndex,
  };

  try {
    gitText(repoRoot, ['read-tree', 'HEAD'], { env: indexEnvironment });
    gitText(repoRoot, ['add', '-A', '--', '.'], { env: indexEnvironment });
    const tree = gitText(repoRoot, ['write-tree'], { env: indexEnvironment });
    const entries = parseIndexEntries(
      gitText(repoRoot, ['ls-files', '--stage', '-z'], {
        env: indexEnvironment,
      }),
    );
    return { entries, tree };
  } finally {
    rmSync(temporaryIndex, { force: true });
    rmSync(`${temporaryIndex}.lock`, { force: true });
  }
}

function getChangedPaths(repoRoot, fromTree, toTree) {
  const output = gitText(repoRoot, [
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '-r',
    fromTree,
    toTree,
  ]);
  return output ? output.split(/\r?\n/u) : [];
}

function buildCommitMessage(kind, summary, sourceBranch, sourceHead) {
  const prefix = kind === 'milestone' ? 'checkpoint(milestone)' : 'chore(snapshot)';
  return [
    `${prefix}: ${summary}`,
    '',
    `Source-Branch: ${sourceBranch}`,
    `Source-Head: ${sourceHead}`,
  ].join('\n');
}

function defaultQualityGates(repoRoot, logger) {
  const gates = [
    ['lint'],
    ['test:github-publish'],
    ['test:agent'],
  ];

  for (const [script] of gates) {
    logger(`Running npm run ${script}`);
    const invocation = npmInvocation(['run', script]);
    runCommand(invocation.command, invocation.args, {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  }
}

function verifyRemoteUrl(repoRoot, remote, requireGitHubRemote) {
  const remoteUrl = gitText(repoRoot, ['remote', 'get-url', remote]);
  if (
    requireGitHubRemote
    && !/(?:github\.com|ssh\.github\.com)(?:[/:]|$)/iu.test(remoteUrl)
  ) {
    throw new PublishError(
      `Remote ${remote} is not a GitHub URL`,
      [`Configured URL: ${remoteUrl}`],
    );
  }
  return remoteUrl;
}

function resolveRemoteState(repoRoot, remote, branch) {
  const remoteRef = `refs/remotes/${remote}/${branch}`;
  const remoteCommit = gitText(repoRoot, ['rev-parse', '--verify', remoteRef]);
  const remoteTree = gitText(repoRoot, ['rev-parse', `${remoteCommit}^{tree}`]);
  return { remoteCommit, remoteRef, remoteTree };
}

function formatRemoteHead(output) {
  const firstLine = output.split(/\r?\n/u).find(Boolean) ?? '';
  return firstLine.split(/\s+/u)[0] ?? '';
}

async function publishSnapshot(inputOptions) {
  const options = {
    branch: 'main',
    dryRun: false,
    logger: (message) => process.stdout.write(`[github-publish] ${message}\n`),
    qualityGates: defaultQualityGates,
    remote: 'github',
    repoRoot: process.cwd(),
    requireGitHubRemote: true,
    ...inputOptions,
  };
  options.repoRoot = resolve(options.repoRoot);
  options.summary = normalizeSummary(options.summary);
  assertPublishOptions(options);

  gitText(options.repoRoot, ['rev-parse', '--show-toplevel']);
  if (options.remote === 'origin') {
    throw new PublishError('Publishing to origin is forbidden; use the github remote');
  }
  const remoteUrl = verifyRemoteUrl(
    options.repoRoot,
    options.remote,
    options.requireGitHubRemote,
  );
  const gitDirectory = gitText(options.repoRoot, ['rev-parse', '--absolute-git-dir']);
  const releaseLock = acquirePublishLock(gitDirectory);

  try {
    options.logger(`Fetching ${options.remote}/${options.branch}`);
    gitText(options.repoRoot, [
      'fetch',
      '--prune',
      options.remote,
      `+refs/heads/${options.branch}:refs/remotes/${options.remote}/${options.branch}`,
    ]);
    const remoteState = resolveRemoteState(
      options.repoRoot,
      options.remote,
      options.branch,
    );
    const snapshot = createSnapshot(options.repoRoot);
    const violations = findSnapshotViolations(options.repoRoot, snapshot.entries);
    if (violations.length > 0) {
      throw new PublishError(
        'The snapshot failed the sensitive-content safety gate',
        violations,
      );
    }

    if (snapshot.tree === remoteState.remoteTree) {
      options.logger('No publishable changes were found');
      return {
        branch: options.branch,
        remote: options.remote,
        remoteUrl,
        status: 'no-changes',
        tree: snapshot.tree,
      };
    }

    const changedPaths = getChangedPaths(
      options.repoRoot,
      remoteState.remoteTree,
      snapshot.tree,
    );
    await options.qualityGates(options.repoRoot, options.logger);
    if (options.dryRun) {
      options.logger(
        `Dry run passed for ${String(changedPaths.length)} changed paths`,
      );
      return {
        branch: options.branch,
        changedPaths,
        parent: remoteState.remoteCommit,
        remote: options.remote,
        remoteUrl,
        status: 'dry-run',
        tree: snapshot.tree,
      };
    }

    const sourceBranch = gitText(
      options.repoRoot,
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      { allowFailure: true },
    ) || 'detached';
    const sourceHead = gitText(options.repoRoot, ['rev-parse', 'HEAD']);
    const message = buildCommitMessage(
      options.kind,
      options.summary,
      sourceBranch,
      sourceHead,
    );
    const commit = gitText(
      options.repoRoot,
      ['commit-tree', snapshot.tree, '-p', remoteState.remoteCommit],
      { input: `${message}\n` },
    );

    options.logger(`Pushing ${commit.slice(0, 12)} to ${options.remote}/${options.branch}`);
    gitText(options.repoRoot, [
      'push',
      options.remote,
      `${commit}:refs/heads/${options.branch}`,
    ]);
    const remoteHead = formatRemoteHead(
      gitText(options.repoRoot, [
        'ls-remote',
        options.remote,
        `refs/heads/${options.branch}`,
      ]),
    );
    if (remoteHead !== commit) {
      throw new PublishError('Remote verification returned an unexpected commit', [
        `expected=${commit}`,
        `actual=${remoteHead || '<missing>'}`,
      ]);
    }
    options.logger(`Published ${commit}`);
    return {
      branch: options.branch,
      changedPaths,
      commit,
      parent: remoteState.remoteCommit,
      remote: options.remote,
      remoteUrl,
      status: 'published',
      tree: snapshot.tree,
    };
  } finally {
    releaseLock();
  }
}

export {
  PublishError,
  findSnapshotViolations,
  isBlockedPath,
  normalizeSummary,
  publishSnapshot,
  scanSecretText,
};
