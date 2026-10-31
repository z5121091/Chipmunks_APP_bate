import type { SyncConfig } from '@/constants/config';
import {
  claimUnpackPrintTask,
  getUnpackPrintTask,
  getUnpackPrintTaskRecords,
  getUnpackPrintTasks,
  updateUnpackPrintTask,
  type UnpackPrintTask,
} from '@/utils/database';
import {
  getUnpackSyncFailureMessage,
  submitUnpackRecordsToComputer,
  type UnpackPrintSubmission,
} from '@/utils/unpackWorkflow';

const activeSubmissions = new Map<string, Promise<UnpackPrintTask>>();
const activeRecoveries = new Map<string, Promise<boolean>>();
const interruptedSubmissionMessage =
  '上次提交结果未知，请先核对标签，再使用原任务重试';

export const isUnpackPrintTaskInFlight = (pairId: string): boolean =>
  activeSubmissions.has(pairId.trim());

const recoverInterruptedTask = (pairId: string): Promise<boolean> => {
  const active = activeRecoveries.get(pairId);
  if (active) return active;
  const recovery = Promise.resolve()
    .then(async () => {
      const latest = await getUnpackPrintTask(pairId);
      if (latest?.status !== 'submitting' || isUnpackPrintTaskInFlight(pairId)) return false;
      return updateUnpackPrintTask(pairId, {
        status: 'failed',
        last_error: interruptedSubmissionMessage,
        last_message: '',
      }, 'submitting');
    })
    .finally(() => {
      if (activeRecoveries.get(pairId) === recovery) activeRecoveries.delete(pairId);
    });
  activeRecoveries.set(pairId, recovery);
  return recovery;
};

/** Recover interrupted requests for display only; this never sends a label. */
export const loadUnpackPrintTasks = async (
  orderNo: string,
  warehouseId: string
): Promise<UnpackPrintTask[]> => {
  const tasks = await getUnpackPrintTasks(orderNo, warehouseId);
  let recovered = false;
  for (const task of tasks) {
    if (task.status === 'submitting' && !isUnpackPrintTaskInFlight(task.pair_id)) {
      recovered = (await recoverInterruptedTask(task.pair_id)) || recovered;
    }
  }
  return recovered ? getUnpackPrintTasks(orderNo, warehouseId) : tasks;
};

const readExistingTask = async (pairId: string): Promise<UnpackPrintTask> => {
  const task = await getUnpackPrintTask(pairId);
  if (!task) throw new Error('该拆包任务已删除或不存在');
  return task;
};

const performSubmission = async (
  pairId: string,
  syncConfig?: SyncConfig,
  options: UnpackPrintSubmitOptions = {}
): Promise<UnpackPrintTask> => {
  let task = await readExistingTask(pairId);
  if (task.status === 'submitted' || task.status === 'skipped') return task;
  if (task.status === 'submitting') {
    // The map contains this request itself. An existing persisted submitting
    // row therefore belongs to a previous interrupted process, not this one.
    await updateUnpackPrintTask(pairId, {
      status: 'failed',
      last_error: interruptedSubmissionMessage,
      last_message: '',
    }, 'submitting');
    task = await readExistingTask(pairId);
  }
  if (!(await claimUnpackPrintTask(pairId))) {
    task = await readExistingTask(pairId);
    if (task.status === 'submitted' || task.status === 'skipped') return task;
    throw new Error('该拆包任务正在处理，请稍候');
  }

  let submission: UnpackPrintSubmission | undefined;
  try {
    task = await readExistingTask(pairId);
    const records = await getUnpackPrintTaskRecords(pairId);
    const recordIds = new Set(records.map((record) => record.id));
    if (
      records.length !== 2 ||
      !recordIds.has(task.shipment_record_id) ||
      !recordIds.has(task.remainder_record_id) ||
      records.some((record) => record.pair_id?.trim() !== pairId)
    ) {
      throw new Error('拆包记录不完整，不能提交打印，请先核对记录');
    }
    // A deleted task must not be resurrected by a late request.
    await readExistingTask(pairId);
    submission = await submitUnpackRecordsToComputer(records, syncConfig, options);
    const saved = await updateUnpackPrintTask(pairId, {
      status: submission.status,
      last_error: '',
      last_message: submission.message,
      submitted_at: submission.status === 'submitted' ? new Date().toISOString() : '',
    }, 'submitting');
    if (!saved) throw new Error('拆包任务已删除，不能保存提交结果');
    return readExistingTask(pairId);
  } catch (error) {
    const message = submission
      ? '已收到同步助手结果，但任务状态保存失败；请先核对标签，再使用原任务重试'
      : getUnpackSyncFailureMessage(error);
    const saved = await updateUnpackPrintTask(pairId, {
      status: 'failed',
      last_error: message,
      last_message: '',
    }, 'submitting');
    if (!saved) throw new Error('该拆包任务已删除或不存在');
    return readExistingTask(pairId);
  }
};

/** Submit/retry one durable task using its original pair_id as print_job_id. */
export interface UnpackPrintSubmitOptions {
  /** Set only by the existing explicit "核对并提交" user action. */
  retryConfirmed?: boolean;
}

export const submitUnpackPrintTask = (
  pairId: string,
  syncConfig?: SyncConfig,
  options: UnpackPrintSubmitOptions = {}
): Promise<UnpackPrintTask> => {
  const normalizedPairId = pairId.trim();
  if (!normalizedPairId) return Promise.reject(new Error('缺少拆包打印任务标识'));
  const active = activeSubmissions.get(normalizedPairId);
  if (active) return active;
  const request = Promise.resolve()
    .then(async () => {
      // Serialize recovery and a user retry so a late recovery cannot change a
      // newly submitted task back to failed.
      const recovery = activeRecoveries.get(normalizedPairId);
      if (recovery) await recovery;
      return performSubmission(normalizedPairId, syncConfig, options);
    })
    .finally(() => {
      if (activeSubmissions.get(normalizedPairId) === request) {
        activeSubmissions.delete(normalizedPairId);
      }
    });
  activeSubmissions.set(normalizedPairId, request);
  return request;
};
