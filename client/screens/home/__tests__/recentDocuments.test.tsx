import TestRenderer, { act } from 'react-test-renderer';
import * as ReactNative from 'react-native';
import { AppPressable } from '@/components/AppPressable';
import HomeScreen from '@/screens/home';
import { getRecentDocumentSummaries, type RecentDocumentSummary } from '@/utils/database';

const mockRouter = { push: jest.fn() };
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => mockRouter }));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: require('@/constants/theme').Colors.light, isDark: false }),
}));
jest.mock('@/hooks/usePendingPurchaseReceivePrefetch', () => ({ usePendingPurchaseReceivePrefetch: jest.fn() }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/UiAssetIcon', () => ({ UiAssetIcon: 'AssetIcon' }));
jest.mock('@/components/WarehouseGuide', () => ({ WarehouseGuide: 'Guide', shouldShowWarehouseGuide: () => false }));
jest.mock('@/components/CustomAlert', () => ({ useCustomAlert: () => ({ AlertComponent: null, showError: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/homeWorkspace', () => ({
  loadHomeWorkspaceSnapshot: jest.fn(async () => ({ activeWork: [], pendingReceipts: [], pendingReceiptUpdatedAt: '' })),
}));
jest.mock('@/utils/database', () => ({
  addWarehouse: jest.fn(),
  initDatabase: jest.fn(async () => undefined),
  getAllWarehouses: jest.fn(async () => [{ id: 'W1', name: '仓库 A' }]),
  hasAnyMaterials: jest.fn(async () => true),
  getRecentDocumentSummaries: jest.fn(),
}));

const recentDocuments: RecentDocumentSummary[] = [
  { type: 'outbound', document_no: 'IO-2026-11-03-01', warehouse_id: 'W1', warehouse_name: '仓库 A', created_at: '2026-11-03T09:03:00' },
  { type: 'inbound', document_no: 'II-2026-11-03-01', warehouse_id: 'W2', warehouse_name: '仓库 B', created_at: '2026-11-03T09:02:00' },
  { type: 'inventory', document_no: 'PD-2026-11-03-01', warehouse_id: 'W3', warehouse_name: '仓库 C', created_at: '2026-11-03T09:01:00' },
];

describe('home recent document navigation', () => {
  let root: TestRenderer.ReactTestRenderer | undefined;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    jest.clearAllMocks();
    jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width: 480, height: 900, scale: 1, fontScale: 1 });
    jest.mocked(getRecentDocumentSummaries).mockResolvedValue(recentDocuments);
  });
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    jest.restoreAllMocks();
  });

  it.each([
    { document: recentDocuments[0], label: '出库', route: '/orders', params: { orderNo: 'IO-2026-11-03-01', warehouseId: 'W1' } },
    { document: recentDocuments[1], label: '入库', route: '/inbound-records', params: { documentNo: 'II-2026-11-03-01', warehouseId: 'W2' } },
    { document: recentDocuments[2], label: '盘点', route: '/inventory-records', params: { documentNo: 'PD-2026-11-03-01', warehouseId: 'W3' } },
  ])('opens the selected $label document with its own identity', async ({ document, label, route, params }) => {
    await act(async () => { root = TestRenderer.create(<HomeScreen />); });
    expect(getRecentDocumentSummaries).toHaveBeenCalledWith(3);
    const target = root!.root.findAllByType(AppPressable).find(node =>
      node.props.accessibilityLabel === `${label}单据 ${document.document_no}`);
    expect(target).toBeDefined();
    await act(async () => { target!.props.onPress(); });
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith(route, params);
  });
});
