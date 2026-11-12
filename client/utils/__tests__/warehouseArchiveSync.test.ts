import { getAllWarehouses } from '../database';
import { syncExcelToComputer } from '../excel';
import { invalidateSuccessfulHealthCheck, testConnection } from '../heartbeat';
import { syncWarehouseDirectories } from '../syncWarehouseDirectories';

jest.mock('../database', () => ({ getAllWarehouses: jest.fn() }));
jest.mock('../syncConnection', () => ({ reportSyncConnectionResult: jest.fn() }));

const config = { ip: '192.0.2.71', port: '8080', pairingKey: 'example-key' };
const originalFetch = global.fetch;
const fetchMock = jest.fn();
const health = { status: 'ok', serviceId: 'palm-warehouse-sync', pairingAuthenticated: true };
const sheets = [{ name: '明细', headers: ['版本号'], rows: [['V2']] }];
const warehouse = { id: 'erp-account:shanghai-chipmunk', name: '无锡总仓' };

const reply = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
} as Response);

beforeEach(() => {
  invalidateSuccessfulHealthCheck(config);
  fetchMock.mockReset();
  global.fetch = fetchMock;
  jest.mocked(getAllWarehouses).mockResolvedValue([warehouse]);
});

afterEach(() => { global.fetch = originalFetch; });

it.each([true, false])('passes the warehouse only to helpers supporting archives: %s', async supported => {
  fetchMock.mockResolvedValueOnce(reply({ ...health, warehouseArchiveApiVersion: supported ? 1 : undefined }))
    .mockResolvedValueOnce(reply({ success: true, fileName: '盘点.xlsx' }));
  await expect(syncExcelToComputer(sheets, '/inventory', config,
    undefined, undefined, undefined, '盘点.xlsx', { warehouse })).resolves.toMatchObject({ success: true });
  const url = new URL(fetchMock.mock.calls[1][0]);
  expect(url.pathname).toBe('/inventory');
  expect(url.searchParams.get('file_name')).toBe('盘点.xlsx');
  expect(url.searchParams.get('warehouse_name')).toBe(supported ? warehouse.name : null);
  expect(url.searchParams.get('warehouse_id')).toBe(supported ? warehouse.id : null);
});

it('precreates the changed roster and resends it after a helper restart', async () => {
  const loadHealth = (labelReprintSessionId: string) => {
    fetchMock.mockResolvedValueOnce(reply({ ...health, warehouseArchiveApiVersion: 1, labelReprintSessionId }));
    return testConnection(config, { force: true });
  };
  const publish = () => syncWarehouseDirectories(config, () => true);
  await loadHealth('first');
  fetchMock.mockResolvedValue(reply({ success: true }));
  await publish();
  await publish();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toBe('http://192.0.2.71:8080/warehouses');
  expect(fetchMock.mock.calls[1][1].headers['X-Sync-Pairing-Key']).toBe('example-key');
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ warehouses: [warehouse] });

  const renamed = { ...warehouse, name: '新仓库' };
  jest.mocked(getAllWarehouses).mockResolvedValue([renamed]);
  await publish();
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ warehouses: [renamed] });

  await loadHealth('restarted');
  await publish();
  expect(fetchMock).toHaveBeenCalledTimes(5);
  expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({ warehouses: [renamed] });
});
