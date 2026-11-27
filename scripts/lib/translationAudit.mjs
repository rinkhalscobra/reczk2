import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';

export async function loadTranslationModule(file, privateExport) {
  const source = await readFile(file, 'utf8');
  const result = await build({
    stdin: {
      contents: source + (privateExport ? `\nexport { ${privateExport} as messagesForAudit };` : ''),
      resolveDir: path.dirname(path.resolve(file)), sourcefile: path.basename(file),
      loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
  });
  try {
    return await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  } catch (error) {
    throw new Error(`Cannot inspect translations in ${file}: ${error.message}`);
  }
}

export const flattenTranslations = (tree, prefix = '') => Object.fromEntries(
  Object.entries(tree).flatMap(([key, value]) => typeof value === 'string'
    ? [[prefix + key, value]]
    : Object.entries(flattenTranslations(value, prefix + key + '.'))),
);

export async function referencedTranslationKeys(root, catalog) {
  const references = new Map();
  const dynamic = [];
  const namespaces = new Set(Object.keys(catalog.en));
  const add = (key, file) => {
    if (!references.has(key)) references.set(key, new Set());
    references.get(key).add(file.replaceAll('\\', '/'));
  };
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { await scan(file); continue; }
      if (!/\.tsx?$/.test(file)) continue;
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const readArgument = node => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text, file);
        else if (ts.isConditionalExpression(node)) { readArgument(node.whenTrue); readArgument(node.whenFalse); }
        else {
          const prefix = ts.isTemplateExpression(node) ? node.head.text
            : ts.isBinaryExpression(node) && ts.isStringLiteral(node.left) ? node.left.text : undefined;
          dynamic.push({ file: file.replaceAll('\\', '/'), expression: node.getText(source), prefix });
        }
      };
      const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'NOTIFICATION_TEMPLATES' && ts.isArrayLiteralExpression(node.initializer)) {
          for (const item of node.initializer.elements) {
            if (!ts.isObjectLiteralExpression(item)) continue;
            const id = item.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === 'id');
            if (id && ts.isStringLiteral(id.initializer)) {
              for (const field of ['name', 'title', 'message']) add(`notification.templates.${id.initializer.text}.${field}`, file);
            }
          }
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[0]) readArgument(node.arguments[0]);
        if (ts.isStringLiteral(node) && /^[a-zA-Z]+\.[a-zA-Z][a-zA-Z0-9_.]*$/.test(node.text)) {
          const isConfiguredKey = ts.isPropertyAssignment(node.parent) && /Key$/.test(node.parent.name.getText(source));
          if (namespaces.has(node.text.split('.')[0]) || isConfiguredKey) add(node.text, file);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  await scan(root);
  // These domains also cover names produced by the existing dynamic lookups.
  for (const status of ['pending', 'processing', 'approved', 'rejected']) add(`transactions.${status}`, 'dynamic transaction statuses');
  return { references, dynamic };
}

export async function auditTranslations(root = 'src') {
  const { translations } = await loadTranslationModule(path.join(root, 'i18n/translations.ts'));
  const flat = Object.fromEntries(Object.entries(translations).map(([language, tree]) => [language, flattenTranslations(tree)]));
  const { references, dynamic } = await referencedTranslationKeys(root, translations);
  const missing = [];
  const parity = [];
  const placeholderIssues = [];
  const placeholders = text => [...new Set(text.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) || [])].sort();
  for (const [language, messages] of Object.entries(flat)) {
    for (const [key, files] of references) if (!messages[key]?.trim()) missing.push({ language, key, files: [...files] });
    for (const key of new Set([...Object.keys(flat.en), ...Object.keys(messages)])) {
      if (!(key in flat.en) || !messages[key]?.trim()) parity.push({ language, key });
      else if (JSON.stringify(placeholders(flat.en[key])) !== JSON.stringify(placeholders(messages[key]))) placeholderIssues.push({ language, key });
    }
  }
  const unresolvedPrefixes = dynamic.filter(item => item.prefix && !Object.keys(flat.en).some(key => key.startsWith(item.prefix)));
  return { counts: Object.fromEntries(Object.entries(flat).map(([language, messages]) => [language, Object.keys(messages).length])), referencedKeys: references.size, missing, parity, placeholderIssues, unresolvedPrefixes, dynamic };
}
