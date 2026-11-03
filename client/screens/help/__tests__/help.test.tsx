import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { AppPressable } from '@/components/AppPressable';
import HelpScreen from '../index';
import { HELP_QUICK_STARTS, HELP_TOPICS, searchHelp } from '../content';
import { UiInput, UiPageHeader } from '@/components/UiRedesign';

const mockBack = jest.fn();
let mockHardwareBack: () => boolean;
jest.mock('@/hooks/useHardwareBack', () => ({
  useHardwareBack: (handler: () => boolean) => {
    mockHardwareBack = handler;
  },
}));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ back: mockBack }) }));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: require('@/constants/theme').Colors.light, isDark: false }),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/UiAssetIcon', () => ({ UiAssetIcon: 'AssetIcon' }));
jest.mock('@/components/AppPressable', () => ({ AppPressable: 'HelpPressable' }));

let root: TestRenderer.ReactTestRenderer;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mockBack.mockClear();
  await act(async () => {
    root = TestRenderer.create(<HelpScreen />);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
});

const textVisible = (value: string) =>
  root.root.findAllByType(Text).some((node) => node.props.children === value);
const button = (label: string) =>
  root.root.findAllByType(AppPressable).find((node) => node.props.accessibilityLabel === label)!;
const titleButton = (title: string) =>
  root.root
    .findAllByType(AppPressable)
    .find((node) => node.findAllByType(Text).some((text) => text.props.children === title))!;
const search = async (query: string) => {
  await act(async () => root.root.findByType(UiInput).props.onChangeText(query));
};
const back = async () => {
  await act(async () => root.root.findByType(UiPageHeader).props.onBack());
};

it('opens a quick task directly and returns to the help directory before exiting', async () => {
  await act(async () => titleButton('改标签数量').props.onPress());
  expect(root.root.findByType(UiPageHeader).props.title).toBe('标签补打与改数量');
  expect(button('旧标签数量不对，怎样改数量再打印？').props.accessibilityState.expanded).toBe(true);
  expect(textVisible('输入正确数量：必须是大于 0 的整数，可以大于原数量。')).toBe(true);
  await back();
  expect(textVisible('你现在想做什么？')).toBe(true);
  expect(mockBack).not.toHaveBeenCalled();
  await back();
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('finds partial-inbound instructions globally even while a category is filtered', async () => {
  await act(async () => button('遇到问题').props.onPress());
  await search('没扫完');
  expect(textVisible('有物料无法扫码，能先保存吗？')).toBe(true);
  await act(async () => button('有物料无法扫码，能先保存吗？').props.onPress());
  expect(textVisible('确认未完成提醒，保存已扫记录；记录会标记为“部分入库”。')).toBe(true);
  await act(async () => {
    expect(mockHardwareBack()).toBe(true);
  });
  expect(textVisible('你现在想做什么？')).toBe(true);
  expect(button('遇到问题').props.accessibilityState.selected).toBe(true);
  expect(mockBack).not.toHaveBeenCalled();
});

it('shows a recoverable empty search and clears results without stale details', async () => {
  await search('不存在的说明xyz987');
  expect(textVisible('没有找到相关说明')).toBe(true);
  await act(async () => button('清空搜索').props.onPress());
  expect(textVisible('你现在想做什么？')).toBe(true);
  expect(textVisible('没有找到相关说明')).toBe(false);
  await search('SF OS');
  expect(textVisible('型号以 SF 或 OS 开头，怎样配置？')).toBe(true);
});

it('allows repeated immediate expansion and collapses without animation locks', async () => {
  await act(async () => titleButton('我要入库').props.onPress());
  const label = '有物料无法扫码，能先保存吗？';
  for (let i = 0; i < 12; i++) {
    await act(async () => button(label).props.onPress());
    expect(button(label).props.accessibilityState.expanded).toBe(i % 2 === 0);
    expect(textVisible('确认未完成提醒，保存已扫记录；记录会标记为“部分入库”。')).toBe(i % 2 === 0);
  }
  await act(async () => {
    expect(mockHardwareBack()).toBe(true);
  });
  expect(textVisible('你现在想做什么？')).toBe(true);
  expect(mockHardwareBack()).toBe(false);
});

it('keeps every shortcut valid and articles searchable by operational aliases', () => {
  const ids = HELP_TOPICS.flatMap((topic) => topic.articles.map((article) => article.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (const quick of HELP_QUICK_STARTS) {
    expect(
      HELP_TOPICS.find((topic) => topic.id === quick.topicId)?.articles.some(
        (article) => article.id === quick.articleId
      )
    ).toBe(true);
  }
  expect(searchHelp('   ')).toEqual([]);
  expect(searchHelp('  sf   OS ').some((result) => result.article.id === 'rules-condition')).toBe(
    true
  );
  expect(searchHelp('恢复副本').some((result) => result.article.id === 'backup-restore')).toBe(
    true
  );
  expect(searchHelp('密钥').some((result) => result.article.id === 'sync-key')).toBe(true);
  expect(searchHelp('热更新').some((result) => result.article.id === 'updates-apply')).toBe(true);
});
