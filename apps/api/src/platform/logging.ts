export type LogFields = Record<string, unknown>

export interface AppLogger {
  info(fields: LogFields): void
  error(fields: LogFields): void
}

export const noopLogger: AppLogger = {
  info() {},
  error() {},
}

export const jsonLogger: AppLogger = {
  info(fields) {
    console.log(JSON.stringify({ level: 'info', ...fields }))
  },
  error(fields) {
    console.error(JSON.stringify({ level: 'error', ...fields }))
  },
}
