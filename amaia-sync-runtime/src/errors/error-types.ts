export class ConfigurationError extends Error {
  readonly code = 'CONFIGURATION_ERROR' as const
  constructor(
    message: string,
    public readonly errors: string[],
  ) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

export class StartupError extends Error {
  readonly code = 'STARTUP_ERROR' as const
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = 'StartupError'
  }
}

export class ShutdownError extends Error {
  readonly code = 'SHUTDOWN_ERROR' as const
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = 'ShutdownError'
  }
}

export class UnsupportedDomainError extends Error {
  readonly code = 'UNSUPPORTED_DOMAIN_ERROR' as const
  constructor(public readonly domain: string) {
    super(`Unsupported domain: ${domain}`)
    this.name = 'UnsupportedDomainError'
  }
}
