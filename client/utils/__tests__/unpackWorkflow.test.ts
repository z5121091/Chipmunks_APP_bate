import { getSupplierForInventoryBinding, type UnpackRecord } from '../database';
import { syncExcelToComputer } from '../excel';
import { submitUnpackRecordsToComputer, syncUnpackRecordsToComputer } from '../unpackWorkflow';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn().mockResolvedValue(null) },
}));
jest.mock('../database', () => ({
  getNextUnpackIndex: jest.fn(),
  getSupplierForInventoryBinding: jest.fn(),
}));
jest.mock('../excel', () => ({
  syncExcelToComputer: jest.fn(),
  formatSyncErrorMessage: (message: string) => message,
}));
jest.mock('../labelExport', () => ({ buildUnpackLabelSheet: jest.fn(() => ({ headers: [], rows: [] })) }));

const records = [
  { id: 's1', pair_id: 'pair-1', order_no: 'ORDER-1', model: 'CH334U', version: '', inventory_code: 'INV-1' },
  { id: 'r1', pair_id: 'pair-1', order_no: 'ORDER-1', model: 'CH334U', version: '', inventory_code: 'INV-1' },
] as UnpackRecord[];
const config = { ip: '127.0.0.1', port: '8080' };

describe('unpack native submission response', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getSupplierForInventoryBinding).mockResolvedValue('南京沁恒微电子股份有限公司');
    jest.mocked(syncExcelToComputer).mockResolvedValue({
      success: true, nativePrint: true, nativePrintJobId: 'pair-1', fileName: 'label.xlsx',
    });
  });

  it('uses the original pair ID as print_job_id and describes submission rather than physical printing', async () => {
    const result = await submitUnpackRecordsToComputer(records, config);
    expect(result.status).toBe('submitted');
    expect(result.message).toBe('已提交同步助手，实际标签请核对');
    expect(syncExcelToComputer).toHaveBeenCalledWith(
      expect.any(Array), '/labels', config, 'ORDER-1', undefined, undefined, undefined,
      expect.objectContaining({ queryParams: { print_mode: 'native_tsc_supplier_v2', print_job_id: 'pair-1' } })
    );
  });

  it('preserves the legacy file name API', async () => {
    await expect(syncUnpackRecordsToComputer(records, config)).resolves.toBe('label.xlsx');
  });

  it('passes review confirmation only when the caller explicitly sets it', async () => {
    await submitUnpackRecordsToComputer(records, config);
    expect(jest.mocked(syncExcelToComputer).mock.calls[0][7]?.queryParams).not.toHaveProperty('retry_confirmed');
    await submitUnpackRecordsToComputer(records, config, { retryConfirmed: true });
    expect(jest.mocked(syncExcelToComputer).mock.calls[1][7]?.queryParams).toMatchObject({
      print_job_id: 'pair-1', retry_confirmed: 'true',
    });
  });

  it('reports a supplier policy skip without treating it as printed', async () => {
    jest.mocked(syncExcelToComputer).mockResolvedValue({
      success: true, nativePrintSkipped: true, nativePrintSkipReason: '供应商不适用',
    });
    expect(await submitUnpackRecordsToComputer(records, config)).toMatchObject({ status: 'skipped', message: '供应商不适用' });
  });

  it('rejects a mismatched response ID', async () => {
    jest.mocked(syncExcelToComputer).mockResolvedValue({ success: true, nativePrint: true, nativePrintJobId: 'other-pair' });
    await expect(submitUnpackRecordsToComputer(records, config)).rejects.toThrow('任务标识不一致');
  });

  it('requires a consistent single pair ID and confirmed native outcome', async () => {
    await expect(submitUnpackRecordsToComputer([{ ...records[0], pair_id: undefined }], config)).rejects.toThrow('统一的打印任务标识');
    jest.mocked(syncExcelToComputer).mockResolvedValue({ success: true });
    await expect(submitUnpackRecordsToComputer(records, config)).rejects.toThrow('未确认打印任务结果');
  });
});
