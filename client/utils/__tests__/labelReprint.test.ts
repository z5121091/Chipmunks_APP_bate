import AsyncStorage from '@react-native-async-storage/async-storage';
import { detectRule, generateId, getActiveRules, getAllInventoryBindings, getInventorySupplierById, parseWithRule, type InventoryBinding, type QRCodeRule } from '../database';
import {
  prepareLabelReprint,
  applyLabelQuantityCorrection,
  parseLabelCorrectionQuantity,
  IgnoredLabelReprintScan,
  resolveLabelReprintSupplier,
  submitLabelReprint,
  type LabelReprintTask,
} from '../labelReprint';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(), multiSet: jest.fn() },
}));
jest.mock('../database', () => ({
  detectRule: jest.fn(), generateId: jest.fn(), getActiveRules: jest.fn(), getAllInventoryBindings: jest.fn(), parseWithRule: jest.fn(),
  getInventorySupplierById: jest.fn(), getInventoryBindingByCode: jest.fn(),
  getQRCodeRuleValueSpans: (...args: Parameters<typeof import('../database')['getQRCodeRuleValueSpans']>) =>
    jest.requireActual<typeof import('../database')>('../database').getQRCodeRuleValueSpans(...args),
  inspectQRCodeRule: (...args: Parameters<typeof import('../database')['inspectQRCodeRule']>) =>
    jest.requireActual<typeof import('../database')>('../database').inspectQRCodeRule(...args),
  addMaterial: jest.fn(), saveUnpackOperation: jest.fn(), createUnpackPrintTask: jest.fn(),
}));

const supplier = '南京沁恒微电子股份有限公司';
const raw = 'CH334U,31317.TB,---,QSOP28,313174G25,250,20260923,China,W52609160004006-1';
const config = { ip:'127.0.0.1', port:'8080' };
const rule = { id:'rule', name:'示例规则', separator:',', supplierName:'错误供应商', fieldOrder:[], isActive:true } as unknown as QRCodeRule;
const binding = (version: string, company = supplier): InventoryBinding => ({
  id:version || 'generic', scan_model:'CH334U', version, inventory_code:'INV', supplier:company, created_at:'',
});
const response = (payload: unknown, status = 200): Response => ({
  ok:status >= 200 && status < 300, status, json:async () => payload,
}) as Response;
const health = (session = 'session-1', suppliers = [supplier]) => ({
  status:'ok', serviceId:'palm-warehouse-sync', labelReprintApiVersion:1,
  labelReprintSessionId:session, labelReprintSuppliers:suppliers,
});
const success = (task:LabelReprintTask, duplicate = false) => ({
  success:true, state:'submitted', jobId:task.id, copies:2, duplicate,
});
const mockFetch = jest.fn();
const realFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
  global.fetch = mockFetch;
  jest.mocked(generateId).mockReturnValueOnce('new-1').mockReturnValueOnce('new-2').mockReturnValue('new-3');
  jest.mocked(detectRule).mockResolvedValue(rule);
  jest.mocked(getActiveRules).mockResolvedValue([]);
  jest.mocked(getAllInventoryBindings).mockResolvedValue([binding('v1'),binding('v2')]);
  jest.mocked(parseWithRule).mockReturnValue({standardFields:{
    model:'CH334U', version:'31317.TB', package:'QSOP28', batch:'313174G25',
    quantity:'250', productionDate:'20260923', traceNo:'W52609160004006-1',
  },customFields:{}});
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(config));
});

afterAll(() => { global.fetch = realFetch; });

describe('label reprint reads and original content', () => {
  it('checks an explicitly linked rule against the model-only supplier before creating a print task', async () => {
    jest.mocked(detectRule).mockResolvedValueOnce({ ...rule, supplierId: 'linked' });
    jest.mocked(getInventorySupplierById).mockResolvedValueOnce({ id: 'linked', name: '另一厂家', created_at: '' });
    await expect(prepareLabelReprint(raw)).rejects.toMatchObject({ title: '规则与物料供应商不一致' });
    expect(generateId).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('preserves the original QR and existing model-only template selection for a consistent linked rule', async () => {
    jest.mocked(detectRule).mockResolvedValueOnce({ ...rule, supplierId: 'linked' });
    jest.mocked(getInventorySupplierById).mockResolvedValueOnce({ id: 'linked', name: supplier, created_at: '' });
    const task = await prepareLabelReprint(raw);
    expect(task.supplier).toBe(supplier);
    expect(task.sourceQr).toBe(raw);
    expect(task.record).toMatchObject({ quantity: 250, supplier });
  });

  it('matches model across all binding versions and preserves the QR verbatim', async () => {
    const task = await prepareLabelReprint(raw);
    expect(task).toMatchObject({model:'CH334U',version:'31317.TB',quantity:250,supplier,sourceQr:raw,status:'pending'});
    expect(task.record.source_qr).toBe(raw);
    expect(task.record.supplier).not.toBe(rule.supplierName);
    expect(Object.isFrozen(task.record)).toBe(true);
    expect(detectRule).toHaveBeenCalledWith(raw);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('creates a new task for each deliberate scan even when contents are identical', async () => {
    expect((await prepareLabelReprint(raw)).id).not.toBe((await prepareLabelReprint(raw)).id);
  });

  it('never trims or rewrites an original separator or tail', async () => {
    const exact = ` ${raw}; `;
    expect((await prepareLabelReprint(exact)).record.source_qr).toBe(exact);
  });

  it('parses prefixed fields around embedded CRLF while preserving the complete original QR in the submitted JSON', async () => {
    const multilineRaw = [
      'SYNTHETIC MICRO/', 'PART NO.:CH334U/', 'PACKAGE:DFN(0404*0.5)008/',
      'QUANTITY:250/', 'LOT ID:TESTLOT/', 'DATE CODE:2614/', 'MSL3/', 'Track ID:SYNTHETIC-BOX',
    ].join('\r\n');
    const multilineRule: QRCodeRule = {
      ...rule, name: 'Synthetic prefixed layout',
      separator: '/',
      fieldOrder: ['ignore:1', 'model', 'package', 'quantity', 'batch', 'productionDate', 'ignore:2', 'sourceNo'],
      fieldPrefixes: {
        model: 'PART NO.:', package: 'PACKAGE:', quantity: 'QUANTITY:',
        batch: 'LOT ID:', productionDate: 'DATE CODE:', sourceNo: 'Track ID:',
      },
    };
    const { parseWithRule: parseActual } = jest.requireActual<typeof import('../database')>('../database');
    const parsed = parseActual(multilineRaw, multilineRule);
    expect(parsed).toEqual({ standardFields: {
      model: 'CH334U', package: 'DFN(0404*0.5)008', quantity: '250',
      batch: 'TESTLOT', productionDate: '2614', sourceNo: 'SYNTHETIC-BOX',
    }, customFields: {} });
    jest.mocked(detectRule).mockResolvedValueOnce(multilineRule);
    jest.mocked(parseWithRule).mockReturnValueOnce(parsed);

    const task = await prepareLabelReprint(multilineRaw);
    expect(detectRule).toHaveBeenCalledWith(multilineRaw);
    expect(parseWithRule).toHaveBeenCalledWith(multilineRaw, multilineRule);
    expect(task.record).toMatchObject({
      model: 'CH334U', package: 'DFN(0404*0.5)008', quantity: 250,
      batch: 'TESTLOT', production_date: '2614', trace_no: '', source_no: 'SYNTHETIC-BOX',
      source_qr: multilineRaw,
    });
    expect(task.sourceQr).toBe(multilineRaw);
    mockFetch.mockResolvedValueOnce(response(health())).mockResolvedValueOnce(response(success(task)));
    expect((await submitLabelReprint(task, { syncConfig: config })).status).toBe('submitted');
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.record.source_qr).toBe(multilineRaw);
    expect(body.record).toEqual(task.record);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
    expect(jest.requireMock('../database').addMaterial).not.toHaveBeenCalled();
  });

  it.each(['123456789', 'LX32F003F6P6', 'V01H1', 'BT7125032100-2', 'IPCG0195321006', 'LQFP64\r\n'])(
    'ignores an unmatched unstructured barcode %j without generating a task or printing', async barcode => {
    jest.mocked(detectRule).mockResolvedValue(null);
    await expect(prepareLabelReprint(barcode)).rejects.toBeInstanceOf(IgnoredLabelReprintScan);
    expect(parseWithRule).not.toHaveBeenCalled();
    expect(getAllInventoryBindings).not.toHaveBeenCalled();
    expect(generateId).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(jest.requireMock('../database').addMaterial).not.toHaveBeenCalled();
  });

  it.each([
    'DFN(0506*0.75-1.27)008(E)', 'QFN4*4', 'DFN/xxx', 'BGA(6*6)',
    'SOP8/208mil', 'TO-252-3', 'QFN(4*4*0.75)', ' QFN4*4\r\n',
  ])('ignores the single package field %j even when it contains QR-like punctuation', async barcode => {
    jest.mocked(detectRule).mockResolvedValue(null);
    await expect(prepareLabelReprint(barcode)).rejects.toBeInstanceOf(IgnoredLabelReprintScan);
    expect(parseWithRule).not.toHaveBeenCalled();
    expect(getAllInventoryBindings).not.toHaveBeenCalled();
    expect(generateId).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it.each(['UNKNOWN/100/LOT', 'UNKNOWN,100,LOT', '{UNKNOWN}{100}', 'UNKNOWN;100;LOT'])(
    'reports a structured QR with no matching rule %j instead of silently ignoring it', async barcode => {
    jest.mocked(detectRule).mockResolvedValue(null);
    await expect(prepareLabelReprint(barcode)).rejects.toThrow('未匹配到二维码解析规则');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps unknown custom-delimiter structures visible for rule repair', async () => {
    jest.mocked(detectRule).mockResolvedValue(null);
    jest.mocked(getActiveRules).mockResolvedValue([{ ...rule, separator: '~' }]);
    await expect(prepareLabelReprint('UNKNOWN~100~LOT')).rejects.toThrow('未匹配到二维码解析规则');
  });

  it.each([
    'DFN/100/LOT', 'QFN4*4*100', 'DFN,100,LOT', 'SOP8;100;LOT',
    'DFN/100|LOT', 'QFN4*LOT', 'DFN(4*4', 'DFN\n100\nLOT',
  ])('does not swallow unknown or damaged structured QR %j as a package field', async barcode => {
    jest.mocked(detectRule).mockResolvedValue(null);
    await expect(prepareLabelReprint(barcode)).rejects.toThrow('未匹配到二维码解析规则');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not ignore a package-looking scan that actually matches a rule', async () => {
    expect((await prepareLabelReprint('QFN4*4')).supplier).toBe(supplier);
    expect(parseWithRule).toHaveBeenCalledWith('QFN4*4', rule);
  });

  it('does not suppress any input that already matches a configured rule', async () => {
    expect((await prepareLabelReprint('CH334U~250~LOT')).supplier).toBe(supplier);
    expect(getActiveRules).not.toHaveBeenCalled();
    expect(parseWithRule).toHaveBeenCalledWith('CH334U~250~LOT', rule);
  });

  it('propagates configured rule ambiguity rather than selecting the first', async () => {
    jest.mocked(detectRule).mockRejectedValue(new Error('二维码同时匹配多个解析规则'));
    await expect(prepareLabelReprint(raw)).rejects.toThrow('同时匹配多个解析规则');
    expect(getAllInventoryBindings).not.toHaveBeenCalled();
  });

  it.each(['0','-1','not-number','1.5'])('rejects invalid label quantity %s', async quantity => {
    jest.mocked(parseWithRule).mockReturnValue({standardFields:{model:'CH334U',quantity},customFields:{}});
    await expect(prepareLabelReprint(raw)).rejects.toThrow('未读到有效的型号或数量');
  });

  it('blocks missing and conflicting suppliers without considering the scanned version', () => {
    expect(() => resolveLabelReprintSupplier('CH334U',[])).toThrow('没有对应供应商');
    expect(() => resolveLabelReprintSupplier('CH334U',[binding('31317.TB'),binding('another','另一个供应商')]))
      .toThrow('对应多个供应商');
    expect(resolveLabelReprintSupplier(' ch334u ',[binding('v1'),binding('v2'),binding('v3','')])).toBe(supplier);
  });
});

describe('quantity correction before memory-only submission', () => {
  const quantityRule: QRCodeRule = {
    ...rule,
    fieldOrder: ['model', 'version', 'ignore:1', 'package', 'batch', 'quantity', 'productionDate', 'ignore:2', 'traceNo'],
  };
  beforeEach(() => {
    jest.mocked(detectRule).mockResolvedValue(quantityRule);
    jest.mocked(parseWithRule).mockImplementation(jest.requireActual<typeof import('../database')>('../database').parseWithRule);
  });

  it.each(['0', '-1', '1.2', '1.2.3.4', '1e3', '+1', '', '1 pcs', '9007199254740992'])(
    'rejects invalid corrected input %j', input => {
      expect(() => parseLabelCorrectionQuantity(input)).toThrow();
    }
  );
  it.each(['1', '2', '3', '4', '56', '10', '123', ' 1000 '])('accepts positive integer input %j', input => {
    expect(parseLabelCorrectionQuantity(input)).toBe(Number(input));
  });

  it.each([1, 5000])('changes quantity to %i and increments trace while preserving the scanned label', async quantity => {
    const original = await prepareLabelReprint(raw);
    const edited = await applyLabelQuantityCorrection(original, quantity);
    const expectedQr = raw.replace(',250,', `,${quantity},`).replace(/-1$/, '-2');
    expect(edited).toMatchObject({ id: original.id, quantity, traceNo: 'W52609160004006-2', sourceQr: expectedQr });
    expect(edited.record).toEqual({ ...original.record, quantity, trace_no: 'W52609160004006-2', source_qr: expectedQr });
    expect(edited.quantityCorrection).toEqual({ originalQuantity: 250, originalTraceNo: original.traceNo });
    expect(Object.isFrozen(edited.record)).toBe(true);
    expect(original.quantity).toBe(250);
    expect(original.sourceQr).toBe(raw);
    expect(original.traceNo).toBe('W52609160004006-1');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps the original payload and trace when quantity is unchanged', async () => {
    const original = await prepareLabelReprint(raw);
    expect(await applyLabelQuantityCorrection(original, 250)).toBe(original);
  });

  it('does not turn a box number into a trace number when there is no trace field', async () => {
    const noTraceRule = { ...quantityRule, fieldOrder: quantityRule.fieldOrder.map(field => field === 'traceNo' ? 'sourceNo' : field) };
    jest.mocked(detectRule).mockResolvedValue(noTraceRule);
    const original = await prepareLabelReprint(raw);
    const edited = await applyLabelQuantityCorrection(original, 123);
    expect(edited.traceNo).toBe('');
    expect(edited.boxNo).toBe('W52609160004006-1');
    expect(edited.sourceQr).toBe(raw.replace(',250,', ',123,'));
  });

  it('blocks rules that no longer recognize the corrected QR', async () => {
    const original = await prepareLabelReprint(raw);
    jest.mocked(detectRule).mockResolvedValue({ ...quantityRule, id: 'different-rule' });
    await expect(applyLabelQuantityCorrection(original, 123)).rejects.toThrow('无法匹配原解析规则');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks changed field mappings even if the rule ID remains the same', async () => {
    const original = await prepareLabelReprint(raw);
    jest.mocked(detectRule).mockResolvedValue({ ...quantityRule,
      fieldOrder: quantityRule.fieldOrder.map(field => field === 'model' ? 'batch' : field === 'batch' ? 'model' : field),
    });
    await expect(applyLabelQuantityCorrection(original, 123)).rejects.toThrow('字段核对不一致');
  });

  it('does not edit submitted, attempted or already corrected tasks a second time', async () => {
    const original = await prepareLabelReprint(raw);
    const edited = await applyLabelQuantityCorrection(original, 123);
    for (const processed of [edited, { ...original, status: 'submitted' as const }, { ...original, attemptCount: 1 }]) {
      await expect(applyLabelQuantityCorrection(processed, 80)).rejects.toThrow('已处理过');
    }
  });

  it('retries the exact corrected task without increasing trace again or writing business records', async () => {
    const original = await prepareLabelReprint(raw);
    const edited = await applyLabelQuantityCorrection(original, 123);
    mockFetch.mockResolvedValueOnce(response(health())).mockRejectedValueOnce(new Error('Network request failed'));
    const failed = await submitLabelReprint(edited, { syncConfig: config });
    mockFetch.mockResolvedValueOnce(response(health())).mockResolvedValueOnce(response(success(edited, true)));
    const completed = await submitLabelReprint(failed, { syncConfig: config, retryConfirmed: true });
    expect(completed.status).toBe('submitted');
    const bodies = mockFetch.mock.calls.filter(call => call[0].endsWith('/label-reprint')).map(call => JSON.parse(call[1].body));
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.print_job_id).toBe(original.id);
      expect(body.record).toEqual(edited.record);
      expect(body.record.trace_no).toBe('W52609160004006-2');
      expect(body).not.toHaveProperty('quantityEditContext');
      expect(body).not.toHaveProperty('quantityCorrection');
    }
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    const database = jest.requireMock('../database');
    expect(database.addMaterial).not.toHaveBeenCalled();
    expect(database.saveUnpackOperation).not.toHaveBeenCalled();
    expect(database.createUnpackPrintTask).not.toHaveBeenCalled();
  });
});

describe('memory-only reprint transport', () => {
  it('uses only JSON /label-reprint and leaves all storage writers untouched', async () => {
    const task = await prepareLabelReprint(raw);
    mockFetch.mockResolvedValueOnce(response(health())).mockResolvedValueOnce(response(success(task)));
    const result = await submitLabelReprint(task);
    expect(result.status).toBe('submitted');
    expect(mockFetch.mock.calls.map(call => call[0])).toEqual([
      'http://127.0.0.1:8080/health','http://127.0.0.1:8080/label-reprint',
    ]);
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
      print_job_id:task.id,reprint_session_id:'session-1',record:task.record,retry_confirmed:false,
    });
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
    const database = jest.requireMock('../database');
    expect(database.addMaterial).not.toHaveBeenCalled();
    expect(database.saveUnpackOperation).not.toHaveBeenCalled();
    expect(database.createUnpackPrintTask).not.toHaveBeenCalled();
  });

  it('blocks an old helper instead of falling back to the persistent Excel API', async () => {
    const task = await prepareLabelReprint(raw);
    mockFetch.mockResolvedValue(response({status:'ok',serviceId:'palm-warehouse-sync'}));
    expect(await submitLabelReprint(task,{syncConfig:config})).toMatchObject({status:'failed',errorCode:'UNSUPPORTED_HELPER'});
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('blocks missing templates before any POST', async () => {
    const task = await prepareLabelReprint(raw);
    mockFetch.mockResolvedValue(response(health('session-1',[])));
    expect(await submitLabelReprint(task,{syncConfig:config})).toMatchObject({status:'failed',errorCode:'NO_TEMPLATE',retryAllowed:false,resultUnknown:false});
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('uses the pairing key for both health and print while preserving the original QR', async () => {
    const task = await prepareLabelReprint(raw);
    mockFetch.mockResolvedValueOnce(response({ ...health(), pairingRequired: true, pairingAuthenticated: true }))
      .mockResolvedValueOnce(response(success(task)));
    expect((await submitLabelReprint(task, { syncConfig: { ...config, pairingKey: 'warehouse-test-key' } })).status)
      .toBe('submitted');
    expect(mockFetch.mock.calls[0][1].headers['X-Sync-Pairing-Key']).toBe('warehouse-test-key');
    expect(mockFetch.mock.calls[1][1].headers['X-Sync-Pairing-Key']).toBe('warehouse-test-key');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).record.source_qr).toBe(raw);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('loads the saved pairing key for both requests when the page does not pass explicit connection options', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ ...config, pairingKey: ' saved-test-key ' }));
    const task = await prepareLabelReprint(raw);
    mockFetch.mockImplementation(async (url, init) => {
      const authenticated = init.headers?.['X-Sync-Pairing-Key'] === 'saved-test-key';
      if (url.endsWith('/health')) {
        return response({ ...health(), pairingRequired: true, pairingAuthenticated: authenticated });
      }
      return authenticated ? response(success(task)) : response({ success: false, code: 'SYNC_PAIRING_REQUIRED' }, 401);
    });
    expect(await submitLabelReprint(task)).toMatchObject({ status: 'submitted' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    for (const call of mockFetch.mock.calls) {
      expect(call[1].headers['X-Sync-Pairing-Key']).toBe('saved-test-key');
    }
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).record.source_qr).toBe(raw);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('re-reads a corrected saved pairing key on retry and retains the same print payload', async () => {
    const task = await prepareLabelReprint(raw);
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ ...config, pairingKey: 'old-test-key' }));
    mockFetch.mockResolvedValueOnce(response({ ...health(), pairingRequired: true, pairingAuthenticated: false }));
    const failed = await submitLabelReprint(task);
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'SYNC_PAIRING_REQUIRED', resultUnknown: false });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ ...config, pairingKey: 'new-test-key' }));
    mockFetch.mockImplementation(async (url, init) => {
      const authenticated = init.headers?.['X-Sync-Pairing-Key'] === 'new-test-key';
      return url.endsWith('/health')
        ? response({ ...health(), pairingRequired: true, pairingAuthenticated: authenticated })
        : response(success(task));
    });
    expect(await submitLabelReprint(failed, { retryConfirmed: true })).toMatchObject({ status: 'submitted', id: task.id });
    expect(mockFetch.mock.calls[1][1].headers['X-Sync-Pairing-Key']).toBe('new-test-key');
    expect(mockFetch.mock.calls[2][1].headers['X-Sync-Pairing-Key']).toBe('new-test-key');
    expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toMatchObject({ print_job_id: task.id, record: task.record });
  });

  it('does not POST or claim an unknown printing result when pairing failed', async () => {
    const task = await prepareLabelReprint(raw);
    mockFetch.mockResolvedValue(response({ ...health(), pairingRequired: true, pairingAuthenticated: false }));
    expect(await submitLabelReprint(task, { syncConfig: config })).toMatchObject({
      status: 'failed', errorCode: 'SYNC_PAIRING_REQUIRED', resultUnknown: false,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([123, null, {}, [], 'bad\r\nheader'])('rejects invalid saved pairing configuration %j without silently removing protection', async pairingKey => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ ...config, pairingKey }));
    const task = await prepareLabelReprint(raw);
    expect(await submitLabelReprint(task)).toMatchObject({
      status: 'failed', errorCode: 'NO_SYNC_CONFIG', resultUnknown: false,
      lastError: expect.stringContaining('配对密钥'),
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('retains task/session/content on an uncertain network result and retries the same ID', async () => {
    const task = await prepareLabelReprint(raw);
    mockFetch.mockResolvedValueOnce(response(health())).mockRejectedValueOnce(new Error('Network request failed'));
    const failed = await submitLabelReprint(task,{syncConfig:config});
    expect(failed).toMatchObject({id:task.id,reprintSessionId:'session-1',status:'failed',resultUnknown:true});
    expect(failed.record).toBe(task.record);
    mockFetch.mockResolvedValueOnce(response(health())).mockResolvedValueOnce(response(success(task,true)));
    const retried = await submitLabelReprint(failed,{syncConfig:config,retryConfirmed:true});
    expect(retried).toMatchObject({id:task.id,status:'submitted',attemptCount:2});
    expect(retried.lastMessage).toContain('同一任务');
    expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toMatchObject({print_job_id:task.id,retry_confirmed:true,record:task.record});
  });

  it('distinguishes preflight disconnection from an unknown physical printing result', async () => {
    const task = await prepareLabelReprint(raw);
    mockFetch.mockRejectedValue(new Error('offline'));
    expect(await submitLabelReprint(task,{syncConfig:config})).toMatchObject({status:'failed',errorCode:'SYNC_UNAVAILABLE',resultUnknown:false});
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not silently reprint after the helper restarted; manual confirmation can rebind', async () => {
    const task = {...await prepareLabelReprint(raw),reprintSessionId:'old-session',status:'failed' as const};
    mockFetch.mockResolvedValue(response(health('new-session')));
    expect(await submitLabelReprint(task,{syncConfig:config})).toMatchObject({status:'failed',errorCode:'SESSION_CHANGED',resultUnknown:true});
    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockResolvedValueOnce(response(health('new-session'))).mockResolvedValueOnce(response(success(task)));
    expect(await submitLabelReprint(task,{syncConfig:config,retryConfirmed:true})).toMatchObject({status:'submitted',reprintSessionId:'new-session'});
  });

  it.each([{jobId:'wrong-id',copies:2},{jobId:'reprint-new-1',copies:5}])('rejects mismatching task receipts %j', async invalid => {
    const task = await prepareLabelReprint(raw);
    mockFetch.mockResolvedValueOnce(response(health())).mockResolvedValueOnce(response({...success(task),...invalid}));
    expect(await submitLabelReprint(task,{syncConfig:config})).toMatchObject({status:'failed',errorCode:'INVALID_RESPONSE',resultUnknown:true});
  });

  it('coalesces simultaneous calls and never submits a completed task again', async () => {
    const task = await prepareLabelReprint(raw);
    mockFetch.mockResolvedValueOnce(response(health())).mockResolvedValueOnce(response(success(task)));
    const first = submitLabelReprint(task,{syncConfig:config});
    const second = submitLabelReprint(task,{syncConfig:config});
    expect(first).toBe(second);
    const result = await first;
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await submitLabelReprint(result,{syncConfig:config,retryConfirmed:true});
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('stops before POST when the user leaves during preflight', async () => {
    const task = await prepareLabelReprint(raw);
    let resolveHealth!: (response:Response) => void;
    mockFetch.mockReturnValue(new Promise<Response>(resolve => {resolveHealth = resolve;}));
    let active = true;
    const abort = new AbortController();
    const pending = submitLabelReprint(task,{syncConfig:config,signal:abort.signal,shouldContinue:() => active});
    await Promise.resolve();
    await Promise.resolve();
    active = false;
    abort.abort();
    resolveHealth(response(health()));
    expect(await pending).toMatchObject({status:'failed',errorCode:'CANCELED'});
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('shows a permanent validation failure without turning it into an automatic retry', async () => {
    const task = await prepareLabelReprint(raw);
    mockFetch.mockResolvedValueOnce(response(health())).mockResolvedValueOnce(response({
      success:false,code:'INVALID_LABEL_CONTENT',message:'二维码含无法完整打印的字符',retryAllowed:false,resultUnknown:false,
    },400));
    expect(await submitLabelReprint(task,{syncConfig:config})).toMatchObject({status:'failed',errorCode:'INVALID_LABEL_CONTENT',retryAllowed:false,resultUnknown:false});
  });
});
