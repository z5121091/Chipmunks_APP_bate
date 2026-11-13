import { getSupplierForInventoryBinding, requireActiveInternalLabel, type UnpackRecord } from '../database';
import { syncExcelToComputer } from '../excel';
import { getUnpackSyncFailureMessage, submitUnpackRecordsToComputer, syncUnpackRecordsToComputer } from '../unpackWorkflow';
import { buildInternalLabel, internalLabelPackageKey } from '../internalLabelCode';
import { buildUnpackLabelSheet } from '../labelExport';
import { assertDongweiSixPrintSupported, DongweiPrintCompatibilityError } from '../dongweiPrintCompatibility';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn().mockResolvedValue(null) },
}));
jest.mock('../database', () => ({
  getNextUnpackIndex: jest.fn(),
  getSupplierForInventoryBinding: jest.fn(),
  requireActiveInternalLabel: jest.fn(),
}));
jest.mock('../excel', () => ({
  syncExcelToComputer: jest.fn(),
  formatSyncErrorMessage: (message: string) => message,
}));
jest.mock('../labelExport', () => ({ buildUnpackLabelSheet: jest.fn(() => ({ headers: [], rows: [] })) }));
jest.mock('../dongweiPrintCompatibility', () => ({
  ...jest.requireActual('../dongweiPrintCompatibility'), assertDongweiSixPrintSupported: jest.fn(),
}));

const records = [
  { id: 's1', pair_id: 'pair-1', order_no: 'ORDER-1', model: 'CH334U', version: '', inventory_code: 'INV-1' },
  { id: 'r1', pair_id: 'pair-1', order_no: 'ORDER-1', model: 'CH334U', version: '', inventory_code: 'INV-1' },
] as UnpackRecord[];
const config = { ip: '127.0.0.1', port: '8080' };

describe('unpack native submission response', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(assertDongweiSixPrintSupported).mockResolvedValue(undefined);
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

  it('checks helper capability before sending six-field Dongwei split snapshots', async () => {
    const sixRecords = records.map(record => ({ ...record, qr_field_count: 6 as const,
      package_supplier: '苏州东微半导体股份有限公司' }));
    await expect(submitUnpackRecordsToComputer(sixRecords, config)).resolves.toMatchObject({ status: 'submitted' });
    expect(assertDongweiSixPrintSupported).toHaveBeenCalledWith(config);
    expect(syncExcelToComputer).toHaveBeenCalledTimes(1);
  });

  it('does not send six-field split data to an old helper that would rebuild seven fields', async () => {
    jest.mocked(assertDongweiSixPrintSupported).mockRejectedValue(new Error('请更新电脑端同步助手'));
    const sixRecords = records.map(record => ({ ...record, qr_field_count: 6 as const,
      package_supplier: '苏州东微半导体股份有限公司' }));
    await expect(submitUnpackRecordsToComputer(sixRecords, config)).rejects.toThrow('请更新电脑端同步助手');
    expect(syncExcelToComputer).not.toHaveBeenCalled();
    expect(buildUnpackLabelSheet).not.toHaveBeenCalled();
  });

  it('keeps seven-field Dongwei split tasks compatible without the new capability request', async () => {
    const sevenRecords = records.map(record => ({ ...record, qr_field_count: 7 as const,
      package_supplier: '苏州东微半导体股份有限公司' }));
    await expect(submitUnpackRecordsToComputer(sevenRecords, config)).resolves.toMatchObject({ status: 'submitted' });
    expect(assertDongweiSixPrintSupported).not.toHaveBeenCalled();
  });

  it('shows the actionable old-helper compatibility message to the operator', () => {
    const message = '请更新电脑端同步助手，当前版本不支持东微六段无箱号标签。本次未提交打印。';
    expect(getUnpackSyncFailureMessage(new DongweiPrintCompatibilityError(message, 'UNSUPPORTED_HELPER'))).toBe(message);
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

  it('stops a split retry before the helper if a registered child code is now obsolete', async () => {
    const parentPackageId = 'PARENT00000001';
    const labels = ['CHILDSHIP00001', 'CHILDLEFT00001'].map((packageId, index) => ({
      inventoryCode: 'INV-1', inventoryName: '隔离芯片', specification: 'SOIC16-WB',
      accountKey: 'shanghai-chipmunk' as const, warehouseName: '无锡总仓', warehouseCode: '001',
      packageId, parentPackageId, quantity: index + 1, revision: 1,
    }));
    const internalRecords = records.map((record, index) => ({ ...record,
      package_key: internalLabelPackageKey(labels[index].packageId), parent_package_key: internalLabelPackageKey(parentPackageId),
      source_qr: buildInternalLabel(labels[index]),
    }));
    jest.mocked(requireActiveInternalLabel).mockResolvedValueOnce(labels[0]).mockRejectedValueOnce(new Error('内部标签版本已失效'));
    await expect(submitUnpackRecordsToComputer(internalRecords, config, { retryConfirmed: true })).rejects.toThrow('版本已失效');
    expect(syncExcelToComputer).not.toHaveBeenCalled();

    jest.mocked(requireActiveInternalLabel).mockResolvedValueOnce(labels[0]).mockResolvedValueOnce(labels[1]);
    await expect(submitUnpackRecordsToComputer(internalRecords, config, { retryConfirmed: true })).resolves.toMatchObject({ status: 'submitted' });
    expect(syncExcelToComputer).toHaveBeenCalledTimes(1);
    expect(getSupplierForInventoryBinding).not.toHaveBeenCalled();
  });

  it('rejects a mismatched response ID', async () => {
    jest.mocked(syncExcelToComputer).mockResolvedValue({ success: true, nativePrint: true, nativePrintJobId: 'other-pair' });
    await expect(submitUnpackRecordsToComputer(records, config)).rejects.toThrow('任务标识不一致');
  });

  it('submits only the positive shipped label for a full box split, preserving the saved pair ID', async () => {
    const shipped = { ...records[0], label_type: 'shipped', new_quantity: '2000', package_supplier: '苏州东微半导体股份有限公司' } as UnpackRecord;
    const remaining = { ...records[1], label_type: 'remaining', new_quantity: '0' } as UnpackRecord;
    await submitUnpackRecordsToComputer([shipped, remaining], config);
    expect(buildUnpackLabelSheet).toHaveBeenCalledWith([
      expect.objectContaining({ id: shipped.id, new_quantity: '2000', supplier: shipped.package_supplier }),
    ], '标签数据');
    expect(getSupplierForInventoryBinding).not.toHaveBeenCalled();
    expect(jest.mocked(syncExcelToComputer).mock.calls[0][7]?.queryParams?.print_job_id).toBe('pair-1');
  });

  it('does not require a nonexistent internal child QR for a zero remainder', async () => {
    const label = { inventoryCode: 'INV-1', inventoryName: '隔离芯片', specification: 'SOIC16-WB',
      accountKey: 'shanghai-chipmunk' as const, warehouseName: '无锡总仓', warehouseCode: '001',
      packageId: 'FULLSHIP000001', parentPackageId: 'PARENT00000001', quantity: 2000, revision: 1 };
    const parentKey = internalLabelPackageKey(label.parentPackageId);
    const shipped = { ...records[0], label_type: 'shipped', new_quantity: '2000',
      package_key: internalLabelPackageKey(label.packageId), parent_package_key: parentKey,
      source_qr: buildInternalLabel(label) } as UnpackRecord;
    const remaining = { ...records[1], label_type: 'remaining', new_quantity: '0', parent_package_key: parentKey } as UnpackRecord;
    jest.mocked(requireActiveInternalLabel).mockResolvedValueOnce(label);
    await expect(submitUnpackRecordsToComputer([shipped, remaining], config)).resolves.toMatchObject({ status: 'submitted' });
    expect(requireActiveInternalLabel).toHaveBeenCalledTimes(1);
    expect(requireActiveInternalLabel).toHaveBeenCalledWith(shipped.source_qr);
    expect(buildUnpackLabelSheet).toHaveBeenCalledWith([shipped], '标签数据');
  });

  it('requires a consistent single pair ID and confirmed native outcome', async () => {
    await expect(submitUnpackRecordsToComputer([{ ...records[0], pair_id: undefined }], config)).rejects.toThrow('统一的打印任务标识');
    jest.mocked(syncExcelToComputer).mockResolvedValue({ success: true });
    await expect(submitUnpackRecordsToComputer(records, config)).rejects.toThrow('未确认打印任务结果');
  });
});
