import AsyncStorage from '@react-native-async-storage/async-storage';
import { NETWORK_CONFIG, STORAGE_KEYS, type SyncConfig } from '@/constants/config';
import {
  detectRule,
  generateId,
  getActiveRules,
  getAllInventoryBindings,
  parseWithRule,
  type InventoryBinding,
  type QRCodeRule,
} from '@/utils/database';
import {
  getSyncConfigError,
  getSyncPairingHeaders,
  getSyncServiceBaseUrl,
  normalizeSyncConfig,
} from '@/utils/heartbeat';
import { parseQuantity } from '@/utils/quantity';
import { isQRCode } from '@/utils/qrcodeParser';
import { assertRuleSupplierForScan, RuleSupplierValidationError } from '@/utils/ruleSupplierValidation';
import { nextLabelTraceNo, rewriteLabelQrQuantity } from '@/utils/labelQrQuantity';

export interface LabelReprintRecord {
  model: string;
  version: string;
  batch: string;
  quantity: number;
  production_date: string;
  trace_no: string;
  source_no: string;
  supplier: string;
  package: string;
  source_qr: string;
}

/** Display and retry state belongs only to the open page, never to storage. */
export interface LabelReprintTask {
  id: string;
  model: string;
  version: string;
  batch: string;
  quantity: number;
  traceNo: string;
  boxNo: string;
  supplier: string;
  sourceQr: string;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'submitting' | 'submitted' | 'failed';
  lastError: string;
  lastMessage: string;
  attemptCount: number;
  record: Readonly<LabelReprintRecord>;
  reprintSessionId?: string;
  errorCode?: string;
  retryAllowed?: boolean;
  resultUnknown?: boolean;
  /** A scan-time snapshot for one unsubmitted edit; never sent to the helper or stored. */
  quantityEditContext?: {
    readonly rule: QRCodeRule;
    readonly fields: Readonly<Record<string, string>>;
  };
  quantityCorrection?: {
    readonly originalQuantity: number;
    readonly originalTraceNo: string;
  };
}

export class LabelReprintValidationError extends Error {
  constructor(public readonly title: string, message: string) {
    super(message);
    this.name = 'LabelReprintValidationError';
  }
}

/** Keyboard scanner input has no symbology; unmatched single-field scans are ignored. */
export class IgnoredLabelReprintScan extends Error {
  constructor() {
    super('已忽略未匹配标签规则的非结构化条码');
    this.name = 'IgnoredLabelReprintScan';
  }
}

const isSingleFieldPackageBarcode = (raw: string): boolean => {
  const value = raw.trim();
  // Package dimensions can themselves contain '*' or '/'. These are not
  // necessarily QR field separators when the whole scan is one package value.
  if (!/^(?:TSSOP|SSOP|MSOP|QSOP|TSOP|ESOP|SOP|SOIC|LQFP|TQFP|PQFP|QFP|UQFN|VQFN|WQFN|QFN|UDFN|WDFN|DFN|WLCSP|CSP|VFBGA|FBGA|TBGA|BGA|LGA|SOT|SOD|PDIP|DIP|PLCC|TO)(?=[\d (./_-])/i.test(value)) return false;
  if (!/^[\w ().*/-]+$/.test(value)) return false;
  let depth = 0;
  let outsideFieldCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth < 0) return false;
    } else if (char === '/' || char === '*') {
      if (depth === 0 && ++outsideFieldCount >= 3) return false;
      if (char === '*' && (
        !/(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.slice(0, index).trimEnd()) ||
        !/^(?:\d+(?:\.\d*)?|\.\d+)/.test(value.slice(index + 1).trimStart())
      )) return false;
    }
  }
  return depth === 0;
};

class LabelReprintSubmissionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryAllowed = true,
    public readonly resultUnknown = false
  ) {
    super(message);
    this.name = 'LabelReprintSubmissionError';
  }
}

/** Every binding version participates; version never selects a supplier. */
export const resolveLabelReprintSupplier = (
  model: string,
  bindings: readonly InventoryBinding[]
): string => {
  const key = model.trim().toLowerCase();
  const suppliers = new Map<string, string>();
  for (const binding of bindings) {
    if (binding.scan_model.trim().toLowerCase() !== key) continue;
    const supplier = binding.supplier?.trim();
    if (supplier) suppliers.set(supplier.toLowerCase(), supplier);
  }
  if (suppliers.size === 0) {
    throw new LabelReprintValidationError(
      '未找到供应商',
      `型号「${model}」没有对应供应商，本次未打印。请补全现有物料绑定。`
    );
  }
  if (suppliers.size > 1) {
    throw new LabelReprintValidationError(
      '供应商匹配不唯一',
      `型号「${model}」对应多个供应商，本次未打印。请核对物料绑定。`
    );
  }
  return [...suppliers.values()][0];
};

/** Only reads configured rules/bindings; never creates a business or print row. */
export const prepareLabelReprint = async (raw: string): Promise<LabelReprintTask> => {
  if (!raw.trim()) {
    throw new LabelReprintValidationError('等待扫码', '请扫描需要补打的标签。');
  }
  const rule = await detectRule(raw);
  if (!rule) {
    // A configured rule always wins. Only unmatched, unstructured input may be
    // a package's 1D model/quantity/batch barcode; unknown structured QR stays an error.
    if (isSingleFieldPackageBarcode(raw) || !isQRCode(raw, await getActiveRules())) {
      throw new IgnoredLabelReprintScan();
    }
    throw new LabelReprintValidationError(
      '无法识别标签',
      '未匹配到二维码解析规则，本次未打印。请核对标签或现有解析规则。'
    );
  }
  const { standardFields: fields } = parseWithRule(raw, rule);
  const model = fields.model?.trim() || '';
  const quantity = parseQuantity(fields.quantity);
  if (!model || quantity === null) {
    throw new LabelReprintValidationError(
      '标签信息不完整',
      '未读到有效的型号或数量，本次未打印。请核对二维码。'
    );
  }
  const supplier = resolveLabelReprintSupplier(model, await getAllInventoryBindings());
  try {
    await assertRuleSupplierForScan({ rule, materialSupplier: supplier });
  } catch (error) {
    if (error instanceof RuleSupplierValidationError) {
      throw new LabelReprintValidationError(error.title, error.message);
    }
    throw error;
  }
  const record: Readonly<LabelReprintRecord> = Object.freeze({
    model,
    version: fields.version || '',
    batch: fields.batch || '',
    quantity,
    production_date: fields.productionDate || '',
    trace_no: fields.traceNo || '',
    source_no: fields.sourceNo || '',
    supplier,
    package: fields.package || '',
    // Reprinting preserves the actual scanned QR, including its separator/endings.
    source_qr: raw,
  });
  const now = new Date().toISOString();
  return {
    id: `reprint-${generateId()}`,
    model,
    version: record.version,
    batch: record.batch,
    quantity,
    traceNo: record.trace_no,
    boxNo: record.source_no,
    supplier,
    sourceQr: raw,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    lastError: '',
    lastMessage: '',
    attemptCount: 0,
    record,
    quantityEditContext: {
      rule: JSON.parse(JSON.stringify(rule)) as QRCodeRule,
      fields: Object.freeze({ ...fields }),
    },
  };
};

/** Correction input deliberately accepts digits only, not decimals, signs or units. */
export const parseLabelCorrectionQuantity = (input: string): number => {
  const value = input.trim();
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new LabelReprintValidationError('数量无效', '请输入大于 0 的整数，不允许 0、负数或小数。');
  }
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity)) {
    throw new LabelReprintValidationError('数量过大', '数量过大，无法准确打印，请核对输入。');
  }
  return quantity;
};

export const getLabelCorrectionTraceNo = (original: LabelReprintTask, newQuantity: number): string => {
  if (!Number.isSafeInteger(newQuantity) || newQuantity <= 0) {
    throw new LabelReprintValidationError('数量无效', '请输入大于 0 的整数，不允许 0、负数或小数。');
  }
  return newQuantity === original.quantity ? original.traceNo : nextLabelTraceNo(original.traceNo);
};

/** Freeze one corrected payload before submission; retry always uses that same task. */
export const applyLabelQuantityCorrection = async (
  original: LabelReprintTask,
  newQuantity: number
): Promise<LabelReprintTask> => {
  const traceNo = getLabelCorrectionTraceNo(original, newQuantity);
  if (original.status !== 'pending' || original.attemptCount !== 0 || original.quantityCorrection) {
    throw new LabelReprintValidationError('请重新扫码', '这张标签已处理过，请重新扫码后修改数量。');
  }
  if (newQuantity === original.quantity) return original;
  const context = original.quantityEditContext;
  if (!context) {
    throw new LabelReprintValidationError('请重新扫码', '缺少本次标签的解析规则，请重新扫码后修改数量。');
  }
  try {
    const rewritten = rewriteLabelQrQuantity(original.sourceQr, context.rule, newQuantity);
    if (rewritten.traceNo !== traceNo || rewritten.quantity !== newQuantity) {
      throw new Error('新数量或追溯码核对失败，本次未打印。');
    }
    // A settings change or overlapping rule must not produce a label the scanner reads differently.
    const selectedRule = await detectRule(rewritten.sourceQr);
    if (!selectedRule || selectedRule.id !== context.rule.id) {
      throw new Error('修改后的二维码无法匹配原解析规则，请核对识别条件。本次未打印。');
    }
    const after = parseWithRule(rewritten.sourceQr, selectedRule).standardFields;
    const keys = new Set([...Object.keys(context.fields), ...Object.keys(after)]);
    for (const key of keys) {
      const expected = key === 'traceNo' ? traceNo : context.fields[key];
      const matches = key === 'quantity'
        ? parseQuantity(after[key]) === newQuantity
        : (after[key] || '') === (expected || '');
      if (!matches) throw new Error('修改后的二维码字段核对不一致，请检查解析规则。本次未打印。');
    }
    const record = Object.freeze({
      ...original.record,
      quantity: newQuantity,
      trace_no: traceNo,
      source_qr: rewritten.sourceQr,
    });
    return {
      ...original,
      quantity: newQuantity,
      traceNo,
      sourceQr: rewritten.sourceQr,
      record,
      updatedAt: new Date().toISOString(),
      quantityCorrection: Object.freeze({ originalQuantity: original.quantity, originalTraceNo: original.traceNo }),
    };
  } catch (error) {
    if (error instanceof LabelReprintValidationError) throw error;
    throw new LabelReprintValidationError('无法修改数量',
      error instanceof Error ? error.message : '无法准确修改二维码字段，本次未打印，请核对解析规则。');
  }
};

export interface LabelReprintSubmitOptions {
  retryConfirmed?: boolean;
  signal?: AbortSignal;
  shouldContinue?: () => boolean;
  syncConfig?: SyncConfig;
}

interface ReprintHealth {
  pairingRequired?: boolean;
  pairingAuthenticated?: boolean;
  status?: string;
  serviceId?: string;
  labelReprintApiVersion?: number;
  labelReprintSessionId?: string;
  labelReprintSuppliers?: string[];
}

interface ReprintResponse {
  success?: boolean;
  state?: string;
  jobId?: string;
  copies?: number;
  duplicate?: boolean;
  code?: string;
  message?: string;
  retryAllowed?: boolean;
  resultUnknown?: boolean;
}

const checkActive = (options: LabelReprintSubmitOptions) => {
  if (options.signal?.aborted || options.shouldContinue?.() === false) {
    throw new LabelReprintSubmissionError('已退出标签补打页面', 'CANCELED', false);
  }
};

/** Reads existing connection settings without updating settings/status storage. */
const loadConfig = async (): Promise<SyncConfig> => {
  const serialized = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_CONFIG);
  try {
    const value: unknown = serialized ? JSON.parse(serialized) : null;
    if (
      value && typeof value === 'object' &&
      'ip' in value && typeof value.ip === 'string' &&
      'port' in value && typeof value.port === 'string'
    ) {
      const pairingKey = 'pairingKey' in value ? value.pairingKey : undefined;
      if (pairingKey !== undefined && typeof pairingKey !== 'string') {
        throw new LabelReprintSubmissionError('配对密钥配置无效，请在设置中重新填写并测试连接。本次未提交打印。', 'NO_SYNC_CONFIG');
      }
      return normalizeSyncConfig({ ip: value.ip, port: value.port, pairingKey });
    }
  } catch (error) {
    if (error instanceof LabelReprintSubmissionError) throw error;
    // No labels/configuration are sent to logs by this feature.
  }
  throw new LabelReprintSubmissionError(
    '请先在设置中配置同步助手的电脑地址和端口', 'NO_SYNC_CONFIG'
  );
};

const requestJson = async <T>(
  url: string,
  init: RequestInit,
  timeout: number,
  options: LabelReprintSubmitOptions,
  printing = false
): Promise<{ response: Response; payload: T | null }> => {
  checkActive(options);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    checkActive(options);
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null) as T | null;
    checkActive(options);
    return { response, payload };
  } catch (error) {
    if (options.signal?.aborted || options.shouldContinue?.() === false) {
      throw new LabelReprintSubmissionError('已退出标签补打页面', 'CANCELED', false, printing);
    }
    if (error instanceof LabelReprintSubmissionError) throw error;
    throw new LabelReprintSubmissionError(
      printing
        ? '未收到打印结果，请先核对标签是否已出纸，再重试。'
        : '未连接到同步助手，请确认电脑端已开启同步助手及网络连接。',
      printing ? 'RESULT_UNKNOWN' : 'SYNC_UNAVAILABLE',
      true,
      printing
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
};

const activeSubmissions = new Map<string, Promise<LabelReprintTask>>();

const performSubmission = async (
  original: LabelReprintTask,
  options: LabelReprintSubmitOptions
): Promise<LabelReprintTask> => {
  let task: LabelReprintTask = {
    ...original,
    status: 'submitting',
    lastError: '',
    lastMessage: '',
    errorCode: undefined,
    retryAllowed: undefined,
    resultUnknown: undefined,
    attemptCount: original.attemptCount + 1,
    updatedAt: new Date().toISOString(),
  };
  try {
    checkActive(options);
    const config = options.syncConfig || await loadConfig();
    checkActive(options);
    const configError = getSyncConfigError(config);
    if (configError) {
      throw new LabelReprintSubmissionError(`同步助手配置无效：${configError}。请在设置中核对后重试。`, 'NO_SYNC_CONFIG');
    }
    const baseUrl = getSyncServiceBaseUrl(config);
    const health = await requestJson<ReprintHealth>(
      `${baseUrl}/health`, { method: 'GET',
        ...(config.pairingKey?.trim() ? { headers: getSyncPairingHeaders(config) } : {}) }, NETWORK_CONFIG.HEARTBEAT_TIMEOUT, options
    );
    if (!health.response.ok || health.payload?.status !== 'ok' || health.payload.serviceId !== 'palm-warehouse-sync') {
      throw new LabelReprintSubmissionError('未连接到同步助手，请确认电脑端已开启同步助手及网络连接。', 'SYNC_UNAVAILABLE');
    }
    if (health.payload.pairingRequired === true && health.payload.pairingAuthenticated !== true) {
      throw new LabelReprintSubmissionError('同步助手配对失败，请在设置中核对配对密钥。本次未提交打印。', 'SYNC_PAIRING_REQUIRED');
    }
    const sessionId = health.payload.labelReprintSessionId;
    if (
      health.payload.labelReprintApiVersion !== 1 || typeof sessionId !== 'string' || !sessionId.trim() ||
      !Array.isArray(health.payload.labelReprintSuppliers)
    ) {
      throw new LabelReprintSubmissionError(
        '当前同步助手尚不支持标签补打，请使用包含标签补打功能的同步助手。', 'UNSUPPORTED_HELPER'
      );
    }
    if (!health.payload.labelReprintSuppliers.includes(task.supplier)) {
      throw new LabelReprintSubmissionError(
        `供应商「${task.supplier}」没有可用标签模板，本次未打印。`, 'NO_TEMPLATE', false
      );
    }
    if (original.reprintSessionId && original.reprintSessionId !== sessionId && !options.retryConfirmed) {
      throw new LabelReprintSubmissionError(
        '同步助手已重新启动，原任务结果无法确认。请先核对标签是否已出纸，再使用核对后重试。',
        'SESSION_CHANGED', true, true
      );
    }
    task = { ...task, reprintSessionId: sessionId };
    const { response, payload } = await requestJson<ReprintResponse>(
      `${baseUrl}/label-reprint`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getSyncPairingHeaders(config) },
        body: JSON.stringify({
          print_job_id: task.id,
          reprint_session_id: sessionId,
          record: task.record,
          retry_confirmed: options.retryConfirmed === true,
        }),
      },
      NETWORK_CONFIG.SYNC_TIMEOUT,
      options,
      true
    );
    if (!response.ok || payload?.success !== true) {
      throw new LabelReprintSubmissionError(
        payload?.message || '未收到有效的打印结果，请先核对标签是否已出纸，再重试。',
        payload?.code || 'RESULT_UNKNOWN',
        payload?.retryAllowed !== false,
        payload?.resultUnknown ?? true
      );
    }
    if (payload.state !== 'submitted' || payload.jobId !== task.id || payload.copies !== 2) {
      throw new LabelReprintSubmissionError(
        '同步助手返回的打印任务结果不一致，请先核对标签是否已出纸，再重试。',
        'INVALID_RESPONSE', true, true
      );
    }
    return {
      ...task,
      status: 'submitted',
      updatedAt: new Date().toISOString(),
      lastMessage: payload.duplicate === true
        ? '同步助手已识别为同一任务，请核对已有标签'
        : '已提交两张标签，实际出纸请核对',
      retryAllowed: false,
      resultUnknown: false,
    };
  } catch (error) {
    const failure = error instanceof LabelReprintSubmissionError
      ? error
      : new LabelReprintSubmissionError('标签补打提交失败，请检查同步助手后重试。', 'SUBMISSION_FAILED');
    return {
      ...task,
      status: 'failed',
      updatedAt: new Date().toISOString(),
      lastError: failure.message,
      errorCode: failure.code,
      retryAllowed: failure.retryAllowed,
      resultUnknown: failure.resultUnknown,
    };
  }
};

/** In-flight coalescing is memory only; /labels and durable unpack tasks are never used. */
export const submitLabelReprint = (
  task: LabelReprintTask,
  options: LabelReprintSubmitOptions = {}
): Promise<LabelReprintTask> => {
  if (task.status === 'submitted') return Promise.resolve(task);
  const active = activeSubmissions.get(task.id);
  if (active) return active;
  const request = Promise.resolve()
    .then(() => performSubmission(task, options))
    .finally(() => {
      if (activeSubmissions.get(task.id) === request) activeSubmissions.delete(task.id);
    });
  activeSubmissions.set(task.id, request);
  return request;
};
