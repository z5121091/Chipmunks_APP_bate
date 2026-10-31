import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ERP_ACCOUNTS, isErpAccountAvailable } from '@/utils/erpAccounts';
import {
  fetchPurchaseReceiveVoucherStatuses,
  revalidatePendingPurchaseReceives,
  savePurchaseReceiveVoucherStatusesCache,
} from '@/utils/erpPurchaseReceive';
import { logger } from '@/utils/logger';

const STATUS_REFRESH_INTERVAL_MS = 60_000;

/** Keep the workbench's purchase lists ready before the user opens receiving. */
export function usePendingPurchaseReceivePrefetch(onUpdated: (isCurrent: () => boolean) => Promise<void>) {
  useFocusEffect(useCallback(() => {
    let active = true;
    let listRunning = false;
    let statusesRunning = false;
    const isForeground = () => !AppState.currentState || AppState.currentState === 'active';

    const refresh = async (includeList: boolean) => {
      if (!active || !isForeground()) return;
      try {
        const accounts = ERP_ACCOUNTS.filter(isErpAccountAvailable);
        const operations: Promise<boolean>[] = [];
        if (includeList && !listRunning) {
          listRunning = true;
          operations.push(Promise.allSettled(
            accounts.map(account => revalidatePendingPurchaseReceives(account))
          ).then(results => {
            results.forEach((result, index) => {
              if (result.status === 'rejected') {
                logger.warn(`[首页] 预加载采购待收货列表失败（${accounts[index].name}）`, result.reason);
              }
            });
            return results.some(result => result.status === 'fulfilled');
          }).finally(() => { listRunning = false; }));
        }
        if (!statusesRunning) {
          statusesRunning = true;
          operations.push(Promise.allSettled(
            accounts.map(account => fetchPurchaseReceiveVoucherStatuses(account)
              .then(statuses => savePurchaseReceiveVoucherStatusesCache(account.key, statuses)))
          ).then(results => {
            results.forEach((result, index) => {
              if (result.status === 'rejected') {
                logger.warn(`[首页] 更新采购审核状态失败（${accounts[index].name}）`, result.reason);
              }
            });
            return results.some(result => result.status === 'fulfilled');
          }).finally(() => { statusesRunning = false; }));
        }
        const results = await Promise.all(operations);
        if (active && isForeground() && results.some(Boolean)) {
          await onUpdated(() => active && isForeground());
        }
      } catch (error) {
        logger.warn('[首页] 更新采购待办快照失败:', error);
      }
    };

    // Only entry/resume checks the once-a-day ERP preload. The timer reads local audit messages.
    void refresh(true);
    const timer = setInterval(() => { void refresh(false); }, STATUS_REFRESH_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh(true);
    });
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [onUpdated]));
}
