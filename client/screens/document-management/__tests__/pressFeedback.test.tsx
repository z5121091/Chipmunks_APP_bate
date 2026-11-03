import TestRenderer, { act } from 'react-test-renderer';
import { Animated, TouchableOpacity } from 'react-native';
import { AnimatedCard } from '@/components/AnimatedCard';
import { AppPressable } from '@/components/AppPressable';
import DocumentManagementScreen from '@/screens/document-management';

const mockPush = jest.fn();
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light, isDark: false }) }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/CustomAlert', () => ({ useCustomAlert: () => ({ showAlert: jest.fn(), AlertComponent: null }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));

it('keeps all three document entry cards static during a hold and routes on release', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const timing = jest.spyOn(Animated, 'timing');
  let root: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => { root = TestRenderer.create(<DocumentManagementScreen />); });
    const cards = root!.root.findAllByType(AnimatedCard);
    expect(cards).toHaveLength(3);
    expect(cards.every(card => card.props.disablePressAnimation)).toBe(true);
    expect(root!.root.findAllByType(TouchableOpacity)).toHaveLength(0);
    const routes = ['/orders', '/inbound-records', '/inventory-records'];
    for (const [index, card] of cards.entries()) {
      const control = card.findByType(AppPressable);
      expect(control.props.feedback).toBe('none');
      const target = control.findAll(node => node.props.onPress === control.props.onPress).at(-1)!;
      mockPush.mockClear();
      await act(async () => { target.props.onPressIn?.({}); });
      expect(mockPush).not.toHaveBeenCalled();
      await act(async () => { target.props.onPressOut?.({}); target.props.onPress(); });
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(routes[index]);
    }
    expect(timing).not.toHaveBeenCalled();
  } finally {
    if (root) await act(async () => root!.unmount());
    timing.mockRestore();
  }
});
