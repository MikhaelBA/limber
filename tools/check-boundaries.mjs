import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const errors = [];
function check(directory, allowedPackages, externals = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      check(path, allowedPackages, externals);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      )
        specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier)) {
        const name = specifier.text;
        const target = name.startsWith('.')
          ? relative(root, resolve(dirname(path), name)).replaceAll('\\', '/')
          : name;
        const allowed = name.startsWith('.')
          ? allowedPackages.some((p) => target.startsWith(`packages/${p}/src/`))
          : allowedPackages.some((p) => name === `@limber/${p}` || name.startsWith(`@limber/${p}/`));
        if (!allowed && !externals.includes(name))
          errors.push(`${relative(root, path)}: forbidden dependency ${name}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
check(resolve(root, 'packages/mesh/src'), ['mesh'], ['cdt2d']);
check(resolve(root, 'packages/atlas/src'), ['atlas']);
check(resolve(root, 'packages/core/src'), ['core', 'mesh']);
check(resolve(root, 'packages/runtime/src'), ['core', 'runtime']);
check(
  resolve(root, 'packages/runtime-web/src'),
  ['atlas', 'core', 'runtime', 'runtime-web'],
  ['pixi.js', '@resvg/resvg-wasm'],
);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Architecture boundaries passed: portable packages stay renderer-free; runtime-web has no editor or React dependency.',
  );
