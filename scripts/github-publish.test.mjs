import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  PublishError,
  isBlockedPath,
  normalizeSummary,
  publishSnapshot,
  scanSecretText,
} from './github-publish-lib.mjs';

const COMMAND_BUFFER_BYTES = 16 * 1024 * 1024;

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    input: options.input,
    maxBuffer: COMMAND_BUFFER_BYTES,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return String(result.stdout ?? '').trim();
}

function git(cwd, args, options = {}) {
  return run('git', args, cwd, options);
}

function configureIdentity(cwd) {
  git(cwd, ['config', 'user.name', 'Snapshot Test']);
  git(cwd, ['config', 'user.email', 'snapshot@example.com']);
}

function commitAll(cwd, message) {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-m', message]);
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'github-publish-test-'));
  const source = join(root, 'source');
  const bootstrap = join(root, 'bootstrap');
  const remote = join(root, 'remote.git');

  git(root, ['init', '--bare', remote]);
  git(root, ['init', '-b', 'main', bootstrap]);
  configureIdentity(bootstrap);
  writeFileSync(join(bootstrap, 'README.md'), 'published baseline\n', 'utf8');
  commitAll(bootstrap, 'initial published snapshot');
  git(bootstrap, ['remote', 'add', 'github', remote]);
  git(bootstrap, ['push', '-u', 'github', 'main']);

  git(root, ['init', '-b', 'sprint/default', source]);
  configureIdentity(source);
  writeFileSync(
    join(source, '.gitignore'),
    '.env\n.env.*\n!.env.example\nnode_modules/\n',
    'utf8',
  );
  writeFileSync(join(source, 'README.md'), 'source baseline\n', 'utf8');
  writeFileSync(join(source, 'remove-me.txt'), 'remove me\n', 'utf8');
  commitAll(source, 'source baseline');
  git(source, ['remote', 'add', 'github', remote]);

  return {
    bootstrap,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    remote,
    source,
  };
}

function repositoryState(cwd) {
  return {
    branch: git(cwd, ['branch', '--show-current']),
    head: git(cwd, ['rev-parse', 'HEAD']),
    staged: git(cwd, ['diff', '--cached', '--binary']),
    status: git(cwd, ['status', '--porcelain=v1', '-uall']),
  };
}

test('path and content safety rules reject credential material', () => {
  assert.equal(isBlockedPath('.env'), 'environment-file');
  assert.equal(isBlockedPath('config/.env.production'), 'environment-file');
  assert.equal(isBlockedPath('.env.example'), null);
  assert.equal(isBlockedPath('nested/id_ed25519'), 'credential-file');
  assert.equal(isBlockedPath('dist/app.js'), 'generated-or-runtime-directory');

  const findings = scanSecretText(
    'config.ts',
    "const apiKey = 'sk-abcdefghijklmnopqrstuvwxyz012345';\n",
  );
  assert.equal(findings.length, 2);
  assert.deepEqual(
    new Set(findings.map((finding) => finding.rule)),
    new Set(['credential-like-assignment', 'openai-style-key']),
  );
  assert.deepEqual(
    scanSecretText('fixture.ts', "const token = 'test-token-placeholder';\n"),
    [],
  );
});

test('checkpoint summaries are normalized and bounded', () => {
  assert.equal(normalizeSummary('  finish   customer module  '), 'finish customer module');
  assert.throws(() => normalizeSummary(''), PublishError);
  assert.throws(() => normalizeSummary('x'.repeat(73)), PublishError);
});

test('dry run and publish preserve the source branch, index, and worktree', async (context) => {
  const fixture = createFixture();
  context.after(fixture.cleanup);
  const initialRemote = git(fixture.bootstrap, ['rev-parse', 'HEAD']);

  writeFileSync(join(fixture.source, 'README.md'), 'working snapshot\n', 'utf8');
  rmSync(join(fixture.source, 'remove-me.txt'));
  writeFileSync(join(fixture.source, 'partial.txt'), 'staged version\n', 'utf8');
  git(fixture.source, ['add', 'partial.txt']);
  writeFileSync(join(fixture.source, 'partial.txt'), 'working version\n', 'utf8');
  writeFileSync(join(fixture.source, 'new-file.txt'), 'new file\n', 'utf8');
  writeFileSync(join(fixture.source, '.env.local'), 'SECRET=ignored\n', 'utf8');
  const sourceBefore = repositoryState(fixture.source);

  const commonOptions = {
    branch: 'main',
    kind: 'milestone',
    logger: () => {},
    qualityGates: async () => {},
    remote: 'github',
    repoRoot: fixture.source,
    requireGitHubRemote: false,
    summary: 'finish isolated publisher test',
  };
  const dryRun = await publishSnapshot({ ...commonOptions, dryRun: true });
  assert.equal(dryRun.status, 'dry-run');
  assert.equal(git(fixture.remote, ['rev-parse', 'main']), initialRemote);
  assert.deepEqual(repositoryState(fixture.source), sourceBefore);

  const published = await publishSnapshot(commonOptions);
  assert.equal(published.status, 'published');
  assert.equal(published.parent, initialRemote);
  assert.equal(git(fixture.remote, ['rev-parse', 'main']), published.commit);
  assert.equal(
    git(fixture.remote, ['rev-parse', `${published.commit}^`]),
    initialRemote,
  );
  assert.equal(
    git(fixture.remote, ['show', `${published.commit}:partial.txt`]),
    'working version',
  );
  assert.equal(
    git(fixture.remote, ['show', `${published.commit}:new-file.txt`]),
    'new file',
  );
  assert.equal(
    git(fixture.remote, ['cat-file', '-e', `${published.commit}:.env.local`], {
      allowFailure: true,
    }),
    '',
  );
  assert.deepEqual(repositoryState(fixture.source), sourceBefore);

  const noChanges = await publishSnapshot(commonOptions);
  assert.equal(noChanges.status, 'no-changes');
  assert.equal(git(fixture.remote, ['rev-list', '--count', 'main']), '2');
  assert.deepEqual(repositoryState(fixture.source), sourceBefore);
});

test('publisher rejects a tracked environment file without changing the remote', async (context) => {
  const fixture = createFixture();
  context.after(fixture.cleanup);
  writeFileSync(join(fixture.source, '.env'), 'APP_SECRET=real-looking-value-123456\n');
  git(fixture.source, ['add', '-f', '.env']);
  git(fixture.source, ['commit', '-m', 'track environment file for safety test']);
  const sourceBefore = repositoryState(fixture.source);
  const remoteBefore = git(fixture.remote, ['rev-parse', 'main']);

  await assert.rejects(
    publishSnapshot({
      branch: 'main',
      kind: 'milestone',
      logger: () => {},
      qualityGates: async () => {},
      remote: 'github',
      repoRoot: fixture.source,
      requireGitHubRemote: false,
      summary: 'should be blocked',
    }),
    (error) => {
      assert.equal(error instanceof PublishError, true);
      assert.match(error.message, /sensitive-content safety gate/u);
      assert.equal(error.details.some((detail) => detail.includes('.env')), true);
      return true;
    },
  );

  assert.equal(git(fixture.remote, ['rev-parse', 'main']), remoteBefore);
  assert.deepEqual(repositoryState(fixture.source), sourceBefore);
  assert.equal(readFileSync(join(fixture.source, '.env'), 'utf8').includes('APP_SECRET'), true);
});
