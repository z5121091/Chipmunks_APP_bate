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
          '在“设置 > 解析规则”中建立供应商二维码的分隔符和字段顺序；无用的数据段选择“忽略此段”。',
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
        id: 'inbound-code-alias',
        title: '上海极海、领芯入库编码',
        description:
          '上海花栗鼠采购入库单的供应商为珠海极海半导体有限公司或珠海领芯科技有限公司时，IC.M 加 7 位数字、点和 2 位尾码的入库编码，会按 M 替换为 0 匹配现有绑定。例如 IC.M0000255.00 对应 IC.00000255.00，只需绑定后者。本地入库记录使用绑定编码，ERP 原单据编码不变；其他供应商和无锡笃能不转换。',
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
        id: 'inventory-scope',
        title: '盘点范围与标签信息',
        description:
          '可只盘某个物料或品牌，不必盘完整个仓库。批次、生产日期和追溯码按标签规则解析并保存在本次盘点明细中，实盘数量可调整。每次盘点单独与 ERP 现存量比较，不累计为本地批次库存。没有追溯码时需人工避免重复扫描。',
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
    summary: '按物料二维码查询 ERP 仓库现存量',
    icon: 'stockQuery',
    items: [
      {
        id: 'stock-query',
        title: '查询方式',
        steps: [
          '选择需要查询的 ERP 账套。',
          '扫描已配置解析规则的物料二维码；没有分隔符的一维码会被忽略。',
          '输入完成后系统自动查询；搜索按钮和键盘回车可手动重试。',
          '结果显示 ERP 规格型号、存货编码，以及各仓库的现存数量。开启声音时，成功播报“查询成功”，绑定缺失播报“未绑定”，其他错误播报“查询失败”。',
        ],
      },
      {
        id: 'stock-binding',
        title: '物料绑定与输入过滤',
        description:
          '系统先解析型号和版本号，再通过物料绑定换算为存货编码。无分隔符的一维内容会清空输入但不查询、不播音；已配置的空格、Tab、GS/RS 等分隔符仍支持。切换账套会重置上个账套的结果；每次有效查询只请求当前物料，不使用盘点的百项批量查询。',
      },
      {
        id: 'stock-history',
        title: '查询结果不会保存为单据',
        description:
          '库存查询只读取 ERP 现存量，不累计或展示本地批次余量，也不写入入库、出库或盘点记录。需要保留盘点差异时，请使用库存盘点功能。',
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
    summary: '扫描型号、存货编码、供应商和版本号维护',
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
          '可下载模板、导入绑定或导出全部绑定。模板列依次为扫描型号、存货编码、供应商、版本号和描述，前两项必填，其余选填。导入按表头名称识别，也支持旧版列顺序；导出最后保留创建时间。完全相同的绑定可补充供应商或描述；型号版本冲突、存货编码冲突会跳过并显示导入结果，不会静默覆盖。',
      },
    ],
  },
  {
    id: 'rules',
    title: '扫码规则',
    summary: '解析规则、忽略段、识别条件和字段前缀',
    icon: 'scanFrame',
    items: [
      {
        id: 'rules-basic',
        title: '规则的基本结构',
        description:
          '解析规则由名称、分隔符、可选结束符、字段顺序和启用状态组成。字段数量与二维码拆分后的段数必须一致；不需要保存的数据段选择“忽略此段”，不能直接省略位置。',
      },
      {
        id: 'rules-placeholder',
        title: '不需要的数据选择忽略',
        description:
          '编辑规则时可直接“添加忽略段”，或在样本某一段选择“忽略此段”，无需另行创建、命名或管理。旧规则和旧备份中的占位段会自动转换，保留段序、前缀及识别条件。忽略段只参与结构与条件匹配，其内容不再保存到新物料记录，也不导出；历史业务记录保持不变。',
      },
      {
        id: 'rules-condition',
        title: '相似格式如何区分',
        description:
          '识别条件支持“包含、等于、开头是、结尾是”，均忽略大小写及首尾空白，多个条件必须全部满足。旧规则默认继续使用“包含”。条件检查的是去前缀之前的字段内容，忽略段也可设置条件；供应商备注不参与识别。满足条件的规则优先，同优先级无法区分时会提示冲突。',
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
        id: 'rules-terminator',
        title: '分隔符与结束符分别设置',
        description:
          '分隔符用于拆分字段，结束符用于移除整条扫码内容最后的固定标记。末尾处理默认“自动处理”：按原有方式清理首尾空白，并忽略超出规则段数的末尾空段，不猜测或删除其他标点。结束符与分隔符相同时，无须额外设置；规则要求的空字段继续保留。',
        steps: [
          '例如字段之间为 &、整条内容以 ; 结束，分隔符填写 &，末尾处理选择“自定义”，结束符内容填写 ;。最后一段可以是任意字段，不限日期。',
          '自定义只移除末尾完整匹配的一次，字段中间的相同字符保留；没有匹配则原样解析。扫描枪在结束符之后追加的空白不影响匹配。回车、换行、制表符、GS、RS 和 EOT 可直接选择；组合结束符可填写 ;\\r\\n。',
          '自定义控制字符可填写 \\xHH 或 \\uHHHH；反斜杠本身填写 \\\\。最多64个字符，不支持 NUL。结束符随规则备份和恢复。',
        ],
      },
      {
        id: 'rules-check',
        title: '使用扫码样本检查规则',
        steps: [
          '规则编辑主页面保留名称、扫码样本和拆分结果。分隔符与结束符、手动字段顺序、字段前缀、识别条件分别从“规则设置”进入；二级页面的“完成”只返回主页面，最后点击“保存”才会保存整条规则。',
          '扫描或粘贴原始样本后，在“解析诊断”中展开“显示隐藏字符”，可查看空格、CR、LF、TAB、GS、RS等实际字符；显示标记不会写入原始内容。样本只用于本次编辑，不写入数据库或上传ERP。',
          '程序根据样本推荐候选分隔符并显示段数，点击“拆分并逐段分配”确认，也可在“分隔符与结束符”中手动配置。推荐只判断字符结构，不判断字段含义；规格中也可能包含分隔符，需要核对拆分结果。',
          '点击“拆分并逐段分配”，确认分隔符后，窗口会显示当前段原文和进度。每选择一个字段自动进入下一段，最后一段完成后返回预览；选错可返回“上一段”，也可在预览中单独修改任意段。',
          '不要的数据选择“忽略此段”；中途关闭时已选择的字段保留，尚未分配的位置自动补为忽略段，保存前请核对完整结果。已使用的标准字段不能重复分配，忽略段可以有多个。',
          '段数、前缀或识别条件不匹配时，预览会显示具体原因。切换条件字段和匹配方式后，点击加号添加；有未添加的关键字时不能直接保存。',
          '保存前会用当前样本检查其他启用规则。重叠提醒不等同于必然冲突，仍按原优先级识别；未提供样本时只在分隔符和字段数量都相同的情况下提示结构重复，不代表已经验证通过。',
          '一张样本匹配成功不保证所有标签都匹配。保存前可替换其他型号或批次的样本，再用实际PDA核对型号、版本和数量。',
        ],
        warning:
          '未知二维码不会被强行猜测为某条规则。入库、出库物料扫描、盘点和库存查询会静默忽略无分隔符的一维内容；入库单号和出库单号仍可正常扫描。请以成功反馈和页面结果为准。',
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
          '配置备份包含解析规则（含忽略段）、仓库、出库单号规则、提示音和同步助手配置。旧备份中的占位段恢复时自动转换。物料绑定不包含在配置备份中，请使用物料绑定页面的 Excel 导入、导出。',
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
