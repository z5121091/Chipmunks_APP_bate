import { NETWORK_CONFIG, type SyncConfig } from '@/constants/config';
import { getAllWarehouses } from './database';
import { getSyncPairingHeaders, getSyncServiceBaseUrl, getWarehouseArchiveSession } from './heartbeat';

let lastPublished = '';
let publishing = false;

/** Precreate folders after a verified connection, without uploading any document. */
export const syncWarehouseDirectories = async (config: SyncConfig, isCurrent: () => boolean): Promise<void> => {
  const session = getWarehouseArchiveSession(config);
  if (session === null || publishing || !isCurrent()) return;

  publishing = true;
  try {
    const warehouses = (await getAllWarehouses())
      .map(({ id, name }) => ({ id: id.trim(), name: name.trim() }))
      .filter(({ id, name }) => id && name)
      .sort((left, right) => left.id.localeCompare(right.id));
    const baseUrl = getSyncServiceBaseUrl(config);
    const body = JSON.stringify({ warehouses });
    const signature = JSON.stringify([baseUrl, session, body]);
    if (!warehouses.length || signature === lastPublished || !isCurrent()) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NETWORK_CONFIG.HEARTBEAT_TIMEOUT);
    try {
      const response = await fetch(`${baseUrl}/warehouses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getSyncPairingHeaders(config) },
        body,
        signal: controller.signal,
      });
      if (!response.ok || (await response.json()).success !== true) {
        throw new Error('电脑端仓库目录同步失败');
      }
      if (isCurrent()) lastPublished = signature;
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    publishing = false;
  }
};
