import type { ZodType } from 'zod';

export type JsonValidator<T> = ZodType<T> | ((value: unknown) => value is T);

const applyValidator = <T>(
  parsed: unknown,
  validator?: JsonValidator<T>,
  label = 'json'
): T | null => {
  if (!validator) {
    return parsed as T;
  }

  if (typeof validator === 'function' && !('safeParse' in validator)) {
    return validator(parsed) ? parsed : null;
  }

  const result = (validator as ZodType<T>).safeParse(parsed);
  if (result.success) {
    return result.data;
  }

  console.error(`[safeJsonParse] ${label} 校验失败:`, result.error.flatten());
  return null;
};

export const safeJsonParse = <T>(
  value: string | null,
  fallback: T,
  label = 'json',
  validator?: JsonValidator<T>
): T => {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return applyValidator(parsed, validator, label) ?? fallback;
  } catch (error) {
    console.error(`[safeJsonParse] ${label} 解析失败:`, error);
    return fallback;
  }
};

export const safeJsonParseNullable = <T>(
  value: string | null,
  label = 'json',
  validator?: JsonValidator<T>
): T | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return applyValidator(parsed, validator, label);
  } catch (error) {
    console.error(`[safeJsonParseNullable] ${label} 解析失败:`, error);
    return null;
  }
};
