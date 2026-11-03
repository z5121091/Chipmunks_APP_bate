import { useCallback, useRef, useState } from 'react';
import * as Updates from 'expo-updates';
import { checkpointDatabaseToDisk } from '@/utils/database';
import { lockForOtaApply } from '@/utils/otaSafety';
import { markOtaReload } from '@/utils/otaUpdate';

/** Shared explicit apply flow for the workbench reminder and update settings. */
export function useOtaApply() {
  const inFlight = useRef(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const clearError = useCallback(() => setError(''), []);
  const apply = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setApplying(true);
    setError('');
    let unlock: (() => void) | undefined;
    try {
      unlock = lockForOtaApply();
      await checkpointDatabaseToDisk();
      await markOtaReload();
      await Updates.reloadAsync();
      // Keep submissions locked until the new JS runtime takes over.
    } catch (failure) {
      unlock?.();
      inFlight.current = false;
      setApplying(false);
      setError(failure instanceof Error ? failure.message : '更新未能应用，请重试');
    }
  }, []);
  return { applying, error, apply, clearError };
}
