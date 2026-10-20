import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('test TypeScript coverage', (): void => {
  it('includes every test source in the type-checking project', (): void => {
    const root: string = process.cwd();
    const config: ts.ParsedCommandLine | undefined = ts.getParsedCommandLineOfConfigFile(
      resolve(root, 'tsconfig.test.json'),
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (): void => undefined },
    );
    expect(config?.errors).toEqual([]);
    const included: Set<string> = new Set(config?.fileNames.map((path: string): string => resolve(path)));
    const tests: string[] = ts.sys.readDirectory(resolve(root, 'tests'), ['.ts']);
    expect(tests.length).toBeGreaterThan(0);
    const missing: string[] = tests.filter((path: string): boolean => !included.has(resolve(path)));
    expect(missing).toEqual([]);
  });
});
