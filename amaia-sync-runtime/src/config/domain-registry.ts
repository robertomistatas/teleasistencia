import { ConfigurationError, UnsupportedDomainError } from '../errors/error-types.js'

export type SourceModel = 'append_only'
export type WatermarkType = 'id'

// OBS-4: validationEvidence must be an exact, immutable reference to the approved document
const VALIDATION_EVIDENCE =
  'AMAIA_SYNC_RUNTIME_ENGINE_ARCHITECTURE_v1.8.2 §3 + §3.3' as const

export interface DomainConfig {
  readonly name: string
  readonly amaiaTable: string
  readonly supabaseTable: string
  readonly identityBasis: string
  readonly watermarkColumn: string
  readonly watermarkType: WatermarkType
  readonly sourceModel: SourceModel
  readonly validatedAppendOnly: boolean
  readonly validationEvidence: string
}

export interface DomainRegistry {
  getDomains(): ReadonlyArray<DomainConfig>
  getValidatedDomains(): ReadonlyArray<DomainConfig>
  getDomain(name: string): DomainConfig
  isSupported(name: string): boolean
}

const DOMAIN_DEFINITIONS: ReadonlyArray<DomainConfig> = Object.freeze([
  Object.freeze({
    name: 'control_llamadas',
    amaiaTable: 'control_llamadas',
    supabaseTable: 'amaia_call_logs',
    identityBasis: 'source_amaia_id',
    watermarkColumn: 'id',
    watermarkType: 'id' as WatermarkType,
    sourceModel: 'append_only' as SourceModel,
    validatedAppendOnly: true,
    validationEvidence: VALIDATION_EVIDENCE,
  }),
  Object.freeze({
    name: 'logestado',
    amaiaTable: 'logestado',
    supabaseTable: 'amaia_alert_logs',
    identityBasis: 'source_amaia_id',
    watermarkColumn: 'id',
    watermarkType: 'id' as WatermarkType,
    sourceModel: 'append_only' as SourceModel,
    validatedAppendOnly: true,
    validationEvidence: VALIDATION_EVIDENCE,
  }),
])

export function buildDomainRegistry(): DomainRegistry {
  const domainMap = new Map<string, DomainConfig>()
  for (const d of DOMAIN_DEFINITIONS) {
    domainMap.set(d.name, d)
  }

  const validated = DOMAIN_DEFINITIONS.filter(
    (d) => d.validatedAppendOnly && d.validationEvidence.length > 0,
  )

  if (validated.length === 0) {
    throw new ConfigurationError(
      'Zero validated append-only domains — engine cannot start (R26)',
      ['No domain has validatedAppendOnly=true with non-empty validationEvidence'],
    )
  }

  const registry: DomainRegistry = {
    getDomains(): ReadonlyArray<DomainConfig> {
      return DOMAIN_DEFINITIONS
    },

    getValidatedDomains(): ReadonlyArray<DomainConfig> {
      return validated
    },

    getDomain(name: string): DomainConfig {
      const d = domainMap.get(name)
      if (!d) {
        throw new UnsupportedDomainError(name)
      }
      return d
    },

    isSupported(name: string): boolean {
      const d = domainMap.get(name)
      if (!d) return false
      return d.validatedAppendOnly && d.validationEvidence.length > 0
    },
  }

  return Object.freeze(registry)
}
