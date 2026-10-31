import version from '../../version.json';
import { APP_VERSION, CHANGELOG_DATA, SELF_UPDATE_ENABLED } from '../version';

describe('V1.0 release metadata', () => {
  it('uses the requested formal release number', () => {
    expect(APP_VERSION).toBe('V1.0');
    expect(CHANGELOG_DATA).toEqual([{
      version: 'V1.0',
      date: '2026-09-22',
      changes: [{ type: 'feat', text: '掌上仓库正式发布' }],
    }]);
    expect(version.versionCode).toBe(100);
    expect(version.buildNumber).toBe(100);
  });

  it('uses the formal Android identity and keeps NAS self-update available', () => {
    expect(version.androidPackage).toBe('com.chipmunks.traceability');
    expect(version.appName).toBe('掌上仓库');
    expect(SELF_UPDATE_ENABLED).toBe(true);
  });
});
