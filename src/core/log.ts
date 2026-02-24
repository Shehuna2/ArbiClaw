export type LogLevel = 'info' | 'warn' | 'error';

const emit = (level: LogLevel, msg: string, meta?: Record<string, unknown>) => {
  const base = { ts: new Date().toISOString(), level, msg };
  const line = JSON.stringify(meta ? { ...base, ...meta } : base);
  const jsonToStdout = process.argv.includes('--json') && process.argv[process.argv.indexOf('--json') + 1] === '-';
  if (jsonToStdout) {
    console.error(line);
    return;
  }
  console.log(line);
};

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta)
};
