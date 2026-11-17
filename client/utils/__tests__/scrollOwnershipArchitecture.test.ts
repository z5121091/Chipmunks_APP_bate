import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
type Violation = { rule: 'modal-scroll-owner' | 'screen-scroll-owner'; file: string; line: number; owner: string };
const nativeScrolls = new Set(['ScrollView', 'FlatList', 'SectionList']);
const customScrolls = new Set([
  'KeyboardAwareScrollView', 'KeyboardAwareFlatList', 'KeyboardAwareSectionList',
  'KeyboardAwareFormScrollView', 'KeyboardAwareFormFlatList',
]);

/** Source-level ownership guard, not a substitute for Yoga or physical PDA drag tests. */
function inspectScrollOwnership(source: string, filename = 'fixture.tsx'): Violation[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const aliases = new Map<string, string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) aliases.set(item.name.text, item.propertyName?.text ?? item.name.text);
    }
  }
  const tag = (node: Opening) => {
    const name = node.tagName.getText(file);
    return aliases.get(name) ?? name.split('.').at(-1) ?? name;
  };
  const attribute = (node: Opening, name: string) => node.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(file) === name,
  );
  const staticValue = (node: Opening, name: string): string | boolean | undefined => {
    const prop = attribute(node, name);
    if (!prop) return undefined;
    if (!prop.initializer) return true;
    const value = ts.isJsxExpression(prop.initializer) ? prop.initializer.expression : prop.initializer;
    if (!value) return undefined;
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
    if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
    return undefined;
  };
  const opening = (node: ts.Node): Opening | undefined => ts.isJsxElement(node)
    ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;
  const vertical = (node: Opening) => staticValue(node, 'horizontal') !== true &&
    (nativeScrolls.has(tag(node)) || customScrolls.has(tag(node)));
  const descendants = (owner: ts.Node): Opening[] => {
    const found: Opening[] = [];
    const visit = (node: ts.Node) => {
      const current = opening(node);
      if (current) {
        // Native modal portals have their own viewport and are not page descendants.
        if (tag(current) === 'Modal' || tag(current) === 'AppModal') return;
        if (vertical(current)) found.push(current);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(owner, visit);
    return found;
  };
  const violations: Violation[] = [];
  const visitOwner = (node: ts.Node) => {
    const current = opening(node);
    if (current) {
      const name = tag(current);
      if (name === 'AppModalCard' || name === 'Screen') {
        const scrolls = descendants(node);
        const modalConflict = name === 'AppModalCard' && scrolls.length > 0 && staticValue(current, 'scrollMode') !== 'body';
        const screenConflict = name === 'Screen' && staticValue(current, 'disableAutoScroll') !== true &&
          scrolls.some(item => customScrolls.has(tag(item))) && !scrolls.some(item => nativeScrolls.has(tag(item)));
        if (modalConflict || screenConflict) violations.push({
          rule: modalConflict ? 'modal-scroll-owner' : 'screen-scroll-owner',
          file: filename,
          line: file.getLineAndCharacterOfPosition(current.getStart(file)).line + 1,
          owner: name,
        });
      }
    }
    ts.forEachChild(node, visitOwner);
  };
  visitOwner(file);
  return violations;
}

const clientRoot = path.resolve(__dirname, '../..');
function productFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['__tests__', 'node_modules', 'android', 'ios', '.expo'].includes(entry.name)) return [];
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? productFiles(filename) : /\.tsx?$/.test(entry.name) ? [filename] : [];
  });
}

it('detects the old implicit whole-card scroll around an owned vertical list, including aliases', () => {
  const source = `import { AppModalCard as Card } from '@/components/AppModalCard';
    import { FlatList as Rows } from 'react-native';
    const element = <Card size="largeForm"><View><Rows data={items} /></View></Card>;`;
  expect(inspectScrollOwnership(source)).toEqual([
    expect.objectContaining({ rule: 'modal-scroll-owner', owner: 'AppModalCard' }),
  ]);
});

it('accepts explicit body ownership and ignores horizontal-only or plain card content', () => {
  expect(inspectScrollOwnership(`const element = <>
    <AppModalCard scrollMode={'body'}><KeyboardAwareFormScrollView /></AppModalCard>
    <AppModalCard><ScrollView horizontal><Text>横向内容</Text></ScrollView></AppModalCard>
    <AppModalCard><Text>不滚动的短说明</Text></AppModalCard>
  </>;`)).toEqual([]);
});

it('detects automatic Screen wrapping around a custom vertical form, but accepts an opted-out editor', () => {
  expect(inspectScrollOwnership(`const element = <Screen><View><KeyboardAwareFormScrollView /></View></Screen>;`))
    .toEqual([expect.objectContaining({ rule: 'screen-scroll-owner' })]);
  expect(inspectScrollOwnership(`const element = <Screen disableAutoScroll><KeyboardAwareFormScrollView /></Screen>;`)).toEqual([]);
  expect(inspectScrollOwnership(`const element = <Screen disableAutoScroll={false}><KeyboardAwareFormScrollView /></Screen>;`))
    .toEqual([expect.objectContaining({ rule: 'screen-scroll-owner' })]);
});

it('does not mistake an adjacent portal list for the parent Screen scroll owner', () => {
  const source = `import { AppModal as Modal } from '@/components/AppModal';
    const element = <Screen><KeyboardAwareFormScrollView /><Modal><FlatList /></Modal></Screen>;`;
  expect(inspectScrollOwnership(source)).toEqual([expect.objectContaining({ rule: 'screen-scroll-owner' })]);
});

it('respects modal boundaries while separately validating card owners inside them', () => {
  expect(inspectScrollOwnership(`const element = <Screen>
    <Modal><AppModalCard scrollMode="body"><FlatList /></AppModalCard></Modal>
  </Screen>;`)).toEqual([]);
  expect(inspectScrollOwnership(`const element = <AppModalCard>
    <AppModal><Screen disableAutoScroll><KeyboardAwareFormScrollView /></Screen></AppModal>
  </AppModalCard>;`)).toEqual([]);
  expect(inspectScrollOwnership(`const element = <Screen><Modal>
    <AppModalCard><FlatList /></AppModalCard>
  </Modal></Screen>;`)).toEqual([expect.objectContaining({ rule: 'modal-scroll-owner' })]);
});

it('preserves native sibling lists and excludes horizontal custom forms from the Screen rule', () => {
  expect(inspectScrollOwnership(`const element = <Screen>
    <FlatList /><View><KeyboardAwareFormScrollView /></View>
  </Screen>;`)).toEqual([]);
  expect(inspectScrollOwnership(`const element = <Screen><KeyboardAwareFormScrollView horizontal /></Screen>;`)).toEqual([]);
});

it('keeps scroll ownership explicit across the current app, components and screen call sites', () => {
  const violations = ['app', 'components', 'screens'].flatMap(directory => productFiles(path.join(clientRoot, directory)))
    .flatMap(filename => inspectScrollOwnership(fs.readFileSync(filename, 'utf8'), path.relative(clientRoot, filename).replaceAll('\\', '/')));
  expect(violations).toEqual([]);
});

it('does not reintroduce automatic keyboard avoidance or focused-input scrolling into product code', () => {
  const forbidden = /\b(?:KeyboardAvoidingView|KeyboardAware\w*|enableAutomaticScroll|scrollToFocusedInput)\b|react-native-keyboard-aware-scroll-view|automaticallyAdjustKeyboardInsets\s*=\s*\{?true/;
  const violations = ['app', 'components', 'screens', 'hooks'].flatMap(directory => productFiles(path.join(clientRoot, directory)))
    .filter(filename => forbidden.test(fs.readFileSync(filename, 'utf8')))
    .map(filename => path.relative(clientRoot, filename));
  expect(violations).toEqual([]);
});
