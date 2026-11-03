import { AppModal as Modal } from '@/components/AppModal';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { AppModalCard } from '@/components/AppModalCard';
import { CustomAlert, type AlertButtonType } from '@/components/CustomAlert';
import { Screen } from '@/components/Screen';
import { UiInput, UiToolbarButton } from '@/components/UiRedesign';
import { WarehouseScanInput, type WarehouseScanInputHandle } from '@/components/WarehouseScanInput';
import { useTheme } from '@/hooks/useTheme';
import { Spacing } from '@/constants/theme';
import {
  applyLabelQuantityCorrection, getLabelCorrectionTraceNo, IgnoredLabelReprintScan,
  LabelReprintValidationError, parseLabelCorrectionQuantity, prepareLabelReprint,
  submitLabelReprint, type LabelReprintTask,
} from '@/utils/labelReprint';
import { cancelScanSubmit, scheduleScanSubmit } from '@/utils/scannerInput';
import { formatDateTime } from '@/utils/time';
import { createStyles } from './styles';

const AUTO_SUBMIT_DELAY_MS = 150;

type Notice = { title: string; message: string; retryTask?: LabelReprintTask };

const getTaskStatusLabel = (task: LabelReprintTask) => {
  if (task.status === 'submitted') return '已提交同步助手';
  if (task.status === 'submitting') return '正在提交';
  if (task.status === 'pending') return '待提交';
  return task.retryAllowed === false ? '本次未打印' : '失败待处理';
};

export default function LabelReprintScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [taskViewportHeight, setTaskViewportHeight] = useState(0);
  const taskOverlayPadding = {
    paddingTop: Math.max(Spacing.md, insets.top),
    paddingBottom: Math.max(Spacing.md, insets.bottom),
  };
  const taskModalHeight = Math.max(0, Math.min(
    windowHeight * 0.82,
    680,
    windowHeight - taskOverlayPadding.paddingTop - taskOverlayPadding.paddingBottom,
    taskViewportHeight || windowHeight,
  ));
  const scannerRef = useRef<WarehouseScanInputHandle>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);
  const sessionRef = useRef(0);
  const inputRef = useRef('');
  const pendingScansRef = useRef<string[]>([]);
  const busyRef = useRef(false);
  const modalOpenRef = useRef(false);
  const quantityModeRef = useRef(false);
  const correctionScanPendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [processing, setProcessing] = useState(false);
  // Reprint results and retry IDs exist only for this visit; never persist them.
  const [tasks, setTasks] = useState<LabelReprintTask[]>([]);
  const [queueVersion, setQueueVersion] = useState(0);
  const [showTasks, setShowTasks] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [feedback, setFeedback] = useState('');
  const [feedbackIsError, setFeedbackIsError] = useState(false);
  const [quantityMode, setQuantityMode] = useState(false);
  const [correctionTask, setCorrectionTask] = useState<LabelReprintTask | null>(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [quantityError, setQuantityError] = useState('');

  const quantityPreview = useMemo(() => {
    if (!correctionTask || !quantityInput.trim()) return null;
    try {
      const quantity = parseLabelCorrectionQuantity(quantityInput);
      return { quantity, traceNo: getLabelCorrectionTraceNo(correctionTask, quantity), error: '' };
    } catch (error) {
      return { quantity: null, traceNo: '', error: error instanceof Error ? error.message : '请输入大于 0 的整数' };
    }
  }, [correctionTask, quantityInput]);

  const focusScanner = useCallback((delay = 0) => {
    if (activeRef.current && !modalOpenRef.current) scannerRef.current?.focus(delay);
  }, []);

  const clearScannerInput = useCallback(() => {
    cancelScanSubmit(timerRef);
    inputRef.current = '';
    setInputValue('');
  }, []);

  useFocusEffect(useCallback(() => {
    sessionRef.current += 1;
    activeRef.current = true;
    busyRef.current = false;
    modalOpenRef.current = false;
    quantityModeRef.current = false;
    correctionScanPendingRef.current = false;
    pendingScansRef.current = [];
    inputRef.current = '';
    setInputValue('');
    setProcessing(false);
    setTasks([]);
    setShowTasks(false);
    setNotice(null);
    setFeedback('');
    setFeedbackIsError(false);
    setQuantityMode(false);
    setCorrectionTask(null);
    setQuantityInput('');
    setQuantityError('');
    focusScanner(120);
    return () => {
      activeRef.current = false;
      sessionRef.current += 1;
      cancelScanSubmit(timerRef);
      abortRef.current?.abort();
      abortRef.current = null;
      inputRef.current = '';
      pendingScansRef.current = [];
      busyRef.current = false;
      modalOpenRef.current = false;
      quantityModeRef.current = false;
      correctionScanPendingRef.current = false;
      setInputValue('');
      setProcessing(false);
      setTasks([]);
      setShowTasks(false);
      setNotice(null);
      setFeedback('');
      setFeedbackIsError(false);
      setQuantityMode(false);
      setCorrectionTask(null);
      setQuantityInput('');
      setQuantityError('');
    };
  }, [focusScanner]));

  const updateTask = useCallback((task: LabelReprintTask) => {
    setTasks((previous) => {
      const existing = previous.findIndex((item) => item.id === task.id);
      if (existing < 0) return [task, ...previous];
      return previous.map((item) => item.id === task.id ? task : item);
    });
  }, []);

  const displayResult = useCallback((result: LabelReprintTask, manualRetry: boolean) => {
    updateTask(result);
    setFeedback(result.status === 'submitted' ? '已提交两张标签，请核对是否实际出纸' : result.lastError || '标签补打提交失败');
    setFeedbackIsError(result.status !== 'submitted');
    if (result.status === 'submitted' && manualRetry) {
      modalOpenRef.current = false;
      setShowTasks(false);
      setNotice(null);
    } else if (result.status === 'failed') {
      clearScannerInput();
      modalOpenRef.current = true;
      setShowTasks(true);
    }
  }, [clearScannerInput, updateTask]);

  const processNextScan = useCallback(async () => {
    if (!activeRef.current || busyRef.current || modalOpenRef.current) return;
    const raw = pendingScansRef.current.shift();
    if (!raw) return;
    const session = sessionRef.current;
    const correctingQuantity = quantityModeRef.current;
    const isCurrent = () => activeRef.current && sessionRef.current === session;
    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = true;
    setProcessing(true);
    setFeedback(correctingQuantity ? '正在解析标签，请稍后输入正确数量' : '正在解析标签并提交补打');
    setFeedbackIsError(false);
    try {
      const prepared = await prepareLabelReprint(raw);
      if (!isCurrent()) return;
      if (correctingQuantity) {
        clearScannerInput();
        modalOpenRef.current = true;
        setCorrectionTask(prepared);
        setQuantityInput('');
        setQuantityError('');
        setFeedback('请输入正确数量，确认后打印两张标签');
        return;
      }
      updateTask({ ...prepared, status: 'submitting' });
      const result = await submitLabelReprint(prepared, { signal: controller.signal, shouldContinue: isCurrent });
      if (!isCurrent()) return;
      displayResult(result, false);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof IgnoredLabelReprintScan) {
        correctionScanPendingRef.current = false;
        setFeedback('');
        setFeedbackIsError(false);
        return;
      }
      const message = error instanceof Error ? error.message : '无法识别标签，请检查解析规则和型号绑定';
      correctionScanPendingRef.current = false;
      setFeedback(message);
      setFeedbackIsError(true);
      clearScannerInput();
      modalOpenRef.current = true;
      setNotice({ title: error instanceof LabelReprintValidationError ? error.title : '无法补打', message });
    } finally {
      if (isCurrent()) {
        abortRef.current = null;
        busyRef.current = false;
        setProcessing(false);
        if (pendingScansRef.current.length > 0) setQueueVersion((value) => value + 1);
        focusScanner(80);
      }
    }
  }, [clearScannerInput, displayResult, focusScanner, updateTask]);

  // Accept hardware scans while one task submits, and process them in order.
  useEffect(() => { void processNextScan(); }, [processNextScan, queueVersion, processing, showTasks, notice, correctionTask]);

  const acceptScan = useCallback(() => {
    cancelScanSubmit(timerRef);
    if (!activeRef.current || modalOpenRef.current || correctionScanPendingRef.current) return;
    const raw = inputRef.current;
    if (!raw.trim()) return;
    // Consume synchronously: Enter and the stability timer cannot accept this input twice.
    inputRef.current = '';
    setInputValue('');
    pendingScansRef.current.push(raw);
    // The correction mode captures exactly one label. Later scans must never
    // escape this dialog and become ordinary print requests after it closes.
    if (quantityModeRef.current) correctionScanPendingRef.current = true;
    setQueueVersion((value) => value + 1);
    focusScanner();
  }, [focusScanner]);

  const handleInputChange = useCallback((value: string) => {
    if (!activeRef.current || modalOpenRef.current || correctionScanPendingRef.current) return;
    inputRef.current = value;
    setInputValue(value);
    if (!value.trim()) { cancelScanSubmit(timerRef); return; }
    scheduleScanSubmit(timerRef, acceptScan, AUTO_SUBMIT_DELAY_MS);
  }, [acceptScan]);

  const toggleQuantityMode = useCallback(() => {
    if (!activeRef.current || busyRef.current || modalOpenRef.current || pendingScansRef.current.length > 0) return;
    clearScannerInput();
    quantityModeRef.current = !quantityModeRef.current;
    correctionScanPendingRef.current = false;
    setQuantityMode(quantityModeRef.current);
    setFeedback('');
    setFeedbackIsError(false);
    focusScanner(80);
  }, [clearScannerInput, focusScanner]);

  const closeQuantityCorrection = useCallback(() => {
    if (busyRef.current) return;
    clearScannerInput();
    pendingScansRef.current = [];
    quantityModeRef.current = false;
    correctionScanPendingRef.current = false;
    modalOpenRef.current = false;
    setQuantityMode(false);
    setCorrectionTask(null);
    setQuantityInput('');
    setQuantityError('');
    setFeedback('已取消修改数量，本次未打印');
    setFeedbackIsError(false);
    Keyboard.dismiss();
    focusScanner(80);
  }, [clearScannerInput, focusScanner]);

  const confirmQuantityCorrection = useCallback(async () => {
    if (!activeRef.current || busyRef.current || !correctionTask) return;
    let quantity: number;
    try {
      quantity = parseLabelCorrectionQuantity(quantityInput);
    } catch (error) {
      setQuantityError(error instanceof Error ? error.message : '请输入大于 0 的整数');
      return;
    }
    const session = sessionRef.current;
    const isCurrent = () => activeRef.current && sessionRef.current === session;
    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = true;
    setProcessing(true);
    setQuantityError('');
    let editedTask: LabelReprintTask | null = null;
    try {
      editedTask = await applyLabelQuantityCorrection(correctionTask, quantity);
      if (!isCurrent()) return;
      updateTask({ ...editedTask, status: 'submitting' });
      const result = await submitLabelReprint(editedTask, { signal: controller.signal, shouldContinue: isCurrent });
      if (!isCurrent()) return;
      quantityModeRef.current = false;
      correctionScanPendingRef.current = false;
      setQuantityMode(false);
      setCorrectionTask(null);
      setQuantityInput('');
      Keyboard.dismiss();
      // A failed print uses the existing receipt/retry flow, retaining this
      // task's already corrected QR and trace number without incrementing again.
      displayResult(result, true);
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : '数量修改失败，请核对标签和解析规则';
      if (!editedTask) {
        setQuantityError(message);
      } else {
        quantityModeRef.current = false;
        correctionScanPendingRef.current = false;
        setQuantityMode(false);
        setCorrectionTask(null);
        setQuantityInput('');
        Keyboard.dismiss();
        displayResult({ ...editedTask, status: 'failed', lastError: message }, false);
      }
    } finally {
      if (isCurrent()) {
        abortRef.current = null;
        busyRef.current = false;
        setProcessing(false);
        focusScanner(80);
      }
    }
  }, [correctionTask, displayResult, focusScanner, quantityInput, updateTask]);

  const closeTasks = useCallback(() => {
    setShowTasks(false);
    modalOpenRef.current = false;
    focusScanner(80);
  }, [focusScanner]);

  const retryTask = useCallback(async (task: LabelReprintTask) => {
    if (!activeRef.current || busyRef.current) return;
    const session = sessionRef.current;
    const isCurrent = () => activeRef.current && sessionRef.current === session;
    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = true;
    setProcessing(true);
    setNotice(null);
    updateTask({ ...task, status: 'submitting' });
    try {
      const result = await submitLabelReprint(task, { retryConfirmed: true, signal: controller.signal, shouldContinue: isCurrent });
      if (isCurrent()) displayResult(result, true);
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : '提交失败，请稍后重试';
      updateTask({ ...task, status: 'failed', lastError: message });
      setFeedback(message);
      setFeedbackIsError(true);
    } finally {
      if (isCurrent()) {
        abortRef.current = null;
        busyRef.current = false;
        setProcessing(false);
        focusScanner(80);
      }
    }
  }, [displayResult, focusScanner, updateTask]);

  const closeNotice = useCallback(() => {
    setNotice(null);
    modalOpenRef.current = showTasks;
    focusScanner(80);
  }, [focusScanner, showTasks]);

  const noticeButtons: AlertButtonType[] = notice?.retryTask ? [
    { text: '稍后', onPress: closeNotice },
    { text: '核对并提交', onPress: () => { if (notice.retryTask) void retryTask(notice.retryTask); } },
  ] : [{ text: '知道了', onPress: closeNotice }];

  const latestTask = tasks[0];
  const renderTask = (task: LabelReprintTask, inModal = false) => (
    <View key={task.id} style={styles.card}>
      <View style={styles.cardHeading}>
        <Text style={styles.model}>{task.model}</Text>
        <Text style={styles.quantity}>{task.quantity} · 2 张</Text>
      </View>
      <Text style={styles.detail}>{task.supplier}</Text>
      <Text style={styles.detail}>批次：{task.batch || '—'}</Text>
      <Text style={styles.trace}>{task.traceNo
        ? `追溯码：${task.traceNo}`
        : task.boxNo ? `箱号：${task.boxNo}` : '追溯码：—'}</Text>
      <View style={styles.statusRow}>
        <Text style={[styles.status, { color: task.status === 'submitted' ? theme.success : task.status === 'failed' ? theme.error : theme.textSecondary }]}>{getTaskStatusLabel(task)}</Text>
        <Text style={styles.time}>{formatDateTime(task.updatedAt)}</Text>
      </View>
      {inModal && task.lastError ? <Text style={[styles.detail, { color: theme.error }]}>{task.lastError}</Text> : null}
      {inModal && task.status === 'failed' && task.retryAllowed !== false ? (
        <UiToolbarButton label="核对后重试" icon="printer" compact disabled={processing}
          style={styles.retryButton} onPress={() => {
            setNotice({ title: '重试标签任务', message: `请先核对 ${task.model} 的两张标签是否已出纸。确认仍需补打后，将重新提交原任务。`, retryTask: task });
          }} />
      ) : null}
    </View>
  );

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}
      safeAreaEdges={['top', 'left', 'right']} disableAutoScroll>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>标签补打</Text>
          <View style={styles.headerActions}>
            <UiToolbarButton label={quantityMode ? '取消修改' : '修改数量'} icon={quantityMode ? 'x' : 'edit-3'}
              compact disabled={processing} containerStyle={styles.headerActionSlot} style={styles.boundedAction}
              onPress={toggleQuantityMode} />
            <UiToolbarButton label="打印任务" icon="printer" compact disabled={quantityMode || processing}
              containerStyle={styles.headerActionSlot} style={styles.boundedAction} onPress={() => {
              clearScannerInput();
              modalOpenRef.current = true;
              setShowTasks(true);
            }} />
          </View>
        </View>
        <View style={styles.scanArea}>
          <WarehouseScanInput inputRef={scannerRef} value={inputValue} onChangeText={handleInputChange}
            placeholder={quantityMode ? '扫描需要修改数量的标签' : '扫描需要补打的标签'} active processing={processing}
            acceptInputWhileProcessing={!quantityMode} editable={!showTasks && !notice && !correctionTask}
            autoFocus={!showTasks && !notice && !correctionTask} actionLabel={quantityMode ? '扫描标签' : '补打标签'} actionIcon="maximize"
            onActionPress={acceptScan} onSubmitEditing={acceptScan} />
          <Text style={[styles.hint, quantityMode && styles.modeHint]}>{quantityMode
            ? '修改数量：扫码后输入正确数量，确认才打印；仅本次有效'
            : '扫码后自动补打两张相同标签'}</Text>
          <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: feedbackIsError ? theme.error : theme.success }]}>{feedback}</Text>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {latestTask ? <><Text style={styles.sectionTitle}>最近补打结果</Text>{renderTask(latestTask)}</> : (
            <View style={styles.empty}>
              <Feather name="maximize" size={30} color={theme.textMuted} />
              <Text style={styles.emptyTitle}>等待扫码</Text>
              <Text style={styles.emptyDescription}>扫描原标签二维码，即可补打</Text>
            </View>
          )}
        </ScrollView>
      </View>
      {<Modal transparent visible={Boolean(correctionTask) && (true)} animationType="fade" onRequestClose={closeQuantityCorrection}>{correctionTask ? <>
          <KeyboardAvoidingView style={[styles.modalOverlay, taskOverlayPadding]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.modalViewport} testID="label-quantity-viewport"
              onLayout={({ nativeEvent }) => {
                const height = nativeEvent.layout.height;
                if (height > 0) setTaskViewportHeight(height);
              }}>
              <AppModalCard title="修改标签数量" subtitle="确认后打印两张相同标签"
                size="auto" stretchBody style={{ height: taskModalHeight }} bodyStyle={styles.modalBody}
                onClose={processing ? undefined : closeQuantityCorrection}
                footer={<View style={styles.correctionActions}>
                  <UiToolbarButton label="取消" disabled={processing} onPress={closeQuantityCorrection}
                    containerStyle={styles.correctionAction} style={styles.boundedAction} />
                  <UiToolbarButton label="确认打印" icon="printer" primary loading={processing} disabled={processing}
                    onPress={() => { void confirmQuantityCorrection(); }}
                    containerStyle={styles.correctionAction} style={styles.boundedAction} />
                </View>}>
                <ScrollView style={styles.taskScroll} contentContainerStyle={styles.correctionContent}
                  testID="label-quantity-form" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
                  <Text style={styles.model}>{correctionTask.model}</Text>
                  <Text style={styles.detail}>原数量：{correctionTask.quantity}</Text>
                  <Text style={styles.detail}>原追溯码：{correctionTask.traceNo || '无'}</Text>
                  <Text style={styles.sectionTitle}>正确数量</Text>
                  <UiInput value={quantityInput} onChangeText={(value) => { setQuantityInput(value); setQuantityError(''); }}
                    accessibilityLabel="正确数量" placeholder="请输入大于 0 的整数" keyboardType="number-pad"
                    editable={!processing} autoFocus returnKeyType="done" onSubmitEditing={() => { void confirmQuantityCorrection(); }} />
                  {quantityError || quantityPreview?.error ? <Text accessibilityLiveRegion="polite"
                    style={styles.correctionError}>{quantityError || quantityPreview?.error}</Text> : null}
                  {quantityPreview?.quantity !== null && quantityPreview?.quantity !== undefined && !quantityPreview.error ? <>
                    <Text style={styles.trace}>新追溯码：{quantityPreview.traceNo || '无（保持为空）'}</Text>
                    {quantityPreview.quantity === correctionTask.quantity
                      ? <Text style={styles.detail}>数量未变，将原样补打，追溯码保持不变</Text>
                      : null}
                  </> : null}
                  <Text style={styles.modalHint}>可大于原数量；只修改标签，不改变库存和订单记录。</Text>
                  {correctionTask.traceNo ? <Text style={styles.modalHint}>追溯码按当前标签递增，重复扫描同一张旧标签会生成相同的新码。</Text> : null}
                </ScrollView>
              </AppModalCard>
            </View>
          </KeyboardAvoidingView>
        </> : null}</Modal>}
      {<Modal transparent visible={Boolean(showTasks && !notice) && (true)} animationType="fade" onRequestClose={closeTasks}>{showTasks && !notice ? <>
          <KeyboardAvoidingView style={[styles.modalOverlay, taskOverlayPadding]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalViewport} testID="label-reprint-task-viewport"
              onLayout={({ nativeEvent }) => {
                const height = nativeEvent.layout.height;
                if (height > 0) setTaskViewportHeight(height);
              }}>
              <AppModalCard title="补打标签任务" subtitle="任务回执由同步助手提供，请核对标签是否实际出纸"
                size="auto" stretchBody style={{ height: taskModalHeight }} bodyStyle={styles.modalBody}
                onClose={closeTasks} footer={<UiToolbarButton label="稍后" onPress={closeTasks} />}>
                <ScrollView style={styles.taskScroll} contentContainerStyle={styles.taskList}
                  testID="label-reprint-task-list" keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator>
                  <Text style={styles.modalHint}>仅显示本次页面内的任务，离开页面后清空</Text>
                  {tasks.map((task) => renderTask(task, true))}
                  {tasks.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>暂无补打任务</Text></View> : null}
                </ScrollView>
              </AppModalCard>
            </View>
          </KeyboardAvoidingView>
        </> : null}</Modal>}
      <CustomAlert visible={Boolean(notice)} title={notice?.title || ''} message={notice?.message}
        icon="warning" buttons={noticeButtons} onClose={closeNotice} />
    </Screen>
  );
}
