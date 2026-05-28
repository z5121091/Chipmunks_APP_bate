
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Screen } from '@/components/Screen';
import { createStyles } from './styles';
import { Spacing } from '@/constants/theme';

interface HelpItem {
  id: string;
  title: string;
  description: string;
  tip?: string;
}

interface HelpModule {
  id: string;
  title: string;
  icon: 'home' | 'log-in' | 'truck' | 'check-square' | 'git-merge' | 'tool' | 'file-text';
  items: HelpItem[];
}

const HELP_DATA: HelpModule[] = [
  {
    id: '1',
    title: '首页与入口',
    icon: 'home',
    items: [
      {
        id: '1.1',
        title: '首页布局',
        description:
          '首页以仓库高频作业为核心，优先展示扫码入库、扫码出库和库存盘点；单据管理、物料绑定和系统设置作为管理类入口放在同一层级，减少现场作业时误点。',
      },
      {
        id: '1.2',
        title: '单据管理',
        description:
          '单据管理统一管理出库订单、入库记录和盘点记录。出库订单用于查看订单物料、编辑客户名称、编辑数量和拆包；入库记录、盘点记录用于核对和删除已保存的历史单据。',
      },
      {
        id: '1.3',
        title: '首次仓库引导',
        description:
          '首次使用时可创建仓库；如果选择跳过，系统会创建默认仓库，后续可在仓库档案里修改名称或新增更多仓库。',
      },
    ],
  },
  {
    id: '2',
    title: '扫码入库',
    icon: 'log-in',
    items: [
      {
        id: '2.1',
        title: '选择仓库',
        description:
          '进入扫码入库后先确认仓库。不同仓库的数据相互隔离，切换仓库前建议先确认当前页面是否还有未保存的扫码记录。',
      },
      {
        id: '2.2',
        title: '连续扫码',
        description:
          '使用 PDA 扫描物料二维码后，系统会按解析规则提取型号、批次、数量、生产日期、追溯码等信息。同型号、同版本会自动聚合显示，展开后可查看每一条明细。',
        tip: '一维码或无效内容会被尽量静默忽略，避免现场误扫时频繁打断操作。',
      },
      {
        id: '2.3',
        title: '存货编码回填',
        description:
          '如果物料绑定里维护了型号与存货编码的关系，扫码入库会自动带出存货编码。后续补录绑定后，也会在导出和同步时尽量按型号回填历史数据。',
      },
      {
        id: '2.4',
        title: '删除与保存',
        description:
          '聚合项用于查看，不建议直接删除；需要删除时展开聚合项，长按具体明细删除。确认入库后，当前扫码数据会保存为入库记录，并可按本次数据同步入库单到电脑。',
      },
      {
        id: '2.5',
        title: '入库记录',
        description:
          '入库记录按入库单分组，支持仓库切换、展开查看型号聚合和明细，也支持删除错误明细或整张入库单。',
      },
    ],
  },
  {
    id: '3',
    title: '扫码出库',
    icon: 'truck',
    items: [
      {
        id: '3.1',
        title: '三步扫码',
        description:
          '扫码出库按“订单号、客户名称、物料二维码”三步执行。扫到订单号后会进入当前订单，扫到客户名称后自动写入订单，再连续扫描物料完成出库。',
      },
      {
        id: '3.2',
        title: '扫错订单处理',
        description:
          '如果刚扫完订单号发现扫错，可以继续扫描新的订单号，系统会切换到新的当前订单，不需要先去订单管理删除旧订单。',
      },
      {
        id: '3.3',
        title: '客户名称校验',
        description:
          '客户名称步骤会校验内容是否像中文客户名，避免把相邻的订单号二维码误扫成客户名称。识别成功后会有语音和震动反馈。',
      },
      {
        id: '3.4',
        title: '重复判断',
        description:
          '出库重复判断以追溯码为主。箱号、版本号等字段允许重复，避免因为包装字段相同而误判无法出库。',
      },
      {
        id: '3.5',
        title: '订单管理',
        description:
          '出库订单保留当前订单、当天订单和全部订单视图。当前订单直接展示本单物料；当天和全部订单以折叠方式查看，展开后物料按最新扫码在前排列。',
      },
    ],
  },
  {
    id: '4',
    title: '订单拆包',
    icon: 'file-text',
    items: [
      {
        id: '4.1',
        title: '拆包用途',
        description:
          '拆包用于整包物料只发出部分数量的场景。输入发货数量后，系统生成发货标签和剩余标签，便于后续追溯和打印。',
      },
      {
        id: '4.2',
        title: '拆包入口',
        description:
          '拆包入口在订单管理中。进入订单后选择需要拆包的物料，只保留型号、批次和数量等核心信息，减少小屏手机上的干扰。',
      },
      {
        id: '4.3',
        title: '拆错后的处理',
        description:
          '如果拆包数量填错，建议删除对应拆包结果后重新拆包，不建议直接修改历史数量。这样可以保持追溯链路清晰，避免已同步文件和已打印标签出现口径不一致。',
      },
      {
        id: '4.4',
        title: '拆包同步',
        description:
          '订单管理内的拆包同步只同步本次拆包产生的标签数据；系统设置里的标签同步则用于同步全部历史标签记录。',
      },
    ],
  },
  {
    id: '5',
    title: '库存盘点',
    icon: 'check-square',
    items: [
      {
        id: '5.1',
        title: '整包盘点',
        description:
          '整包盘点适合包装完整、数量无需修改的物料。扫码后按型号和版本聚合，确认盘点后保存本次实盘数据。',
      },
      {
        id: '5.2',
        title: '拆包盘点',
        description:
          '拆包盘点适合包装已打开或实际数量需要修正的物料。扫码后输入实盘数量，系统会生成盘点替换标签。',
      },
      {
        id: '5.3',
        title: '模式切换',
        description:
          '整包和拆包可以按需要切换。切换时系统会保留已暂存的数据，确认盘点时合并保存，避免切换页面造成数据丢失。',
      },
      {
        id: '5.4',
        title: '盘点记录',
        description:
          '盘点记录按盘点单分组，展开后按型号和版本聚合，并兼容整包、拆包混合显示。明细中可查看批次、存货编码、生产日期和实盘数量。',
      },
      {
        id: '5.5',
        title: '盘点导出',
        description:
          '盘点页面确认盘点后的同步只导出本次实时盘点数据；系统设置里的盘点同步用于导出历史累计盘点数据。两套逻辑互不影响。',
      },
    ],
  },
  {
    id: '6',
    title: '物料绑定',
    icon: 'git-merge',
    items: [
      {
        id: '6.1',
        title: '绑定作用',
        description:
          '物料绑定用于维护扫描型号与存货编码的关系。入库、出库、盘点和标签同步都会优先按型号匹配存货编码。',
      },
      {
        id: '6.2',
        title: '新增与导入',
        description:
          '可手动新增绑定，也可导出模板后批量导入。导入前建议保持模板表头不变，避免字段错位。',
      },
      {
        id: '6.3',
        title: '后补编码',
        description:
          '如果先扫码、后补录存货编码，系统在后续导出或同步时会按型号回填历史记录中的存货编码，减少重复建单。',
      },
    ],
  },
  {
    id: '7',
    title: '解析配置',
    icon: 'tool',
    items: [
      {
        id: '7.1',
        title: '解析规则',
        description:
          '解析规则决定二维码如何拆分字段。需要配置分隔符、字段顺序和启用状态，字段顺序必须与二维码内容顺序一致。',
      },
      {
        id: '7.2',
        title: '匹配条件',
        description:
          '当供应商二维码格式较多时，可给规则设置匹配条件。系统会优先使用匹配条件更明确的规则，减少误识别。',
      },
      {
        id: '7.3',
        title: '字段前缀',
        description:
          '如果二维码字段包含 PART NO.:、QTY: 等固定文字，可在字段前缀中配置去除。解析时系统会自动剥离前缀，只保留真实值。',
      },
      {
        id: '7.4',
        title: '自定义字段',
        description:
          '自定义字段用于兼容特殊供应商格式。当前以文本字段为主，主要服务于解析规则，不默认加入 Excel 导出，避免表格列过多。',
      },
    ],
  },
  {
    id: '8',
    title: '同步与备份',
    icon: 'tool',
    items: [
      {
        id: '8.1',
        title: '电脑同步',
        description:
          '手机端填写电脑同步助手的 IP 和端口后，可同步入库单、出库单、盘点单、盘点标签和订单标签。同步成功后会显示生成的文件名。',
      },
      {
        id: '8.2',
        title: '实时同步与历史同步',
        description:
          '扫码页面保存后的同步通常只包含本次实时数据；系统设置里的同步用于导出历史累计数据。现场核对用实时同步，备份和汇总用历史同步。',
      },
      {
        id: '8.3',
        title: '配置备份',
        description:
          '配置备份包含解析规则、自定义字段、物料绑定、仓库和同步服务器配置。文件名会按日期和序号生成，便于多次备份。',
      },
      {
        id: '8.4',
        title: '数据库备份',
        description:
          '数据库备份会导出完整本地数据库，适合换机、重要版本升级前或大量数据维护前使用。恢复数据库后建议重启 APP。',
      },
      {
        id: '8.5',
        title: '版本更新',
        description:
          '检查更新会访问更新服务器，发现新版本后下载 APK。若首次覆盖安装后网络状态不稳定，可稍等片刻再检查。',
      },
    ],
  },
];

export default function HelpScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();

  const renderModule = (module: HelpModule) => {
    return (
      <View key={module.id} style={styles.moduleBlock}>
        <View style={styles.moduleHeader}>
          <View style={styles.moduleIcon}>
            <Feather name={module.icon} size={16} color={theme.primary} />
          </View>
          <Text style={styles.moduleTitle}>
            {module.id}. {module.title}
          </Text>
        </View>

        {module.items.map((item) => (
          <View key={item.id} style={styles.itemContainer}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemNumber}>{item.id}</Text>
              <View style={styles.itemContent}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.itemDescription}>{item.description}</Text>
                {item.tip && (
                  <View style={styles.tipBox}>
                    <Text style={styles.tipText}>{item.tip}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + Spacing.lg,
            paddingBottom: Spacing['5xl'] + insets.bottom,
          },
        ]}
        showsVerticalScrollIndicator
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.7}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>使用说明</Text>
        </View>

        {HELP_DATA.map(renderModule)}
      </ScrollView>
    </Screen>
  );
}
