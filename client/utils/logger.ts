type LoggerMethod = (...args: unknown[]) => void;

const isLoggingEnabled = __DEV__;

const createMethod = (method: 'log' | 'warn' | 'error'): LoggerMethod => {
  return (...args: unknown[]) => {
    if (!isLoggingEnabled) {
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

