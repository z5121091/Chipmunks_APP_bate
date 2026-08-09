import { backendJsonRequest, buildErpProxyPath } from '@/utils/backendApi';
import {
  ErpAccountConfig,
  requireErpAccountBackend,
} from '@/utils/erpAccounts';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';

const SALE_DISPATCH_GET_DTO_PATH = buildErpProxyPath(
  '/tplus/api/v2/SaleDispatchOpenApi/GetVoucherDTO'
);

type MaybeRecord = Record<string, unknown>;

type ChanjetProxyResponse<T> = {
  data?: T;
  details?: unknown;
  message?: string;
  success?: boolean;
};

type ChanjetVoucherResponse = {
  code?: string | number;
  data?: MaybeRecord | null;
  exception?: unknown;
  message?: string;
};

export interface SaleDispatchLine {
  inventoryCode: string;
  inventoryName: string;
  quantity: number;
  raw: MaybeRecord;
  specification: string;
  unitName: string;
}

export interface SaleDispatchVoucher {
  accountKey: ErpAccountConfig['key'];
  accountName: string;
  clerkName: string;
  code: string;
  customerName: string;
  expectedWarehouseName: string;
  id: number | string;
  lines: SaleDispatchLine[];
  raw: MaybeRecord;
  sourceVoucherCode: string;
  statusName: string;
  voucherDate: string;
  warehouseName: string;
}

const asRecord = (value: unknown): MaybeRecord => {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as MaybeRecord : {};
};

const isRecord = (value: unknown): value is MaybeRecord => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const asText = (value: unknown): string => {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
};

const asNumber = (value: unknown): number => {
  const parsed = Number(asText(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const mapLine = (value: unknown): SaleDispatchLine => {
  const raw = asRecord(value);
  const inventory = asRecord(raw.Inventory);
  const unit = asRecord(raw.Unit);

  return {
    inventoryCode: asText(inventory.Code),
    inventoryName: asText(inventory.Name),
    quantity: asNumber(raw.Quantity),
    raw,
    specification: asText(inventory.Specification),
    unitName: asText(unit.Name),
  };
};

export const mapSaleDispatchVoucher = (
  account: ErpAccountConfig,
  value: MaybeRecord
): SaleDispatchVoucher => {
  const partner = asRecord(value.Partner);
  const warehouse = asRecord(value.Warehouse);
  const clerk = asRecord(value.Clerk);
  const voucherState = asRecord(value.VoucherState);
  const details = Array.isArray(value.RDRecordDetails) ? value.RDRecordDetails : [];

  return {
    accountKey: account.key,
    accountName: account.name,
    clerkName: asText(clerk.Name),
    code: asText(value.Code),
    customerName: asText(partner.Name),
    expectedWarehouseName: account.expectedWarehouseName,
    id: asText(value.ID),
    lines: details.map(mapLine),
    raw: value,
    sourceVoucherCode: asText(value.SourceVoucherCode),
    statusName: asText(voucherState.Name),
    voucherDate: asText(value.VoucherDate),
    warehouseName: asText(warehouse.Name),
  };
};

const formatPayloadPreview = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').slice(0, 160);
  }

  try {
    return JSON.stringify(value).slice(0, 240);
  } catch {
    return String(value).slice(0, 160);
  }
};

const looksLikeVoucherRecord = (value: MaybeRecord): boolean => {
  return Boolean(value.Code || value.ID || value.RDRecordDetails || value.Partner || value.Warehouse);
};

const INVALID_VOUCHER_STATUS_KEYWORDS = ['作废', '关闭', '取消', '废止'];

const assertSaleDispatchStatusAllowed = (voucher: SaleDispatchVoucher): void => {
  const normalizedStatus = voucher.statusName.replace(/\s+/g, '');
  if (
    normalizedStatus &&
    INVALID_VOUCHER_STATUS_KEYWORDS.some((keyword) => normalizedStatus.includes(keyword))
  ) {
    throw new Error(`${voucher.code} 当前状态为${voucher.statusName}，不允许继续扫码出库`);
  }
};

const extractVoucherPayload = (
  response: unknown
): {
  errorMessage?: string;
  payload?: ChanjetVoucherResponse;
} => {
  if (!isRecord(response)) {
    return {
      errorMessage: `后端返回的不是ERP JSON，请检查后端地址。返回预览：${formatPayloadPreview(response)}`,
    };
  }

  const proxyResponse = response as ChanjetProxyResponse<unknown>;

  if (proxyResponse.success === false) {
    return {
      errorMessage:
        (asText(proxyResponse.message)
          ? formatUserFacingErrorMessage(proxyResponse.message, '后端ERP代理请求失败')
          : '') ||
        `后端ERP代理请求失败：${formatPayloadPreview(proxyResponse.details || response)}`,
    };
  }

  const firstLayerData = isRecord(proxyResponse.data) ? proxyResponse.data : null;

  if (firstLayerData && ('code' in firstLayerData || 'data' in firstLayerData)) {
    return {
      payload: firstLayerData as ChanjetVoucherResponse,
    };
  }

  if ('code' in response || 'data' in response) {
    return {
      payload: response as ChanjetVoucherResponse,
    };
  }

  if (firstLayerData && looksLikeVoucherRecord(firstLayerData)) {
    return {
      payload: {
        code: '0',
        data: firstLayerData,
        message: 'ok',
      },
    };
  }

  if (looksLikeVoucherRecord(response)) {
    return {
      payload: {
        code: '0',
        data: response,
        message: 'ok',
      },
    };
  }

  return {
    errorMessage: `销售出库单查询返回结构异常：${formatPayloadPreview(response)}`,
  };
};

export const fetchSaleDispatchVoucher = async (
  account: ErpAccountConfig,
  voucherCode: string,
  options: { bypassCache?: boolean } = {}
): Promise<SaleDispatchVoucher> => {
  const normalizedVoucherCode = voucherCode.trim().toUpperCase();

  if (!normalizedVoucherCode) {
    throw new Error('销售出库单号不能为空');
  }

  const response = await backendJsonRequest<unknown>(
    SALE_DISPATCH_GET_DTO_PATH,
    {
      baseUrl: requireErpAccountBackend(account),
      body: {
        param: {
          voucherCode: normalizedVoucherCode,
        },
      },
      erpAccountKey: account.key,
      erpCacheMode: options.bypassCache ? 'bypass' : 'default',
    }
  );
  const { errorMessage, payload } = extractVoucherPayload(response);

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  if (!payload || String(payload.code) !== '0' || !payload.data) {
    const message = asText(payload?.message)
      ? formatUserFacingErrorMessage(payload?.message, 'ERP未提供具体错误原因')
      : formatPayloadPreview(payload?.exception);
    throw new Error(
      `销售出库单查询失败${message ? `：${message}` : ''}（账套：${account.name}，单号：${normalizedVoucherCode}）`
    );
  }

  const voucher = mapSaleDispatchVoucher(account, asRecord(payload.data));
  const returnedVoucherCode = voucher.code.trim().toUpperCase();

  if (!returnedVoucherCode) {
    throw new Error(`ERP未返回销售出库单编号（请求单号：${normalizedVoucherCode}）`);
  }

  if (returnedVoucherCode !== normalizedVoucherCode) {
    throw new Error(
      `ERP返回单号与扫描单号不一致：扫描 ${normalizedVoucherCode}，返回 ${voucher.code}`
    );
  }

  if (voucher.warehouseName && voucher.warehouseName !== account.expectedWarehouseName) {
    throw new Error(
      `${account.name} 单据仓库应为 ${account.expectedWarehouseName}，实际为 ${voucher.warehouseName}`
    );
  }

  assertSaleDispatchStatusAllowed(voucher);

  return voucher;
};
