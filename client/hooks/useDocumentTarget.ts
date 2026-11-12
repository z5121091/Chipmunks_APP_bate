import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSafeSearchParams } from '@/hooks/useSafeRouter';

/** Locate a home shortcut once; subsequent filtering and disclosure stay user-controlled. */
export function useDocumentTarget<T>({
  documents, ready, getKey, isActive, openDocument, onMissing,
}: {
  documents: T[];
  ready: boolean;
  getKey: (document: T) => string;
  isActive: () => boolean;
  openDocument: (document: T) => void;
  onMissing: () => void;
}) {
  const params = useSafeSearchParams<{ documentNo?: string; warehouseId?: string }>();
  const documentNo = typeof params.documentNo === 'string' ? params.documentNo.trim() : '';
  const warehouseId = typeof params.warehouseId === 'string' ? params.warehouseId.trim() : '';
  const targetKey = documentNo ? `${warehouseId}::${documentNo}` : '';
  const handledTarget = useRef('');
  const [pinnedKey, setPinnedKey] = useState(targetKey);

  useEffect(() => {
    if (!targetKey || handledTarget.current === targetKey || !ready || !isActive()) return;
    handledTarget.current = targetKey;
    // A number alone is not unique across warehouses. Never open a guessed match.
    const target = warehouseId ? documents.find(document => getKey(document) === targetKey) : undefined;
    setPinnedKey(target ? targetKey : '');
    if (target) openDocument(target);
    else onMissing();
  }, [documents, getKey, isActive, onMissing, openDocument, ready, targetKey, warehouseId]);

  const clearTarget = useCallback(() => {
    handledTarget.current = targetKey;
    setPinnedKey('');
  }, [targetKey]);

  const visibleDocuments = useMemo(() => {
    const index = documents.findIndex(document => getKey(document) === pinnedKey);
    if (index <= 0) return documents;
    return [documents[index], ...documents.slice(0, index), ...documents.slice(index + 1)];
  }, [documents, getKey, pinnedKey]);

  return { clearTarget, visibleDocuments };
}
