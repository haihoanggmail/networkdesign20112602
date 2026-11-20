import { pathToFileURL } from 'node:url';

export type TestFn = (name: string, fn: () => void | Promise<void>) => Promise<void>;

export function createTestRunner() {
  let passed = 0;
  const runTest: TestFn = async (name, fn) => {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  };
  return {
    runTest,
    getPassedCount: () => passed
  };
}

export function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(entry).href === metaUrl;
  } catch {
    return false;
  }
}

export function runStandaloneSuite(
  metaUrl: string,
  suiteFn: (runTest: TestFn) => Promise<void>
): void {
  if (!isMainModule(metaUrl)) return;
  const { runTest, getPassedCount } = createTestRunner();
  suiteFn(runTest)
    .then(() => {
      console.log(`\nALL ${getPassedCount()} TEST SUITES PASSED`);
    })
    .catch(err => {
      console.error('TEST FAILURE:', err);
      process.exit(1);
    });
}
