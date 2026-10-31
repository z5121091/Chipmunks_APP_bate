import {
  claimUnpackPrintTask,
  getUnpackPrintTask,
  getUnpackPrintTaskRecords,
  getUnpackPrintTasks,
  updateUnpackPrintTask,
  type UnpackPrintTask,
} from '../database';
import {
  isUnpackPrintTaskInFlight,
  loadUnpackPrintTasks,
  submitUnpackPrintTask,
} from '../unpackPrintTasks';
import { submitUnpackRecordsToComputer } from '../unpackWorkflow';

jest.mock('../database', () => ({
  claimUnpackPrintTask: jest.fn(),
  getUnpackPrintTask: jest.fn(),
  getUnpackPrintTaskRecords: jest.fn(),
  getUnpackPrintTasks: jest.fn(),
  updateUnpackPrintTask: jest.fn(),
}));
jest.mock('../unpackWorkflow', () => ({
  submitUnpackRecordsToComputer: jest.fn(),
  getUnpackSyncFailureMessage: (error: Error) => error.message,
}));

const taskFixture = (): UnpackPrintTask => ({
  pair_id: 'pair-1',
  order_no: 'ORDER-1',
  warehouse_id: 'w1',
  warehouse_name: '仓库',
  shipment_record_id: 'ship-1',
  remainder_record_id: 'rest-1',
  status: 'pending',
  attempt_count: 0,
  created_at: '2026-10-13T00:00:00.000Z',
  updated_at: '2026-10-13T00:00:00.000Z',
});

describe('durable unpack print tasks', () => {
  let task: UnpackPrintTask | null;
  beforeEach(() => {
    jest.clearAllMocks();
    task = taskFixture();
    jest.mocked(getUnpackPrintTask).mockImplementation(async () => task ? { ...task } : null);
    jest.mocked(getUnpackPrintTasks).mockImplementation(async () => task ? [{ ...task }] : []);
    jest.mocked(updateUnpackPrintTask).mockImplementation(async (_id, patch) => {
      if (!task) return false;
      task = { ...task, ...patch };
      return true;
    });
    jest.mocked(claimUnpackPrintTask).mockImplementation(async () => {
      if (!task || !['pending', 'failed'].includes(task.status)) return false;
      task = { ...task, status: 'submitting', attempt_count: task.attempt_count + 1 };
      return true;
    });
    jest.mocked(getUnpackPrintTaskRecords).mockResolvedValue([
      { id: 'ship-1', pair_id: 'pair-1' },
      { id: 'rest-1', pair_id: 'pair-1' },
    ] as Awaited<ReturnType<typeof getUnpackPrintTaskRecords>>);
    jest.mocked(submitUnpackRecordsToComputer).mockResolvedValue({
      status: 'submitted', printJobId: 'pair-1', fileName: 'label.xlsx',
      message: '已提交同步助手，实际标签请核对', duplicate: false, templateNames: [],
    });
  });

  it('claims a task before sending and persists the assistant response', async () => {
    const result = await submitUnpackPrintTask('pair-1');
    expect(result.status).toBe('submitted');
    expect(result.attempt_count).toBe(1);
    expect(result.submitted_at).toBeTruthy();
    expect(submitUnpackRecordsToComputer).toHaveBeenCalledTimes(1);
    expect(isUnpackPrintTaskInFlight('pair-1')).toBe(false);
  });

  it('coalesces concurrent taps into one submission of the same task', async () => {
    let resolveSubmission!: (value: Awaited<ReturnType<typeof submitUnpackRecordsToComputer>>) => void;
    jest.mocked(submitUnpackRecordsToComputer).mockImplementation(() => new Promise((resolve) => {
      resolveSubmission = resolve;
    }));
    const first = submitUnpackPrintTask('pair-1');
    const second = submitUnpackPrintTask(' pair-1 ');
    expect(second).toBe(first);
    expect(isUnpackPrintTaskInFlight('pair-1')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    // Wait for the database read and record checks, without relying on timers.
    for (let turn = 0; turn < 12 && !resolveSubmission; turn += 1) await Promise.resolve();
    expect(resolveSubmission).toBeDefined();
    resolveSubmission({ status: 'submitted', printJobId: 'pair-1', fileName: '', message: '', duplicate: false, templateNames: [] });
    await first;
    expect(claimUnpackPrintTask).toHaveBeenCalledTimes(1);
    expect(submitUnpackRecordsToComputer).toHaveBeenCalledTimes(1);
  });

  it('keeps supplier policy skips separate and does not resend them', async () => {
    jest.mocked(submitUnpackRecordsToComputer).mockResolvedValue({
      status: 'skipped', printJobId: 'pair-1', fileName: 'label.xlsx',
      message: '供应商不适用自动打印', duplicate: false, templateNames: [],
    });
    expect((await submitUnpackPrintTask('pair-1')).status).toBe('skipped');
    await submitUnpackPrintTask('pair-1');
    expect(submitUnpackRecordsToComputer).toHaveBeenCalledTimes(1);
  });

  it('does not resend a submitted task', async () => {
    task!.status = 'submitted';
    expect((await submitUnpackPrintTask('pair-1')).status).toBe('submitted');
    expect(claimUnpackPrintTask).not.toHaveBeenCalled();
    expect(submitUnpackRecordsToComputer).not.toHaveBeenCalled();
  });

  it('persists a failure and retries the original record pair without new IDs', async () => {
    jest.mocked(submitUnpackRecordsToComputer).mockRejectedValueOnce(new Error('同步助手未连接'));
    expect((await submitUnpackPrintTask('pair-1')).last_error).toBe('同步助手未连接');
    expect(task!.status).toBe('failed');
    const result = await submitUnpackPrintTask('pair-1');
    expect(result.status).toBe('submitted');
    expect(result.attempt_count).toBe(2);
    expect(jest.mocked(submitUnpackRecordsToComputer).mock.calls[0][0]).toEqual(jest.mocked(submitUnpackRecordsToComputer).mock.calls[1][0]);
  });

  it('recovers a persisted submitting row as uncertain without automatically sending', async () => {
    task!.status = 'submitting';
    const tasks = await loadUnpackPrintTasks('ORDER-1', 'w1');
    expect(tasks[0].status).toBe('failed');
    expect(tasks[0].last_error).toContain('上次提交结果未知');
    expect(submitUnpackRecordsToComputer).not.toHaveBeenCalled();
  });

  it('never authorizes uncertain output from task status or ordinary retry alone', async () => {
    task!.status = 'failed';
    task!.last_error = '上次提交结果未知';
    await submitUnpackPrintTask('pair-1');
    expect(jest.mocked(submitUnpackRecordsToComputer).mock.calls[0][2]).toEqual({});
  });

  it('forwards an explicit reviewed retry without changing task or record IDs', async () => {
    task!.status = 'failed';
    const result = await submitUnpackPrintTask('pair-1', undefined, { retryConfirmed: true });
    expect(result.status).toBe('submitted');
    expect(jest.mocked(submitUnpackRecordsToComputer).mock.calls[0][2]).toEqual({ retryConfirmed: true });
    await submitUnpackPrintTask('pair-1', undefined, { retryConfirmed: true });
    expect(submitUnpackRecordsToComputer).toHaveBeenCalledTimes(1);
  });

  it('does not recover a task currently awaiting a response in this process', async () => {
    let resolveSubmission!: (value: Awaited<ReturnType<typeof submitUnpackRecordsToComputer>>) => void;
    jest.mocked(submitUnpackRecordsToComputer).mockImplementation(() => new Promise((resolve) => {
      resolveSubmission = resolve;
    }));
    const request = submitUnpackPrintTask('pair-1');
    for (let turn = 0; turn < 16 && !resolveSubmission; turn += 1) await Promise.resolve();
    expect(resolveSubmission).toBeDefined();
    const tasks = await loadUnpackPrintTasks('ORDER-1', 'w1');
    expect(tasks[0].status).toBe('submitting');
    resolveSubmission({ status: 'submitted', printJobId: 'pair-1', fileName: '', message: '', duplicate: false, templateNames: [] });
    await request;
  });

  it('refuses to print a missing half of an unpack pair', async () => {
    jest.mocked(getUnpackPrintTaskRecords).mockResolvedValue([
      { id: 'ship-1', pair_id: 'pair-1' },
    ] as Awaited<ReturnType<typeof getUnpackPrintTaskRecords>>);
    const result = await submitUnpackPrintTask('pair-1');
    expect(result.status).toBe('failed');
    expect(result.last_error).toContain('拆包记录不完整');
    expect(submitUnpackRecordsToComputer).not.toHaveBeenCalled();
  });

  it('never recreates a task deleted while a response is in flight', async () => {
    jest.mocked(submitUnpackRecordsToComputer).mockImplementation(async () => {
      task = null;
      return { status: 'submitted', printJobId: 'pair-1', fileName: '', message: '', duplicate: false, templateNames: [] };
    });
    await expect(submitUnpackPrintTask('pair-1')).rejects.toThrow('已删除或不存在');
    expect(task).toBeNull();
  });
});
