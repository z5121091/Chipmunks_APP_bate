import { Platform } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

it('supports file, move, rename, reorder and dissolve in the existing Web preview adapter', async () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  try {
    const database: typeof import('../database') = require('../database');
    const first = await database.addRuleFolder('First');
    const second = await database.addRuleFolder('Second');
    const member = await database.addRule({ name: 'Preview member', description: '', separator: '%',
      fieldOrder: ['model', 'quantity'], isActive: true, folderId: first });
    expect((await database.getRuleById(member))?.folderId).toBe(first);
    await database.moveRulesToFolder([member], second);
    await database.renameRuleFolder(second, 'Renamed');
    await database.setRuleFoldersDisplayOrder([second, first]);
    expect((await database.getAllRuleFolders()).map(folder => folder.name)).toEqual(['Renamed', 'First']);
    await database.deleteRuleFolder(second);
    expect((await database.getRuleById(member))?.folderId).toBeUndefined();
    expect(await database.getAllRules()).toHaveLength(1);
    const backup = await database.exportBackupData();
    expect(backup.ruleFolders).toEqual(await database.getAllRuleFolders());
    expect(await database.importBackupData(backup)).toMatchObject({ success: true });
    expect((await database.getAllRuleFolders()).map(folder => folder.id)).toEqual([first]);
  } finally {
    if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
  }
});
