import TestRenderer, { act } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import { SyncPairingCamera } from '../SyncPairingCamera';
const mockRequest = jest.fn(async () => undefined);
let mockPermission = { granted: false, canAskAgain: true };
jest.mock('expo-camera', () => ({ CameraView: 'CameraView', useCameraPermissions: () => [mockPermission, mockRequest] }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: {} }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
// Native View.measure is a no-op in the RN Jest preset. Use a host view so the
// readiness test can supply the actual asynchronous measurement boundary.
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  View: { value: 'View' },
}));
let root: TestRenderer.ReactTestRenderer;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); jest.clearAllMocks(); });
afterEach(async () => { await act(async () => { root?.unmount(); }); });
it('asks for camera access only when the user taps Allow', async () => {
  mockPermission = { granted: false, canAskAgain: true };
  await act(async () => { root = TestRenderer.create(<SyncPairingCamera onScan={jest.fn()} onClose={jest.fn()} onError={jest.fn()} />); });
  expect(mockRequest).not.toHaveBeenCalled();
  await act(async () => { root.root.findAllByType(TouchableOpacity)[1].props.onPress(); });
  expect(mockRequest).toHaveBeenCalledTimes(1);
});
it('scans only QR and consumes a camera frame once', async () => {
  mockPermission = { granted: true, canAskAgain: true };
  const scan = jest.fn();
  await act(async () => { root = TestRenderer.create(<SyncPairingCamera onScan={scan} onClose={jest.fn()} onError={jest.fn()} />); });
  const camera = root.root.findByType('CameraView');
  // The guide must exist even when Web hasn't sent a preview layout event.
  expect(root.root.findByProps({ testID: 'sync-camera-guide-overlay' }).props.pointerEvents).toBe('none');
  expect(camera.props.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });
  const inside = { data: 'code', type: 'qr', cornerPoints: [{ x: 100, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 250 }, { x: 100, y: 250 }] };
  await act(async () => { camera.props.onBarcodeScanned(inside); });
  expect(scan).not.toHaveBeenCalled();
  await act(async () => { root.root.findByProps({ testID: 'sync-camera-preview' }).props.onLayout({ nativeEvent: { layout: { width: 302, height: 402 } } }); });
  await act(async () => {
    camera.props.onBarcodeScanned({ ...inside, cornerPoints: inside.cornerPoints.map(p => ({ x: p.x - 100, y: p.y })) });
    camera.props.onBarcodeScanned({ data: 'missing-location', type: 'qr' });
  });
  expect(scan).not.toHaveBeenCalled();
  await act(async () => { camera.props.onBarcodeScanned(inside); camera.props.onBarcodeScanned(inside); });
  expect(scan).toHaveBeenCalledTimes(1);
});

it('measures the preview when the camera is ready even without an onLayout event', async () => {
  mockPermission = { granted: true, canAskAgain: true };
  const scan = jest.fn();
  const measure = jest.fn((callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 0, 302, 402));
  await act(async () => {
    root = TestRenderer.create(<SyncPairingCamera onScan={scan} onClose={jest.fn()} onError={jest.fn()} />, {
      createNodeMock: element => element.props.testID === 'sync-camera-preview' ? { measure } : null,
    });
  });
  const camera = root.root.findByType('CameraView');
  await act(async () => { camera.props.onCameraReady(); });
  expect(measure).toHaveBeenCalled();
  await act(async () => {
    camera.props.onBarcodeScanned({ type: 'qr', data: 'outside', cornerPoints: [
      { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 },
    ] });
  });
  expect(scan).not.toHaveBeenCalled();
  await act(async () => {
    camera.props.onBarcodeScanned({ type: 'qr', data: 'inside', cornerPoints: [
      { x: 100, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 250 }, { x: 100, y: 250 },
    ] });
  });
  expect(scan).toHaveBeenCalledWith('inside');
});
