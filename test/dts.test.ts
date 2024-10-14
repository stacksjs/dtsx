import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { generateDeclarationsFromFiles } from '../src/generate';
import { join } from 'node:path';

describe('dts-generation', () => {
  beforeAll(() => {
    process.env.APP_ENV = 'test';
  });

  const testDir = join(__dirname, '../fixtures/input/');
  const expectedOutputPath = join(__dirname, '../fixtures/output/examples-1-5.d.ts');

  it('should generate correct type declarations', async () => {
    const output = await generateDeclarationsFromFiles(testDir);

    // Write the output to a file for comparison (optional)
    // await fs.writeFile(expectedOutputPath, output);

    // Expected output (you can adjust this based on your actual expected output)
    const expectedOutput = Bun.file(expectedOutputPath).text()

    // Compare the generated output with the expected output
    expect((output)).toBe(await expectedOutput);
  });

  afterEach(() => {
    // Clean up any files or state if necessary
  });
});
