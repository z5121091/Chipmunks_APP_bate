import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Linking, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { UI_REDESIGN_TOKENS } from '@/constants/uiRedesign';
import { getScanGuideSize, isQrInsideScanGuide } from '@/utils/scanGuide';

export function SyncPairingCamera({ onScan, onClose, onError }: { onScan: (value: string) => void; onClose: () => void; onError: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const consumed = useRef(false);
  const [preview, setPreview] = useState({ width: 0, height: 0 });
  const previewRef = useRef<View>(null);
  const window = useWindowDimensions();
  // Web may not deliver onLayout before the camera starts. Keep the guide visible
  // from the first frame, then refine its size if the preview measurement arrives.
  const previewWidth = preview.width || Math.max(0, window.width - 34);
  const previewHeight = preview.height || Math.max(0, window.height - 160);
  const guideSize = getScanGuideSize(previewWidth, previewHeight);
  const geometry = useRef({ width: 0, height: 0, size: 0 });
  const updatePreview = useCallback((outerWidth: number, outerHeight: number) => {
    const width = outerWidth - 2, height = outerHeight - 2;
    if (width <= 0 || height <= 0) return;
    geometry.current = { width, height, size: getScanGuideSize(width, height) };
    setPreview(previous => previous.width === width && previous.height === height ? previous : { width, height });
  }, []);
  const measurePreview = useCallback(() => previewRef.current?.measure((_x, _y, width, height) => updatePreview(width, height)), [updatePreview]);
  useEffect(() => {
    geometry.current = { width: 0, height: 0, size: 0 };
    const frame = requestAnimationFrame(measurePreview);
    return () => cancelAnimationFrame(frame);
  }, [window.width, window.height, permission?.granted, measurePreview]);
  const { theme } = useTheme();
  return <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭相机" onPress={onClose} style={styles.close}>
      <Feather name="arrow-left" size={22} color={theme.textPrimary} /><Text style={{ color: theme.textPrimary }}>扫描电脑连接二维码</Text>
    </TouchableOpacity>
    {permission?.granted ? <View ref={previewRef} testID="sync-camera-preview" style={[styles.preview, { borderColor: theme.border }]}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        updatePreview(width, height);
      }}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onMountError={onError}
      onCameraReady={measurePreview}
      onBarcodeScanned={result => {
        if (consumed.current) return;
        const { width, height, size } = geometry.current;
        if (!isQrInsideScanGuide(result, width, height, size)) return;
        consumed.current = true;
        onScan(result.data);
      }} />
      {guideSize > 0 && <View pointerEvents="none" testID="sync-camera-guide-overlay" style={[StyleSheet.absoluteFill, styles.overlay]}>
        <View style={styles.mask} />
        <View style={[styles.guideRow, { height: guideSize }]}>
          <View style={styles.mask} />
          <View style={[styles.guide, { width: guideSize, height: guideSize }]}>
            <View style={[styles.corner, styles.topLeft]} /><View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} /><View style={[styles.corner, styles.bottomRight]} />
          </View>
          <View style={styles.mask} />
        </View>
        <View style={styles.mask} />
      </View>}
    </View> : <View style={styles.permission}>
        <Text style={{ color: theme.textPrimary }}>使用摄像头扫描连接码需要相机权限，也可以返回使用 PDA 扫描头。</Text>
        <TouchableOpacity accessibilityRole="button" style={[styles.button, { backgroundColor: theme.primary }]}
          onPress={() => { void (permission?.canAskAgain === false ? Linking.openSettings() : requestPermission()); }}>
          <Text style={{ color: theme.buttonPrimaryText }}>{permission?.canAskAgain === false ? '打开权限设置' : '允许使用相机'}</Text>
        </TouchableOpacity>
      </View>}
    <Text style={[styles.hint, { color: theme.textSecondary }]}>将电脑端二维码完整放入框内，识别后自动连接</Text>
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1 }, close: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, padding: 12 },
  preview: { flex: 1, marginHorizontal: 16, marginTop: 8, borderWidth: 1, borderRadius: UI_REDESIGN_TOKENS.radius.control, overflow: 'hidden', backgroundColor: '#000000' },
  overlay: { zIndex: 2 },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)' }, guideRow: { flexDirection: 'row' },
  guide: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  corner: { position: 'absolute', width: 26, height: 26, borderColor: '#FFFFFF' },
  topLeft: { top: -1, left: -1, borderTopWidth: 3, borderLeftWidth: 3 },
  topRight: { top: -1, right: -1, borderTopWidth: 3, borderRightWidth: 3 },
  bottomLeft: { bottom: -1, left: -1, borderBottomWidth: 3, borderLeftWidth: 3 },
  bottomRight: { bottom: -1, right: -1, borderBottomWidth: 3, borderRightWidth: 3 },
  permission: { flex: 1, justifyContent: 'center', padding: 24, gap: 20 },
  button: { minHeight: 48, padding: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  hint: { padding: 16, textAlign: 'center' },
});
