export type FeedbackType = 'success' | 'warning' | 'error' | 'info';

export interface FeedbackTimingOptions {
  /** Override the automatic dismissal delay, in milliseconds. */
  duration?: number;
  /** Scanner workflows retain errors until the next result replaces them. */
  persistentErrors?: boolean;
}

export function getFeedbackDuration(type: FeedbackType, options: FeedbackTimingOptions): number | null {
  if (type === 'error' && options.persistentErrors) return null;
  return options.duration ?? (type === 'error' ? 5000 : type === 'warning' ? 2400 : 2200);
}
