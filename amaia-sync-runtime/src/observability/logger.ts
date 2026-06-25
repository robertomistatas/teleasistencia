export interface LogContext {
  cycle_id?: string
  domain?: string
  run_id?: string
  manifest_id?: string
}

export interface Logger {
  info(event: string, detail?: Record<string, unknown>, context?: LogContext): void
  warn(event: string, detail?: Record<string, unknown>, context?: LogContext): void
  error(event: string, detail?: Record<string, unknown>, context?: LogContext): void
  fatal(event: string, detail?: Record<string, unknown>, context?: LogContext): void
}

const LEVEL_NUMERIC: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 2,
}

function writeLine(payload: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(payload) + '\n')
}

export function createLogger(
  engineInstanceId: string,
  ownerIdentity: string,
  level: 'info' | 'warn' | 'error',
): Logger {
  const minLevel = LEVEL_NUMERIC[level]

  function emit(
    logLevel: string,
    event: string,
    detail?: Record<string, unknown>,
    context?: LogContext,
  ): void {
    writeLine({
      ts: new Date().toISOString(),
      level: logLevel,
      engine_instance_id: engineInstanceId,
      owner_identity: ownerIdentity,
      cycle_id: context?.cycle_id ?? null,
      domain: context?.domain ?? null,
      run_id: context?.run_id ?? null,
      manifest_id: context?.manifest_id ?? null,
      event,
      detail: detail ?? {},
    })
  }

  return {
    info(event, detail?, context?) {
      if (LEVEL_NUMERIC['info'] <= minLevel) {
        emit('info', event, detail, context)
      }
    },
    warn(event, detail?, context?) {
      if (LEVEL_NUMERIC['warn'] <= minLevel) {
        emit('warn', event, detail, context)
      }
    },
    error(event, detail?, context?) {
      if (LEVEL_NUMERIC['error'] <= minLevel) {
        emit('error', event, detail, context)
      }
    },
    fatal(event, detail?, context?) {
      // fatal always emits regardless of configured level — MC-3: serializes as "level":"fatal"
      emit('fatal', event, detail, context)
    },
  }
}

// OBS-1: emitFallbackLog accepts parametrizable level
export function emitFallbackLog(
  engineInstanceId: string,
  ownerIdentity: string,
  level: 'info' | 'warn' | 'error' | 'fatal',
  event: string,
  detail: Record<string, unknown>,
): void {
  writeLine({
    ts: new Date().toISOString(),
    level,
    engine_instance_id: engineInstanceId,
    owner_identity: ownerIdentity,
    cycle_id: null,
    domain: null,
    run_id: null,
    manifest_id: null,
    event,
    detail,
  })
}
