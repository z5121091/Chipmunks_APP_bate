import { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { AppModal } from '@/components/AppModal';
import { AppModalCard } from '@/components/AppModalCard';
import { UiInput, UiToolbarButton } from '@/components/UiRedesign';
import { WarehouseScanInput } from '@/components/WarehouseScanInput';
import { ERP_ACCOUNTS, isErpAccountAvailable, type ErpAccountKey } from '@/utils/erpAccounts';
import { findExistingInternalLabelPackage, queryInternalLabelStock, type InternalLabelStock } from '@/utils/internalLabels';
import { parseLabelCorrectionQuantity } from '@/utils/labelReprint';
import type { createStyles } from './styles';

type Props = {
  styles: ReturnType<typeof createStyles>;
  overlayPadding: ViewStyle;
  modalHeight: number;
  onClose: () => void;
  onPrint: (stock: InternalLabelStock, quantities: number[], allowExistingStock: boolean) => Promise<void>;
};

const getQuantity = (value: string) => {
  try { return parseLabelCorrectionQuantity(value); }
  catch { return 0; }
};

export function InternalLabelForm({ styles, overlayPadding, modalHeight, onClose, onPrint }: Props) {
  const { fontScale } = useWindowDimensions();
  const [accountKey, setAccountKey] = useState<ErpAccountKey>(
    (ERP_ACCOUNTS.find(isErpAccountAvailable) ?? ERP_ACCOUNTS[0]).key,
  );
  const [inventoryCode, setInventoryCode] = useState('');
  const [scannerReady, setScannerReady] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const [stock, setStock] = useState<InternalLabelStock | null>(null);
  const [byPackage, setByPackage] = useState(false);
  const [packages, setPackages] = useState([{ id: 1, quantity: '' }]);
  const [querying, setQuerying] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [existing, setExisting] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState<number>();
  const mountedRef = useRef(true);
  const queryingRef = useRef(false);
  const printingRef = useRef(false);
  const rowIdRef = useRef(1);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const quantities = byPackage ? packages.map((item) => getQuantity(item.quantity)) : [stock?.quantity ?? 0];
  const allocated = quantities.reduce((total, quantity) => total + quantity, 0);
  const stockValid = Number.isSafeInteger(stock?.quantity) && (stock?.quantity ?? 0) > 0;
  const canPrint = stockValid && quantities.every((quantity) => quantity > 0) && allocated === stock?.quantity;
  const busy = querying || printing;
  // Give the longer explicit override a full row instead of shrinking its label.
  const stackFooterActions = existing || fontScale > 1.15;
  const footerActionStyle = [styles.correctionAction, stackFooterActions && styles.stackedCorrectionAction];

  function selectStock(value: InternalLabelStock | null) {
    setStock(value);
    setByPackage(false);
    setPackages([{ id: ++rowIdRef.current, quantity: '' }]);
    setExisting(false);
    setError('');
  }

  function clearQuery() {
    selectStock(null);
  }

  async function query(code: string) {
    const requestedCode = code.trim();
    if (!scannerReady || !requestedCode || queryingRef.current || printingRef.current) return;
    queryingRef.current = true;
    setQuerying(true);
    setManualEntry(false);
    setInventoryCode(requestedCode);
    clearQuery();
    Keyboard.dismiss();
    try {
      const result = await queryInternalLabelStock(accountKey, requestedCode);
      if (!mountedRef.current) return;
      if (result.length > 1) throw new Error('ERP 主仓现存量不唯一，无法确认建标数量');
      if (result.length === 1) selectStock(result[0]);
      if (result.length === 0) setError('该存货编码没有可用的主仓现存量记录');
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : '查询 ERP 现存量失败');
    } finally {
      queryingRef.current = false;
      if (mountedRef.current) setQuerying(false);
    }
  }

  async function print() {
    if (!stock || !canPrint || queryingRef.current || printingRef.current) return;
    printingRef.current = true;
    setPrinting(true);
    setError('');
    try {
      if (!existing && await findExistingInternalLabelPackage(stock)) {
        if (mountedRef.current) setExisting(true);
        return;
      }
      if (mountedRef.current) await onPrint(stock, quantities, existing);
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : '内部标签建标失败');
    } finally {
      printingRef.current = false;
      if (mountedRef.current) setPrinting(false);
    }
  }

  const close = () => {
    if (!printingRef.current) {
      Keyboard.dismiss();
      onClose();
    }
  };

  return (
    <AppModal transparent visible animationType="fade" onShow={() => setScannerReady(true)} onRequestClose={close}>
      <View testID="internal-label-overlay" style={[styles.modalOverlay, overlayPadding]}>
        <View style={styles.modalViewport} testID="internal-label-viewport" onLayout={({ nativeEvent }) => {
          if (nativeEvent.layout.height > 0) setViewportHeight(nativeEvent.layout.height);
        }}>
          <AppModalCard title="新建内部标签" size="list" stretchBody scrollMode="body" bodyStyle={styles.modalBody}
            bodyContentHeight={contentHeight} style={{ maxHeight: Math.min(modalHeight, viewportHeight || modalHeight) }}
            onClose={printing ? undefined : close}
            footer={<View style={[styles.correctionActions, stackFooterActions && styles.stackedCorrectionActions]}>
              <UiToolbarButton label="取消" disabled={printing} onPress={close}
                containerStyle={footerActionStyle} style={styles.boundedAction} />
              <UiToolbarButton label={existing ? '确认另建并打印' : '确认打印'} icon="printer" primary loading={printing}
                disabled={busy || !canPrint} onPress={() => { void print(); }}
                containerStyle={footerActionStyle} style={styles.boundedAction} />
            </View>}>
            <ScrollView style={styles.taskScroll} contentContainerStyle={styles.correctionContent}
              onContentSizeChange={(_width, height) => setContentHeight(height)}
              testID="internal-label-form" keyboardShouldPersistTaps="handled" scrollEnabled
              showsVerticalScrollIndicator keyboardDismissMode="on-drag">
              <Text style={styles.formLabel}>ERP 账套</Text>
              <View style={styles.correctionActions}>
                {ERP_ACCOUNTS.map((account) => (
                  <UiToolbarButton key={account.key} label={account.name} compact primary={accountKey === account.key}
                    disabled={busy || !isErpAccountAvailable(account)} containerStyle={styles.correctionAction}
                    style={styles.boundedAction} onPress={() => {
                      if (account.key === accountKey || queryingRef.current || printingRef.current) return;
                      setAccountKey(account.key);
                      clearQuery();
                    }} />
                ))}
              </View>
              <Text style={styles.formLabel}>存货编码</Text>
              {/* Remount on touch to open the keyboard even if the hardware scanner already owns focus. */}
              <WarehouseScanInput key={manualEntry ? 'manual' : 'scan'} value={inventoryCode}
                accessibilityLabel="存货编码" placeholder="扫描或输入存货编码" active focusInModal
                autoFocus={scannerReady && (!byPackage || manualEntry)} editable={scannerReady && !busy}
                showSoftInputOnFocus={manualEntry} selectTextOnFocus autoCapitalize="none" returnKeyType="search"
                containerProps={{ style: styles.internalScanner }}
                actionLabel="查询 ERP 现存量" actionIcon="search" actionLoading={querying}
                actionDisabled={!scannerReady || busy || !inventoryCode.trim()}
                onActionPress={() => { void query(inventoryCode); }}
                onPressIn={() => { if (scannerReady && !busy) setManualEntry(true); }}
                onChangeText={(value) => {
                  if (!scannerReady || queryingRef.current || printingRef.current) return;
                  setInventoryCode(value);
                  clearQuery();
                }}
                onSubmitEditing={(event) => { void query(event.nativeEvent.text); }} />
              {stock ? <>
                <View style={styles.card}>
                  <Text style={styles.detail}>实际仓库：{stock.warehouseName}</Text>
                  <Text style={styles.detail}>存货名称：{stock.inventoryName || '—'}</Text>
                  <Text style={styles.detail}>规格型号：{stock.specification || '—'}</Text>
                  <Text style={styles.model}>ERP 现存量：{Number.isFinite(stock.quantity) ? stock.quantity : '—'}</Text>
                </View>
                {stockValid ? <>
                  <View style={styles.correctionActions}>
                    <UiToolbarButton label="整包建标" compact primary={!byPackage} disabled={printing}
                      containerStyle={styles.correctionAction} style={styles.boundedAction}
                      onPress={() => { setByPackage(false); setExisting(false); setError(''); }} />
                    <UiToolbarButton label="按包分配" compact primary={byPackage} disabled={printing}
                      containerStyle={styles.correctionAction} style={styles.boundedAction}
                      onPress={() => { setByPackage(true); setExisting(false); setError(''); }} />
                  </View>
                  {byPackage ? <>
                    {packages.map((item, index) => (
                      <View key={item.id} style={styles.packageRow}>
                        <UiInput value={item.quantity} placeholder={`第 ${index + 1} 包数量`}
                          accessibilityLabel={`第 ${index + 1} 包数量`} keyboardType="number-pad" editable={!printing}
                          containerStyle={styles.packageQuantity}
                          onFocus={() => setManualEntry(false)}
                          onChangeText={(quantity) => {
                            setPackages((current) => current.map((row) => row.id === item.id ? { ...row, quantity } : row));
                            setExisting(false);
                            setError('');
                          }} />
                        {packages.length > 1 ? <UiToolbarButton label="移除" compact disabled={printing}
                          containerStyle={styles.packageRemoveContainer} style={styles.packageRemove}
                          onPress={() => { setPackages((current) => current.filter((row) => row.id !== item.id)); setExisting(false); }} /> : null}
                      </View>
                    ))}
                    <UiToolbarButton label="添加一包" icon="plus" compact disabled={printing}
                      onPress={() => { setPackages((current) => [...current, { id: ++rowIdRef.current, quantity: '' }]); setExisting(false); }} />
                    <Text accessibilityLiveRegion="polite" style={styles.detail}>
                      本次分配：{allocated} · {allocated > stock.quantity ? `超出 ${allocated - stock.quantity}` : `待分配 ${stock.quantity - allocated}`}
                    </Text>
                    {quantities.some((quantity, index) => quantity === 0 && packages[index].quantity.trim())
                      ? <Text style={styles.correctionError}>每包数量须为大于 0 的整数</Text> : null}
                  </> : <Text style={styles.detail}>请确认这些库存都在同一个实物包内。</Text>}
                  {canPrint ? <Text style={styles.detail}>本次建标 {quantities.length} 包，共打印 {quantities.length} 张</Text> : null}
                </> : <Text style={styles.correctionError}>该仓库的 ERP 现存量须为大于 0 的整数才能建标。</Text>}
              </> : null}
              {existing ? <Text accessibilityLiveRegion="polite" style={styles.correctionError}>
                此仓库同编码已有内部标签。原包装请补打，确认是不同实物包装后再另建。
              </Text> : null}
              {error ? <Text accessibilityLiveRegion="polite" style={styles.correctionError}>{error}</Text> : null}
            </ScrollView>
          </AppModalCard>
        </View>
      </View>
    </AppModal>
  );
}
