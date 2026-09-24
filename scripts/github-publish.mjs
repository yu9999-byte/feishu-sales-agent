#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { PublishError, publishSnapshot } from './github-publish-lib.mjs';

function parseArguments(argumentsList) {
  const options = {
    branch: 'main',
    dryRun: false,
    kind: '',
    remote: 'github',
    summary: '',
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (['--branch', '--kind', '--remote', '--summary'].includes(argument)) {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) {
        throw new PublishError(`${argument} requires a value`);
      }
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new PublishError(`Unknown argument: ${argument}`);
  }
  return options;
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await publishSnapshot(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[github-publish] ${message}\n`);
    if (error instanceof PublishError) {
      for (const detail of error.details) {
        process.stderr.write(`[github-publish] ${detail}\n`);
      }
    }
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  await main();
}

export { parseArguments };
