jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import { isBackupDataShape } from '../database';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const createBackup = () => ({
  version: 12,
  timestamp: '2026-08-11T09:00:00.000Z',
  backupTime: '2026-08-11T09:00:00.000Z',
  rules: [],
  customFields: [],
  warehouses: [],
  outboundWarehouseOrderRules: {},
  soundEnabled: true,
  syncConfig: null,
  stats: {
    rules: 0,
    customFields: 0,
    warehouses: 0,
  },
});

describe('configuration backup shape', () => {
  it('accepts new configuration backups without material bindings', () => {
    expect(isBackupDataShape(createBackup())).toBe(true);
  });

  it('accepts legacy backups that contain material bindings so other settings can still restore', () => {
    const legacyBackup = {
      ...createBackup(),
      inventoryBindings: [
        {
          id: 'legacy-binding',
          scan_model: 'MODEL-A',
          version: '',
          inventory_code: 'IC.0001',
          created_at: '2026-08-01T00:00:00.000Z',
        },
      ],
      stats: {
        ...createBackup().stats,
        inventoryBindings: 1,
      },
    };

    expect(isBackupDataShape(legacyBackup)).toBe(true);
  });

  it('still rejects backups missing required configuration collections', () => {
    const invalidBackup = { ...createBackup() } as Record<string, unknown>;
    delete invalidBackup.warehouses;

    expect(isBackupDataShape(invalidBackup)).toBe(false);
  });
});

describe('native automatic database backup', () => {
  it('checks the physical SQLite business table names in both worker sources', () => {
    const workerPaths = [
      'plugins/AutoDatabaseBackupWorker.kt',
      'android/app/src/main/java/com/chipmunks/traceability/AutoDatabaseBackupWorker.kt',
    ];
    const tableNames = [
      'orders',
      'materials',
      'inbound_records',
      'inventory_check_records',
      'unpack_records',
    ];

    for (const workerPath of workerPaths) {
      const source = readFileSync(resolve(process.cwd(), workerPath), 'utf8');
      for (const tableName of tableNames) {
        expect(source).toContain(`"${tableName}"`);
      }
    }
  });
});
