// Read-only coverage and business-handler comparison against the start-of-round snapshot.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ts = require('../client/node_modules/typescript');
const root = path.resolve(__dirname, '..');
const baselinePath = path.join(root, 'output/motion-before-2026-11-01.json');
const baselineAvailable = fs.existsSync(baselinePath);
const baseline = baselineAvailable ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {};
const paths = new Set(Object.keys(baseline));
for (const dir of ['client/components', 'client/hooks', 'client/constants', 'client/app', 'client/screens']) {
  function walk(folder) {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      if (entry.name === '__tests__') continue;
      const file = `${folder}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(entry.name)) paths.add(file);
    }
  }
  walk(dir);
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const changed = [];
const controls = { nativeTouchImports: [], nativeModalImports: [], retainedModals: 0, disclosures: 0, localTransitions: 0 };
const handlers = [];
function parse(file, source) { return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS); }
function functions(sf) {
  const result = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^(handle|process|drain|enqueue|accept|performSave|requestSave|submit|blockBack)/.test(node.name.text)) {
      const init = node.initializer;
      const fn = init && ts.isCallExpression(init) && init.expression.getText(sf) === 'useCallback' ? init.arguments[0] : init;
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) result.set(node.name.text, fn.getText(sf).replace(/\s+/g, ''));
    }
    ts.forEachChild(node, visit);
  }
  visit(sf); return result;
}
for (const file of paths) {
  if (!fs.existsSync(path.join(root, file))) continue;
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const previous = baseline[file];
  if (source !== previous) changed.push({ path: file, before: previous === undefined ? null : hash(previous), after: hash(source), lines: source.split('\n').length });
  if (!/client\/(app|screens|components)\/.*\.tsx$/.test(file)) continue;
  const sf = parse(file, source);
  function visit(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'react-native') {
      const names = node.importClause?.namedBindings;
      if (names && ts.isNamedImports(names)) for (const item of names.elements) {
        if (item.name.text === 'TouchableOpacity' && file !== 'client/components/AppPressable.tsx') controls.nativeTouchImports.push(file);
        if (item.name.text === 'Modal' && !['client/components/AppModal.tsx', 'client/components/Screen.tsx'].includes(file)) controls.nativeModalImports.push(file);
      }
    }
    if (ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(sf);
      if (tag === 'Modal' && file !== 'client/components/AppModal.tsx') controls.retainedModals++;
      if (tag === 'MotionCollapse') controls.disclosures++;
      if (tag === 'MotionContent') controls.localTransitions++;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (previous !== undefined && /^client\/screens\//.test(file)) {
    const oldFunctions = functions(parse(file, previous)), nextFunctions = functions(sf);
    for (const [name, body] of oldFunctions) if (nextFunctions.has(name)) handlers.push({ file, name, unchanged: body === nextFunctions.get(name) });
  }
}
const result = {
  baselineAvailable,
  auditedBusinessPages: [...paths].filter(file => /^client\/screens\/[^/]+\/index\.tsx$/.test(file)).length,
  changedProductFiles: changed,
  controls,
  screenHandlersCompared: handlers.length,
  screenHandlersChanged: handlers.filter(item => !item.unchanged),
  unchangedScreenHandlers: handlers.filter(item => item.unchanged).length,
};
const target = path.join(root, 'output/motion-implementation-coverage-2026-11-01.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, changedProductFiles: changed.map(item => item.path) }, null, 2));
if (controls.nativeTouchImports.length || controls.nativeModalImports.length) process.exitCode = 1;
