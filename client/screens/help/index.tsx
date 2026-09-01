import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UiAssetIcon, type UiAssetIconName } from '@/components/UiAssetIcon';
import { UiPageHeader } from '@/components/UiRedesign';
import { useTheme } from '@/hooks/useTheme';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Screen } from '@/components/Screen';
import { ModuleColors, Spacing } from '@/constants/theme';
import { withAlpha } from '@/utils/colors';
import { createStyles } from './styles';

interface HelpItem {
  id: string;
  title: string;
  description?: string;
  steps?: string[];
  tip?: string;
  warning?: string;
}

interface HelpModule {
  id: string;
  title: string;
  summary: string;
  icon: UiAssetIconName;
  items: HelpItem[];
}

const HELP_DATA: HelpModule[] = [
  {
    id: 'start',
    title: '开始使用',
    summary: '首次配置、账套选择、扫码反馈与数据保存',
    icon: 'warehouse',
    items: [
      {
        id: 'start-config',
        title: '首次使用前的准备',
        steps: [
          '在“设置 > 仓库档案”中确认本地仓库名称与 ERP 单据返回的仓库名称一致。',
          '在“设置 > 解析规则”中建立供应商二维码的分隔符和字段顺序；无用的数据段使用占位字段。',
          '在“物料绑定”中维护扫描型号、可选版本号与 ERP 存货编码的对应关系。',
          '在“设置 > ERP 对接”中确认所用账套状态正常；需要电脑同步时，再配置同步助手地址。',
        ],
        warning: '仓库名称、解析规则或物料绑定任一项不正确，都会导致 ERP 单据无法匹配或扫码失败。',
      },
      {
        id: 'start-scan',
        title: '扫码如何提交',
        description:
          '扫描枪输入完成后，页面会自动识别并提交；输入框旁的操作按钮和键盘回车可作为手动兜底。启用扫码提示音后，每次有效扫码都会给出语音反馈。',
        tip: '只有页面出现成功结果并听到成功反馈，才表示本次扫码已被系统接受。错误提示、静默忽略或输入框没有变化都不算成功。',
      },
      {
        id: 'start-save',
        title: '什么时候数据才算保存',
        description:
          '扫码出库每次成功后立即写入本地数据库，不设置“完成出库”按钮。扫码入库和库存盘点会先保存页面草稿，必须点击底部“完成入库”或“完成盘点”后，才生成正式单据。',
      },
      {
        id: 'start-account',
        title: '两个 ERP 账套',
        description:
          '出库按设置中的单号规则自动识别账套；采购入库、库存查询和库存盘点由操作员选择账套。标记为“未开放”的账套不能扫码或查询，也不会消耗 ERP 接口次数。',
      },
    ],
  },
  {
    id: 'outbound',
    title: '扫码出库',
    summary: '销售出库单、物料匹配、自动拆包与订单恢复',
    icon: 'outboundScan',
    items: [
      {
        id: 'outbound-order',
        title: '载入销售出库单',
        steps: [
          '进入首页“扫码出库”，扫描或输入 ERP 销售出库单号。',
          '系统按单号规则选择账套，并从 ERP 读取出库单。',
          '账套、出库单号、客户和仓库会自动带出，无需再扫描客户名称。',
          '确认单据信息后，连续扫描本单物料。',
        ],
        warning: '如果提示本地找不到 ERP 仓库，请先核对仓库档案名称，不要随意新建近似名称。',
      },
      {
        id: 'outbound-match',
        title: '物料如何匹配 ERP',
        description:
          '系统先用解析规则取得型号、版本号、数量和追溯码，再通过物料绑定找到存货编码，最后与 ERP 出库明细比较。ERP 中相同存货编码的多行会合并计算，物料卡会显示“ERP N 行合并”。',
        tip: '型号相同但版本不同的物料，应在物料绑定中分别维护；没有版本号时，可使用该型号的无版本绑定。',
      },
      {
        id: 'outbound-quantity',
        title: '数量与自动拆包',
        description:
          '扫描数量不超过本单剩余数量时，系统直接出库。包装数量大于剩余应出数量时，会打开“拆包出库”确认框：发货数量取本单剩余数量，余料数量为包装数量减去发货数量，并生成对应的发货、余料标签记录。',
        warning: '物料已经完成、存货编码不在本单、数量无效或追溯码重复时，本次扫码不会写入。',
      },
      {
        id: 'outbound-switch',
        title: '恢复、切换与刷新订单',
        description:
          '再次扫描当前单号会恢复本单进度；扫描另一个单号会切换订单，之前已经成功扫码的数据仍保存在本地。需要重新核对 ERP 最新内容时，可使用页面右上角的刷新按钮。',
      },
      {
        id: 'outbound-record',
        title: '查看和修正记录',
        description:
          '在“单据 > 出库订单”中可搜索和查看当前、当天及全部订单。普通扫码记录可按页面提供的操作修改或删除；拆包成对记录应删除后重新扫码拆包，避免发货标签与余料标签数量失去对应关系。',
        warning: '单据管理中的修改和删除只影响本机记录，不会修改 ERP 销售出库单。',
      },
    ],
  },
  {
    id: 'inbound',
    title: '采购入库',
    summary: '未审采购入库单、扫码核对与完成入库',
    icon: 'inboundScan',
    items: [
      {
        id: 'inbound-list',
        title: '选择未审采购入库单',
        steps: [
          '进入首页“采购入库”，先选择已开放的 ERP 账套。',
          '页面显示 ERP 未审核采购入库单；下拉或点击刷新可强制读取最新列表。',
          '也可扫描或输入标准采购入库单号，系统会自动提交查询。',
          '展开目标单据核对供应商和明细，再点击“开始扫码入库”。',
        ],
        tip: '页面会使用短期缓存减少 ERP 请求。需要立刻看到新单、弃审或审核变化时，请主动下拉刷新。',
      },
      {
        id: 'inbound-voucher',
        title: '单据和仓库',
        description:
          '扫码入库必须从未审单据列表进入。入库单号、供应商和仓库由 ERP 单据自动带出，系统会匹配同名本地仓库，不再分配 RK 开头的本地单号。',
      },
      {
        id: 'inbound-scan',
        title: '扫码核对规则',
        description:
          '每次扫描都要依次通过解析规则、物料绑定、ERP 存货编码、剩余应收数量和追溯码重复校验。ERP 中相同存货编码的多行会合并计算；同型号不同版本会在展开明细中分别保留。',
        warning: '不在 ERP 明细中的物料、超过剩余数量的包装或重复追溯码不会入库。',
      },
      {
        id: 'inbound-complete',
        title: '完成入库',
        description:
          '只有本单所有 ERP 物料数量都核对完成后，“完成入库”才可用。保存前系统会再次检查 ERP 审核状态、仓库及单据数量；如果 ERP 内容已变化，会阻止保存并保留当前草稿。',
      },
      {
        id: 'inbound-status',
        title: '已入库与 ERP 审核',
        description:
          '本机完成后，单据会标记为“已入库，等待 ERP 审核”，用于防止重复扫码。ERP 审核后，系统收到审核状态或刷新列表时会将其从未审列表移除。底部“清空”只清除当前未保存草稿，不会删除 ERP 单据。',
      },
    ],
  },
  {
    id: 'inventory',
    title: '库存盘点',
    summary: '按账套实盘、ERP 现存量核对与差异表',
    icon: 'inventoryCount',
    items: [
      {
        id: 'inventory-account',
        title: '选择盘点账套',
        description:
          '“无锡笃能”和“上海花栗鼠”分别代表两个 ERP 账套及其固定仓库，不再手动选择仓库。两个账套的未完成盘点草稿分别保存，切换时不会混合。',
      },
      {
        id: 'inventory-scan',
        title: '扫码与实盘数量',
        description:
          '系统按解析规则和物料绑定取得存货编码，每次扫码默认把标签数量计入实盘。同型号会聚合显示，不同版本保留在明细中；包装标签数量与实际剩余量不一致时，可展开记录修改实盘数量。',
        tip: '盘点不再区分“整包”和“拆包”。是否整包不影响统计，最终以每条明细中的实盘数量为准。',
      },
      {
        id: 'inventory-complete',
        title: '完成盘点与 ERP 核对',
        description:
          '点击“完成盘点”后，系统按唯一存货编码查询所选账套的 ERP 现存量，并以“实盘数量 - ERP 数量”计算差异。任何一项 ERP 查询失败时都不会保存半张盘点单，当前草稿会保留。',
      },
      {
        id: 'inventory-excel',
        title: '盘点文件',
        description:
          '每次完成盘点生成一个 Excel 文件，其中包含“盘点明细”和“盘点差异”两个工作表。差异表记录存货编码、型号、实盘数量、ERP 数量及差异数量。',
      },
      {
        id: 'inventory-resync',
        title: '记录与重新同步',
        description:
          '盘点记录会保存当时的账套和 ERP 库存快照。重新同步时直接使用该快照生成文件，不会再次访问 ERP，也不会因后来库存变化而改写历史差异。',
      },
    ],
  },
  {
    id: 'stock',
    title: '库存查询',
    summary: '按标签或存货编码查询 ERP 仓库现存量',
    icon: 'stockQuery',
    items: [
      {
        id: 'stock-query',
        title: '查询方式',
        steps: [
          '选择需要查询的 ERP 账套。',
          '扫描物料标签，或直接输入 ERP 存货编码。',
          '输入完成后系统自动查询；搜索按钮和键盘回车可手动重试。',
          '结果显示 ERP 规格型号、存货编码，以及各仓库的现存数量。',
        ],
      },
      {
        id: 'stock-binding',
        title: '标签查询与直接查询的区别',
        description:
          '扫描标签时，系统先解析型号和版本号，再通过物料绑定换算为存货编码；直接输入存货编码时不经过物料绑定。切换账套会清空上一个账套的结果，未开放账套不会发起请求。',
      },
      {
        id: 'stock-history',
        title: '查询结果不会保存为单据',
        description:
          '库存查询只显示本次 ERP 返回结果，不写入入库、出库或盘点记录。需要保留盘点差异时，请使用库存盘点功能。',
      },
    ],
  },
  {
    id: 'documents',
    title: '单据管理',
    summary: '出库订单、入库记录、盘点记录与重新同步',
    icon: 'documentManagement',
    items: [
      {
        id: 'documents-entries',
        title: '三个记录入口',
        description:
          '“单据”包含出库订单、入库记录和盘点记录。出库订单可按当前、当天、全部查看并搜索；入库和盘点记录可按仓库或账套筛选，展开后查看型号、版本、批次、追溯码和数量。',
      },
      {
        id: 'documents-delete',
        title: '编辑与删除',
        description:
          '页面提供的编辑、删除或长按操作只处理本机 SQLite 数据，适合纠正尚未用于外部流程的记录。删除前应先确认对应 Excel 或标签是否已经同步、打印。',
        warning: '本机删除不会撤销 ERP 审核、ERP 出入库或已经打印的标签。',
      },
      {
        id: 'documents-sync',
        title: '单据重新同步',
        description:
          '入库和盘点记录可重新生成对应单据文件。设置中的“同步订单标签”用于重新生成最近一个有拆包标签的订单，作为自动同步失败后的手工导出入口。',
      },
      {
        id: 'documents-print',
        title: '拆包标签自动打印',
        description:
          '同步助手收到拆包标签后，会按物料绑定中的供应商选择模板：珠海极海半导体有限公司使用极海模板，珠海领芯科技有限公司使用无 Logo 模板；其他供应商只保存标签文件，不自动打印。',
        tip: '自动打印依赖电脑同步助手、模板、打印机和网络均正常；手工同步标签可作为兜底。',
      },
    ],
  },
  {
    id: 'binding',
    title: '物料绑定',
    summary: '型号、版本号、存货编码和供应商维护',
    icon: 'materialBinding',
    items: [
      {
        id: 'binding-fields',
        title: '绑定字段',
        description:
          '扫描型号和存货编码为必填；版本号、供应商和描述为选填。系统按录入原文保存型号和版本号，匹配时不区分英文字母大小写。两个 ERP 账套共用同一套物料绑定。',
      },
      {
        id: 'binding-version',
        title: '版本号如何使用',
        description:
          '二维码带版本号时，系统优先查找“型号 + 版本号”的精确绑定；没有精确结果时，再查找该型号的无版本绑定。没有版本差异的物料无需填写版本号。',
      },
      {
        id: 'binding-supplier',
        title: '供应商的作用',
        description:
          '供应商不参与 ERP 存货编码匹配，主要用于拆包标签模板分配和导入信息补充。不要为了区分供应商重复建立相同型号、版本和存货编码的绑定。',
      },
      {
        id: 'binding-import',
        title: 'Excel 批量维护',
        description:
          '可下载模板、导入绑定或导出全部绑定。模板列为型号、版本号（可选）、存货编码、供应商和描述。完全相同的绑定可补充供应商或描述；型号版本冲突、存货编码冲突会跳过并显示导入结果，不会静默覆盖。',
      },
    ],
  },
  {
    id: 'rules',
    title: '扫码规则',
    summary: '解析规则、占位字段、识别条件和字段前缀',
    icon: 'scanFrame',
    items: [
      {
        id: 'rules-basic',
        title: '规则的基本结构',
        description:
          '解析规则由名称、分隔符、字段顺序和启用状态组成。字段数量与二维码拆分后的段数必须一致；不需要保存的数据段也不能直接省略，应在对应位置放入占位字段。',
      },
      {
        id: 'rules-placeholder',
        title: '占位字段只负责占位置',
        description:
          '占位字段用于接收二维码中无须使用的内容，不显示、不导出，也不参与物料绑定。删除占位字段前，必须先从引用它的解析规则中移除。',
      },
      {
        id: 'rules-condition',
        title: '相似格式如何区分',
        description:
          '当多种标签使用相同分隔符和相同段数时，为规则增加“字段包含关键字”的识别条件，或配置稳定的字段前缀。满足识别条件的规则优先；同优先级规则仍无法区分时，系统会提示规则冲突，不会随机选取。',
      },
      {
        id: 'rules-prefix',
        title: '字段前缀',
        description:
          '字段包含 PART NO.、QTY、LOT NO. 等固定文字时，可在前缀配置中为对应规则和字段设置前缀。识别时会先校验前缀，再从结果中去掉固定文字，只保留真实数据。',
      },
      {
        id: 'rules-separator',
        title: '空格、换行、GS 和 RS',
        description:
          '规则支持常用符号、空格、制表符、换行、CRLF、GS、RS 和括号组合。GS 是扫码数据中的组分隔符，RS 是记录分隔符，通常不可见；只有扫描结果确实包含对应控制字符时才选择。系统会保留内部空格和换行，只清理首尾空白。',
      },
      {
        id: 'rules-check',
        title: '保存后的核对方法',
        steps: [
          '先数清二维码拆分后的实际段数，包括末尾前的无用字段。',
          '按原始顺序放置标准字段和占位字段。',
          '同结构标签增加识别条件或字段前缀。',
          '保存并启用规则后，用库存查询或盘点扫描真实样本核对型号、版本和数量。',
        ],
        warning:
          '未知二维码不会被强行猜测为某条规则。入库和盘点遇到无法识别的一维码时可能静默忽略，请以成功反馈和页面新增记录为准。',
      },
    ],
  },
  {
    id: 'settings',
    title: 'ERP 与系统设置',
    summary: '连接检测、提示音、单号规则及应用信息',
    icon: 'settings',
    items: [
      {
        id: 'settings-erp',
        title: 'ERP 对接状态',
        description:
          'ERP 状态用于检查各账套后端、凭据和 Token 是否可用。自动检测结果会短暂缓存，避免设置页反复刷新；“重新检测 ERP”只做健康检查，不读取业务单据。',
      },
      {
        id: 'settings-error',
        title: 'ERP 状态正常但业务查询失败',
        description:
          '健康检查正常只代表后端可连接。业务查询仍可能因接口权限、授权未更新、Token、账套、单号或 ERP 上游服务异常而失败，请按页面中文错误逐项检查。',
      },
      {
        id: 'settings-sound',
        title: '扫码提示音',
        description:
          '提示音可在设置中开关。连续扫描不会把相同成功语音去重，每次有效扫码都应有反馈；设备朗读卡顿时，可检查系统文字转语音引擎、媒体音量和省电限制。',
      },
      {
        id: 'settings-order-rule',
        title: '出库单号规则',
        description:
          '单号规则用于判断销售出库单属于哪个账套。修改规则只影响之后识别的订单，不能替代历史业务数据中的账套信息；正式使用前应保持 ERP 单号规则稳定。',
      },
    ],
  },
  {
    id: 'sync',
    title: '同步、备份与更新',
    summary: '电脑同步助手、NAS、配置与数据库保护',
    icon: 'syncComputer',
    items: [
      {
        id: 'sync-assistant',
        title: '连接电脑同步助手',
        steps: [
          '在电脑启动 ERP 版同步助手并确认监听地址和端口。',
          '让 PDA 与电脑处于可互相访问的同一网络。',
          '在设置中填写电脑 IP 和端口并执行连接测试。',
          '同步失败时检查电脑防火墙、IP 是否变化，以及同步助手是否仍在运行。',
        ],
      },
      {
        id: 'sync-actions',
        title: '设置页同步按钮的范围',
        description:
          '“同步入库单”和“同步出库单”会导出本机全部对应历史记录；“同步盘点单”生成最近一张已保存盘点单；“同步订单标签”生成最近一个有拆包标签的订单。单据详情中的重新同步只处理所选单据。',
      },
      {
        id: 'sync-config-backup',
        title: '配置备份',
        description:
          '配置备份包含解析规则、占位字段、仓库、出库单号规则、提示音和同步助手配置。物料绑定不包含在配置备份中，请使用物料绑定页面的 Excel 导入、导出。',
      },
      {
        id: 'sync-db-backup',
        title: '数据库与 NAS 备份',
        description:
          '数据库备份保存完整本地业务数据库，适合换机、更新版本或重要数据调整前使用。恢复后应关闭并重新打开 APP。在线更新安装 APK 前会先尝试 NAS 备份，备份失败时会停止安装以保护数据。',
      },
      {
        id: 'sync-update',
        title: '检查更新',
        description:
          '“关于掌上仓库 > 检查更新”会连接版本服务器。Android 下载完成后按系统提示安装；无法下载时检查网络、存储权限、NAS 诊断和更新服务器账号配置。',
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: '常见问题',
    summary: '扫码无反应、匹配失败、ERP 与同步异常',
    icon: 'warningState',
    items: [
      {
        id: 'trouble-no-response',
        title: '扫码后没有新增记录',
        description:
          '先确认输入框获得焦点，再检查是否出现成功语音或页面记录。没有反馈时，依次检查分隔符、字段数量、规则启用状态、识别条件和前缀。不要因扫描枪响了一声就认定 APP 已保存。',
      },
      {
        id: 'trouble-binding',
        title: '提示未找到物料绑定',
        description:
          '核对解析出的型号和版本号是否与绑定一致。若同型号不区分版本，可建立无版本绑定；若确实有多个版本，应分别绑定到正确存货编码。',
      },
      {
        id: 'trouble-erp-line',
        title: '提示物料不在 ERP 明细中',
        description:
          '确认当前账套、单号和物料绑定的存货编码。ERP 单据展示的是型号描述，系统实际按存货编码核对；绑定错误会导致看似同型号却无法入库或出库。',
      },
      {
        id: 'trouble-erp',
        title: 'ERP 无法连接或 Token 失效',
        description:
          '先到设置重新检测对应账套。若后端不可达，检查网络和正式域名；若 Token 或权限异常，需要在服务端检查自动续期状态、应用授权和接口权限，PDA 端不要反复重试消耗请求。',
      },
      {
        id: 'trouble-data',
        title: '换机、重装或更新前',
        description:
          '先完成数据库备份，并分别导出物料绑定和必要的配置。确认备份文件已能在目标位置看到后再操作；同步生成 Excel 不能代替完整数据库备份。',
      },
    ],
  },
];

export default function HelpScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>('start');
  const moduleColors = theme.isDark ? ModuleColors.dark : ModuleColors.light;
  const helpColors: Record<string, string> = {
    start: theme.primary,
    outbound: moduleColors.outbound,
    inbound: moduleColors.inbound,
    inventory: moduleColors.inventory,
    stock: moduleColors.materials,
    documents: moduleColors.orders,
    binding: theme.cyan,
    rules: theme.purple,
    settings: moduleColors.settings,
    sync: theme.info,
    troubleshooting: theme.warning,
  };
  const workflowHighlights = [
    {
      color: moduleColors.outbound,
      icon: 'truck' as const,
      label: '出库',
      value: '成功即保存',
    },
    {
      color: moduleColors.inbound,
      icon: 'log-in' as const,
      label: '入库',
      value: '完成后成单',
    },
    {
      color: moduleColors.inventory,
      icon: 'check-square' as const,
      label: '盘点',
      value: '核对后成单',
    },
  ];

  const toggleModule = (moduleId: string) => {
    setExpandedModuleId((current) => (current === moduleId ? null : moduleId));
  };

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={[styles.headerShell, { paddingTop: insets.top }]}>
        <UiPageHeader title="使用说明" onBack={() => router.back()} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom: Spacing['5xl'] + insets.bottom,
          },
        ]}
        showsVerticalScrollIndicator
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <View style={styles.heroIcon}>
              <UiAssetIcon name="scanFrame" size={38} />
            </View>
            <View style={styles.heroHeading}>
              <Text style={styles.heroEyebrow}>掌上仓库 · 现场作业手册</Text>
              <Text style={styles.heroTitle}>先确认页面反馈，再继续下一扫</Text>
            </View>
          </View>
          <Text style={styles.heroDescription}>
            扫描枪提示音只代表设备读到了条码。请以 APP
            的成功语音、页面数量变化和单据状态为准；出现错误时，本次数据不会计入。
          </Text>
          <View style={styles.workflowStrip}>
            {workflowHighlights.map((item, index) => (
              <View
                key={item.label}
                style={[styles.workflowItem, index > 0 && styles.workflowItemSeparated]}
              >
                <View
                  style={[
                    styles.workflowIcon,
                    { backgroundColor: withAlpha(item.color, theme.isDark ? 0.2 : 0.1) },
                  ]}
                >
                  <Feather name={item.icon} size={15} color={item.color} />
                </View>
                <Text style={styles.workflowLabel}>{item.label}</Text>
                <Text style={styles.workflowValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionTitle}>功能指南</Text>
            <Text style={styles.sectionSubtitle}>点击章节查看详细步骤</Text>
          </View>
          <View style={styles.sectionCount}>
            <Text style={styles.sectionCountText}>{HELP_DATA.length} 个章节</Text>
          </View>
        </View>

        {HELP_DATA.map((module, moduleIndex) => {
          const isExpanded = expandedModuleId === module.id;
          const moduleColor = helpColors[module.id] || theme.primary;

          return (
            <View
              key={module.id}
              style={[
                styles.moduleBlock,
                isExpanded && styles.moduleBlockExpanded,
                { borderColor: isExpanded ? withAlpha(moduleColor, 0.46) : theme.border },
              ]}
            >
              <TouchableOpacity
                style={styles.moduleHeader}
                activeOpacity={0.72}
                onPress={() => toggleModule(module.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isExpanded }}
                accessibilityLabel={`${module.title}，${module.summary}`}
              >
                <View
                  style={[
                    styles.moduleIcon,
                    { backgroundColor: withAlpha(moduleColor, theme.isDark ? 0.18 : 0.08) },
                  ]}
                >
                  <UiAssetIcon name={module.icon} size={35} />
                </View>
                <View style={styles.moduleHeadingText}>
                  <View style={styles.moduleTitleRow}>
                    <Text style={styles.moduleTitle}>{module.title}</Text>
                    {isExpanded ? (
                      <View
                        style={[
                          styles.expandedBadge,
                          { backgroundColor: withAlpha(moduleColor, theme.isDark ? 0.2 : 0.1) },
                        ]}
                      >
                        <Text style={[styles.expandedBadgeText, { color: moduleColor }]}>
                          已展开
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.moduleSummary} numberOfLines={2}>
                    {module.summary}
                  </Text>
                </View>
                <View style={styles.moduleAction}>
                  <Text style={[styles.moduleIndex, { color: moduleColor }]}>
                    {String(moduleIndex + 1).padStart(2, '0')}
                  </Text>
                  <View
                    style={[
                      styles.chevronBox,
                      { backgroundColor: withAlpha(moduleColor, theme.isDark ? 0.2 : 0.1) },
                    ]}
                  >
                    <Feather
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={17}
                      color={moduleColor}
                    />
                  </View>
                </View>
              </TouchableOpacity>

              {isExpanded ? (
                <View
                  style={[styles.moduleContent, { borderTopColor: withAlpha(moduleColor, 0.2) }]}
                >
                  {module.items.map((item, itemIndex) => (
                    <View
                      key={item.id}
                      style={[
                        styles.itemContainer,
                        itemIndex === module.items.length - 1 && styles.itemContainerLast,
                      ]}
                    >
                      <View style={styles.itemHeadingRow}>
                        <View style={[styles.itemMarker, { backgroundColor: moduleColor }]} />
                        <Text style={styles.itemTitle}>{item.title}</Text>
                      </View>
                      {item.description ? (
                        <Text style={styles.itemDescription}>{item.description}</Text>
                      ) : null}
                      {item.steps?.map((step, stepIndex) => (
                        <View key={`${item.id}-${stepIndex}`} style={styles.stepRow}>
                          <View
                            style={[
                              styles.stepNumber,
                              { backgroundColor: withAlpha(moduleColor, theme.isDark ? 0.2 : 0.1) },
                            ]}
                          >
                            <Text style={[styles.stepNumberText, { color: moduleColor }]}>
                              {stepIndex + 1}
                            </Text>
                          </View>
                          <Text style={styles.stepText}>{step}</Text>
                        </View>
                      ))}
                      {item.tip ? (
                        <View
                          style={[
                            styles.noteRow,
                            {
                              backgroundColor: withAlpha(theme.info, theme.isDark ? 0.12 : 0.06),
                              borderLeftColor: theme.info,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.noteIcon,
                              { backgroundColor: withAlpha(theme.info, 0.14) },
                            ]}
                          >
                            <Feather name="info" size={14} color={theme.info} />
                          </View>
                          <View style={styles.noteContent}>
                            <Text style={[styles.noteLabel, { color: theme.info }]}>操作提示</Text>
                            <Text style={styles.noteText}>{item.tip}</Text>
                          </View>
                        </View>
                      ) : null}
                      {item.warning ? (
                        <View
                          style={[
                            styles.noteRow,
                            {
                              backgroundColor: withAlpha(theme.warning, theme.isDark ? 0.12 : 0.06),
                              borderLeftColor: theme.warning,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.noteIcon,
                              { backgroundColor: withAlpha(theme.warning, 0.14) },
                            ]}
                          >
                            <Feather name="alert-triangle" size={14} color={theme.warning} />
                          </View>
                          <View style={styles.noteContent}>
                            <Text style={[styles.noteLabel, { color: theme.warning }]}>
                              注意事项
                            </Text>
                            <Text style={styles.noteText}>{item.warning}</Text>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
