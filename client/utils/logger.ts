type LoggerMethod = (...args: unknown[]) => void;
type LoggerLevel = 'log' | 'warn' | 'error';

const RELEASE_MIN_LEVEL: LoggerLevel = 'warn';
const LOG_LEVEL_WEIGHT: Record<LoggerLevel, number> = {
  log: 10,
  warn: 20,
  error: 30,
};

const shouldLog = (level: LoggerLevel): boolean => {
  if (__DEV__) {
    return true;
  }

  return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[RELEASE_MIN_LEVEL];
};

const createMethod = (method: LoggerLevel): LoggerMethod => {
  return (...args: unknown[]) => {
    if (!shouldLog(method)) {
      return;
    }

    console[method](...args);
  };
};

export const logger = {
  log: createMethod('log'),
  warn: createMethod('warn'),
  error: createMethod('error'),
};
