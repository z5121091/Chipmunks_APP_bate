import {
  finishInternalLabelCorrection,
  generateInternalLabelPackageId,
  hasInternalLabelPackageForStock,
  readInternalLabelPrintTasks,
  registerInternalLabelPackages,
} from '@/utils/database';
import { ERP_ACCOUNTS, type ErpAccountKey } from '@/utils/erpAccounts';
import { fetchCurrentStockByInventoryCode } from '@/utils/erpCurrentStock';
import { isInternalInventoryCode, type InternalLabelPackage, type InternalLabelStock } from '@/utils/internalLabelCode';
import { createInternalLabelReprintTask, isLabelReprintInFlight, type LabelReprintTask } from '@/utils/labelReprint';

export type { InternalLabelStock } from '@/utils/internalLabelCode';

export async function queryInternalLabelStock(accountKey: ErpAccountKey, inventoryCode: string): Promise<InternalLabelStock[]> {
  const code = inventoryCode.trim();
  if (!isInternalInventoryCode(code)) throw new Error('请输入完整的 ERP 存货编码');
  const account = ERP_ACCOUNTS.find(item => item.key === accountKey);
  if (!account) throw new Error('请先选择 ERP 账套');
  const result = await fetchCurrentStockByInventoryCode(account, code, { forceRefresh: true });
  if (result.accountKey !== account.key) throw new Error('现存量返回的账套不匹配，请重新查询');
  const expectedWarehouse = account.expectedWarehouseName.trim();
  if (!expectedWarehouse) throw new Error('当前账套未配置内部标签使用的主仓');
  let stock: InternalLabelStock | undefined;
  for (const row of result.rows) {
    if (row.inventoryCode.trim().toUpperCase() !== code.toUpperCase() || row.warehouseName.trim() !== expectedWarehouse) continue;
    const warehouseCode = row.warehouseCode.trim() || row.warehouseName.trim();
    if (stock) throw new Error(`ERP 返回了「${expectedWarehouse}」的多条现存量，无法确认建标数量`);
    const existing = row.raw.ExistingQuantity;
    const text = typeof existing === 'number' || typeof existing === 'string' ? String(existing).trim() : '';
    const quantity = /^\d+(?:\.0+)?$/.test(text) ? Number(text) : NaN;
    stock = {
      accountKey, warehouseCode, warehouseName: row.warehouseName.trim(), inventoryCode: row.inventoryCode.trim(),
      inventoryName: row.inventoryName.trim(), specification: row.specification.trim(), quantity,
    };
  }
  if (!stock) throw new Error(`ERP 未返回存货编码 ${code} 在「${expectedWarehouse}」的现存量`);
  return [stock];
}

export const findExistingInternalLabelPackage = hasInternalLabelPackageForStock;

export async function createInternalLabelTasks(
  stock: InternalLabelStock,
  quantities: number[],
  options: { allowExistingStock?: boolean } = {},
): Promise<LabelReprintTask[]> {
  if (!stock.inventoryName.trim()) throw new Error('ERP 未返回存货名称，无法生成标签');
  if (!Number.isSafeInteger(stock.quantity) || stock.quantity <= 0) {
    throw new Error('所选仓库的 ERP 现存量必须是大于 0 的整数');
  }
  if (!quantities.length || quantities.some(quantity => !Number.isSafeInteger(quantity) || quantity <= 0)) {
    throw new Error('每包数量必须是大于 0 的整数');
  }
  if (quantities.reduce((sum, quantity) => sum + quantity, 0) !== stock.quantity) {
    throw new Error('分配数量与 ERP 现存量有差额，请核对后再打印');
  }
  const entries = quantities.map(quantity => {
    const label: InternalLabelPackage = { ...stock, quantity, packageId: generateInternalLabelPackageId(), revision: 1 };
    return { label, task: createInternalLabelReprintTask(label, 'create') };
  });
  await registerInternalLabelPackages(entries, options);
  return entries.map(entry => entry.task);
}

export async function loadInternalLabelTasks(): Promise<LabelReprintTask[]> {
  const tasks = await readInternalLabelPrintTasks();
  return tasks.map(task => task.status === 'submitting' ? {
    ...task, status: 'failed', lastError: '上次打印结果未确认，请核对实际出纸后再重试',
    retryAllowed: true, resultUnknown: true,
  } : task);
}

export const activateInternalLabelCorrection = (task: LabelReprintTask) => finishInternalLabelCorrection(task.id, true);
export async function cancelInternalLabelCorrection(task: LabelReprintTask): Promise<void> {
  if (isLabelReprintInFlight(task.id)) throw new Error('正在提交打印，请稍后处理');
  await finishInternalLabelCorrection(task.id, false);
}
