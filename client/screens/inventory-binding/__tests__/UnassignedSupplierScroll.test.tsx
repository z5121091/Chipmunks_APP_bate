import TestRenderer, { act } from 'react-test-renderer';
import { Dimensions, FlatList, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AppModalCard } from '@/components/AppModalCard';
import { AppModalViewport } from '@/components/AppModalViewport';
import { AppModalActions } from '@/components/AppModalActions';
import { UnassignedSupplierBindings } from '../UnassignedSupplierBindings';
import * as database from '@/utils/database';

jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light }) }));
jest.mock('@/components/AppMotion', () => ({ MotionSurface: 'ModalSurface' }));
jest.mock('@/components/AppModalHeader', () => ({ AppModalHeader: 'ModalHeader' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/UiRedesign', () => ({ UiToolbarButton: 'Tool' }));
jest.mock('@/components/AppPressable', () => ({ AppPressable: require('react-native').TouchableOpacity }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@/utils/database', () => ({ getInventoryBindingsPage: jest.fn(), assignInventoryBindingSupplier: jest.fn() }));

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const materials: database.InventoryBinding[] = Array.from({ length: 7 }, (_, index) => ({
  id: `material-${index + 1}`, scan_model: `型号${index + 1}`, inventory_code: `IC.TEST.${index + 1}`,
  versions: ['V1', 'V2'], created_at: '2026-11-14',
}));
const suppliers: database.InventorySupplier[] = Array.from({ length: 18 }, (_, index) => ({
  id: `supplier-${index + 1}`, name: `供应商${index + 1}`, binding_count: 0, created_at: '2026-11-14',
}));
let root: TestRenderer.ReactTestRenderer | undefined;
const assigned = jest.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  jest.mocked(database.getInventoryBindingsPage).mockResolvedValue({ items: materials, total: 7, page: 1, pageSize: 10 });
  jest.mocked(database.assignInventoryBindingSupplier).mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

function assertListOwnsScrolling(list: TestRenderer.ReactTestInstance) {
  expect(list.props).toMatchObject({ scrollEnabled: true, nestedScrollEnabled: true, showsVerticalScrollIndicator: true,
    keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'on-drag' });
  expect(StyleSheet.flatten(list.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
  let ancestor = list.parent;
  while (ancestor) {
    expect(ancestor.type).not.toBe(ScrollView);
    ancestor = ancestor.parent;
  }
  expect(root!.root.findAllByProps({ testID: 'app-modal-card-scroll' })).toHaveLength(0);
  const frame = root!.root.findByProps({ testID: 'app-modal-card-body-frame' });
  expect(StyleSheet.flatten(frame.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
  expect(root!.root.findByType(AppModalCard).props.scrollMode).toBe('body');
}

it.each([
  { width: 320, height: 640, fontScale: 1 },
  { width: 360, height: 480, fontScale: 1.3 },
  { width: 768, height: 1024, fontScale: 1.3 },
])('preserves all seven materials and eighteen supplier choices in a bounded list at $width dp / font $fontScale', async viewport => {
  const size = { ...viewport, scale: 1 };
  Dimensions.set({ window: size, screen: size });
  await act(async () => {
    root = TestRenderer.create(<AppModalViewport style={{ flex: 1, padding: 20 }}>
      <UnassignedSupplierBindings closeRef={{ current: null }} suppliers={suppliers} suppliersLoading={false}
        suppliersFailed={false} onReloadSuppliers={async () => undefined} isActive={() => true}
        onBack={jest.fn()} onAssigned={assigned} />
    </AppModalViewport>);
  });
  const materialList = root!.root.findByType(FlatList);
  assertListOwnsScrolling(materialList);
  expect(materialList.props.data).toHaveLength(7);
  expect(materialList.props.data[6]).toEqual(materials[6]);

  // Invoke the actual renderer for an offscreen row: verifies the final row stays
  // selectable once reached, without pretending TestRenderer performs a native drag.
  const lastMaterial = materialList.props.renderItem({ item: materials[6], index: 6, separators: {} });
  await act(async () => { lastMaterial.props.onPress(); });
  expect(root!.root.findByType(AppModalCard).props.title).toBe('分配供应商');
  const supplierList = root!.root.findByType(FlatList);
  assertListOwnsScrolling(supplierList);
  expect(supplierList.props.data).toHaveLength(18);
  const lastSupplier = supplierList.props.renderItem({ item: suppliers[17], index: 17, separators: {} });
  await act(async () => { lastSupplier.props.onPress(); });
  const footer = root!.root.findByType(AppModalCard).props.footer as React.ReactElement<React.ComponentProps<typeof AppModalActions>>;
  expect(footer.props.primaryDisabled).toBe(false);
  expect(footer.props.primaryLabel).toBe('保存分配');
  await act(async () => { footer.props.onPrimaryPress(); });
  expect(database.assignInventoryBindingSupplier).toHaveBeenCalledWith(materials[6].id, suppliers[17].id);
  expect(assigned).toHaveBeenCalledWith(materials[6].id, suppliers[17].name);
  expect(root!.root.findByType(AppModalCard).props.title).toBe('未绑定供应商的物料');
  const body = root!.root.findAllByType(View).find(node => node.props.testID === 'app-modal-card-body')!;
  expect(StyleSheet.flatten(body.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
});

it.each([0, 1])('shrinks a list of %i unassigned materials and remeasures the supplier picker', async count => {
  Dimensions.set({ window: { width: 360, height: 640, scale: 1, fontScale: 1 }, screen: originalScreen });
  jest.mocked(database.getInventoryBindingsPage).mockResolvedValue({ items: materials.slice(0, count), total: count, page: 1, pageSize: 10 });
  await act(async () => {
    root = TestRenderer.create(<AppModalViewport style={{ flex: 1, padding: 20 }}>
      <UnassignedSupplierBindings closeRef={{ current: null }} suppliers={suppliers.slice(0, 1)} suppliersLoading={false}
        suppliersFailed={false} onReloadSuppliers={async () => undefined} isActive={() => true}
        onBack={jest.fn()} onAssigned={assigned} />
    </AppModalViewport>);
  });
  const list = root!.root.findByType(FlatList);
  await act(async () => {
    root!.root.findByProps({ testID: 'unassigned-search-tools' }).props.onLayout({ nativeEvent: { layout: { height: 44 } } });
    list.props.onContentSizeChange(280, 80);
    root!.root.findByProps({ testID: 'app-modal-card-header' }).props.onLayout({ nativeEvent: { layout: { height: 80 } } });
    root!.root.findByProps({ testID: 'app-modal-card-footer' }).props.onLayout({ nativeEvent: { layout: { height: 64 } } });
  });
  expect(root!.root.findByType(AppModalCard).props.size).toBe('list');
  const surface = () => root!.root.findByType('ModalSurface' as React.ElementType);
  const materialHeight = StyleSheet.flatten(surface().props.style).height;
  expect(materialHeight).toBeLessThan(340);
  assertListOwnsScrolling(list);
  if (count === 0) return;

  await act(async () => { list.props.renderItem({ item: materials[0], index: 0, separators: {} }).props.onPress(); });
  const picker = root!.root.findByType(FlatList);
  await act(async () => {
    root!.root.findAllByType(TextInput).find(input => input.props.accessibilityLabel === '搜索可分配的供应商')!
      .props.onLayout({ nativeEvent: { layout: { height: 44 } } });
    picker.props.onContentSizeChange(280, 130);
  });
  expect(StyleSheet.flatten(surface().props.style).height).toBeLessThan(390);
  assertListOwnsScrolling(picker);
  await act(async () => { picker.props.onContentSizeChange(280, 1800); });
  const expanded = StyleSheet.flatten(surface().props.style);
  expect(expanded.height).toBeGreaterThan(materialHeight);
  expect(expanded.height).toBeLessThanOrEqual(expanded.maxHeight);
});

it('includes the pagination row in the measured content height', async () => {
  jest.mocked(database.getInventoryBindingsPage).mockResolvedValue({ items: materials.slice(0, 1), total: 21, page: 3, pageSize: 10 });
  await act(async () => {
    root = TestRenderer.create(<AppModalViewport style={{ flex: 1, padding: 20 }}>
      <UnassignedSupplierBindings closeRef={{ current: null }} suppliers={suppliers} suppliersLoading={false}
        suppliersFailed={false} onReloadSuppliers={async () => undefined} isActive={() => true}
        onBack={jest.fn()} onAssigned={assigned} />
    </AppModalViewport>);
  });
  await act(async () => {
    root!.root.findByType(FlatList).props.onContentSizeChange(280, 80);
    root!.root.findByProps({ testID: 'unassigned-search-tools' }).props.onLayout({ nativeEvent: { layout: { height: 44 } } });
  });
  const before = root!.root.findByType(AppModalCard).props.bodyContentHeight;
  await act(async () => {
    root!.root.findByProps({ testID: 'unassigned-pagination' }).props.onLayout({ nativeEvent: { layout: { height: 48 } } });
  });
  expect(root!.root.findByType(AppModalCard).props.bodyContentHeight).toBe(before + 48);
});
