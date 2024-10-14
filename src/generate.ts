import { join, extname } from 'node:path';
import { readdir } from 'node:fs/promises';
import type { DtsGenerationOption } from './types';

async function getAllTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const res = join(dir, entry.name);
    return entry.isDirectory() ? getAllTypeScriptFiles(res) : res;
  }));
  return Array.prototype.concat(...files).filter(file => extname(file) === '.ts');
}

async function extractTypeDeclarations(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const fileContent = await file.text();
  const sourceFile = ts.createSourceFile(filePath, fileContent, ts.ScriptTarget.Latest, true);
  let typeDeclarations = '';

  function visit(node: ts.Node) {
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      typeDeclarations += node.getFullText(sourceFile) + '\n';
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return typeDeclarations;
}

export async function generateBundledDts(options: DtsGenerationOption = {}): Promise<void> {
  try {
    const cwd = options.cwd || '.';
    const root = options.root || cwd;
    const output = options.outdir || join(cwd, 'types.d.ts');

    const tsFiles = await getAllTypeScriptFiles(root);
    let bundledDeclarations = '';

    for (const file of tsFiles) {
      bundledDeclarations += await extractTypeDeclarations(file);
    }

    await Bun.write(output, bundledDeclarations);
    console.log(`Bundled .d.ts file generated at ${output}`);
  } catch (error) {
    console.error('Error generating bundled .d.ts file:', error);
  }
}

export async function isIsolatedDeclarations(options: DtsGenerationOption = {}): Promise<boolean> {
  try {
    const tsconfigPath = options.tsconfigPath || join(options.cwd || '.', 'tsconfig.json');
    const tsconfigFile = Bun.file(tsconfigPath);

    if (!(await tsconfigFile.exists())) {
      console.error(`Error: ${tsconfigPath} does not exist.`);
      return false;
    }

    const tsconfigContent = await tsconfigFile.text();
    const tsconfig = JSON.parse(tsconfigContent);

    return tsconfig.compilerOptions?.isolatedDeclarations === true;
  } catch (error) {
    console.error('Error reading tsconfig.json:', error);
    return false;
  }
}
