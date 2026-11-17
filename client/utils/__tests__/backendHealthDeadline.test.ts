import { backendJsonRequest } from '../backendApi';
import { lockForOtaApply } from '../otaSafety';

const originalFetch = global.fetch;
const never = <T>(): Promise<T> => new Promise(() => undefined);

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it.each(['headers', 'body'])('ends a health check if Android never delivers the response %s', async stage => {
  jest.useFakeTimers();
  const read = jest.fn(() => never<string>());
  const fetchMock = jest.fn(() => stage === 'headers' ? never<Response>() : Promise.resolve({ text: read } as unknown as Response));
  global.fetch = fetchMock;

  const check = backendJsonRequest('/api/erp/health', {
    baseUrl: 'https://erp.invalid', timeoutMs: 8_000, settleOnAbort: true,
  });
  const result = expect(check).rejects.toThrow('请求超时（8秒）');
  expect(() => lockForOtaApply()).toThrow();
  await Promise.resolve();
  if (stage === 'body') expect(read).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(8_000);
  await result;
  lockForOtaApply()();
});

it('releases the interrupted foreground check immediately on caller cancellation', async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  global.fetch = jest.fn(() => never<Response>());
  const old = backendJsonRequest('/api/erp/health', {
    baseUrl: 'https://erp.invalid', timeoutMs: 8_000, settleOnAbort: true, signal: controller.signal,
  });
  const result = expect(old).rejects.toThrow('请求已取消');
  controller.abort();
  await result;
  lockForOtaApply()();
  expect(jest.getTimerCount()).toBe(0);
});
