import TestRenderer, { act } from 'react-test-renderer';
import { Dimensions, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModalCard } from '@/components/AppModalCard';
import { AppModalActions } from '@/components/AppModalActions';
import { Colors } from '@/constants/theme';
import { createStyles } from '../styles';
import { ApkUpdateDialog, DraftArchiveDialog } from '../SettingsDialogs';
import type { IsolatedWorkDraft } from '@/utils/workDraftIsolation';

jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light }) }));
jest.mock('@/components/AppMotion', () => ({ MotionSurface: 'ModalSurface', MotionChevron: 'Chevron' }));
jest.mock('@/components/AppModalHeader', () => ({ AppModalHeader: 'ModalHeader' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/UiRedesign', () => ({ UiListItem: 'ListItem' }));

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
let root: TestRenderer.ReactTestRenderer | undefined;
const archives: IsolatedWorkDraft[] = Array.from({ length: 12 }, (_, index) => ({
  id: `copy-${index}`, createdAt: `2026-11-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
  databaseFileName: `副本-${index}.db`, state: 'isolated', entries: [['key', 'value']], lateEntries: [],
}));

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

it.each([
  { width: 320, height: 480, fontScale: 1.3 },
  { width: 768, height: 1024, fontScale: 1 },
])('keeps long APK update contents in one bounded scrolling body at $width dp', async dimensions => {
  const viewport = { ...dimensions, scale: 1 };
  Dimensions.set({ window: viewport, screen: viewport });
  const styles = createStyles(Colors.light, dimensions.width, dimensions.height);
  const info = { version: '1.2.3', changelog: `${'这是一条需要滚动查看的更新内容。\n'.repeat(40)}更新内容最后一行` };
  const download = jest.fn(); const close = jest.fn();
  const dialog = (downloading = false) => <ApkUpdateDialog styles={styles} downloading={downloading}
    info={info} progress={36} onClose={close} onDownload={download} />;
  await act(async () => { root = TestRenderer.create(dialog()); });
  const scroll = root!.root.findByType(ScrollView);
  expect(root!.root.findAllByType(ScrollView)).toHaveLength(1);
  expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
  expect(StyleSheet.flatten(scroll.props.style).maxHeight).toBeUndefined();
  expect(root!.root.findByType(AppModalCard).props.scrollMode).toBe('body');
  expect(root!.root.findAllByType(Text).some(node => node.props.children === info.changelog)).toBe(true);
  const footer = root!.root.findByType(AppModalActions);
  expect(scroll.findAllByType(AppModalActions)).toHaveLength(0);
  await act(async () => { footer.props.onPrimaryPress(); });
  expect(download).toHaveBeenCalledTimes(1);
  await act(async () => { footer.props.onSecondaryPress(); });
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => { root!.update(dialog(true)); });
  expect(root!.root.findByType(ScrollView)).toBe(scroll);
  expect(root!.root.findByType(AppModalCard).props.onClose).toBeUndefined();
  expect(root!.root.findAllByType(AppModalActions)).toHaveLength(0);
  expect(root!.root.findAllByType(Text).some(node => String(node.props.children).includes('36'))).toBe(true);
});

it.each([
  { width: 320, height: 480, fontScale: 1.3 },
  { width: 768, height: 1024, fontScale: 1 },
])('gives restore copies a single bounded list at $width dp', async dimensions => {
  const viewport = { ...dimensions, scale: 1 };
  Dimensions.set({ window: viewport, screen: viewport });
  const styles = createStyles(Colors.light, dimensions.width, dimensions.height);
  const select = jest.fn(); const restore = jest.fn(); const close = jest.fn();
  const dialog = (selectedId: string | null = null, restoring = false) => <DraftArchiveDialog styles={styles} archives={archives}
    selectedId={selectedId} restoring={restoring} onSelect={select} onRestore={restore} onClose={close} />;
  await act(async () => { root = TestRenderer.create(dialog()); });
  const list = root!.root.findByType(FlatList);
  expect(list.props.data).toHaveLength(12);
  expect(list.props).toMatchObject({ scrollEnabled: true, showsVerticalScrollIndicator: true });
  expect(StyleSheet.flatten(list.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
  let ancestor = list.parent;
  while (ancestor) { expect(ancestor.type).not.toBe(ScrollView); ancestor = ancestor.parent; }
  expect(root!.root.findByType(AppModalCard).props.scrollMode).toBe('body');
  const frame = root!.root.findByProps({ testID: 'app-modal-card-body-frame' });
  expect(StyleSheet.flatten(frame.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
  const footer = () => root!.root.findByType(AppModalCard).props.footer as React.ReactElement<React.ComponentProps<typeof AppModalActions>>;
  expect(footer().props.primaryDisabled).toBe(true);
  const last = list.props.renderItem({ item: archives[11], index: 11, separators: {} });
  await act(async () => { last.props.onPress(); });
  expect(select).toHaveBeenCalledWith(archives[11].id);
  await act(async () => { root!.update(dialog(archives[11].id)); });
  expect(footer().props.primaryDisabled).toBe(false);
  await act(async () => { footer().props.onPrimaryPress(); });
  expect(restore).toHaveBeenCalledTimes(1);
  await act(async () => { root!.update(dialog(archives[11].id, true)); });
  const blocked = root!.root.findByType(FlatList).props.renderItem({ item: archives[0], index: 0, separators: {} });
  await act(async () => { blocked.props.onPress(); });
  expect(select).toHaveBeenCalledTimes(1);
  expect(footer().props).toMatchObject({ primaryDisabled: true, secondaryDisabled: true });
  expect(root!.root.findByType(AppModalCard).props.onClose).toBeUndefined();
  expect(root!.root.findAllByType(View).some(node => node.props.testID === 'app-modal-viewport')).toBe(true);
});

it('fits short APK notes and one restore copy to their measured contents while bounding longer lists', async () => {
  const styles = createStyles(Colors.light, 360, 640);
  await act(async () => {
    root = TestRenderer.create(<ApkUpdateDialog styles={styles} downloading={false}
      info={{ version: '1.2.3', changelog: '优化打印' }} progress={0} onClose={jest.fn()} onDownload={jest.fn()} />);
  });
  const card = () => root!.root.findByType(AppModalCard);
  const surface = () => root!.root.findByType('ModalSurface' as React.ElementType);
  await act(async () => {
    root!.root.findByType(ScrollView).props.onContentSizeChange(280, 94);
    root!.root.findByProps({ testID: 'app-modal-card-header' }).props.onLayout({ nativeEvent: { layout: { height: 80 } } });
    root!.root.findByProps({ testID: 'app-modal-card-footer' }).props.onLayout({ nativeEvent: { layout: { height: 64 } } });
  });
  expect(card().props).toMatchObject({ size: 'list', bodyContentHeight: 94, scrollMode: 'body' });
  expect(StyleSheet.flatten(surface().props.style).height).toBeLessThan(300);
  await act(async () => {
    root!.update(<DraftArchiveDialog styles={styles} archives={archives.slice(0, 1)} selectedId={null}
      restoring={false} onClose={jest.fn()} onSelect={jest.fn()} onRestore={jest.fn()} />);
  });
  const list = root!.root.findByType(FlatList);
  await act(async () => { list.props.onContentSizeChange(280, 72); });
  expect(card().props).toMatchObject({ size: 'list', bodyContentHeight: 72, scrollMode: 'body' });
  let ancestor = list.parent;
  while (ancestor) { expect(ancestor.type).not.toBe(ScrollView); ancestor = ancestor.parent; }
  await act(async () => { list.props.onContentSizeChange(280, 1400); });
  const size = StyleSheet.flatten(surface().props.style);
  expect(size.height).toBeLessThanOrEqual(size.maxHeight);
});
