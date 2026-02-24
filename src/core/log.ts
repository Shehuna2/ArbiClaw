export type LogLevel = 'info' | 'warn' | 'error';

const emit = (level: LogLevel, msg: string, meta?: Record<string, unknown>) => {
  const base = { ts: new Date().toISOString(), level, msg };
  console.log(JSON.stringify(meta ? { ...base, ...meta } : base));
};

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta)
};
