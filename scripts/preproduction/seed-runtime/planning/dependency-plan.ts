import type { DependencyPlan, LoadedManifest } from '../types.js'

export function createDependencyPlan(loadedManifest: LoadedManifest): DependencyPlan {
  const { manifest, manifestFingerprint } = loadedManifest

  return {
    batch_id: manifest.identity.batch_id,
    manifest_fingerprint: manifestFingerprint,
    planned_entities: {
      users: manifest.expected_counts.users_total,
      profiles: manifest.expected_counts.users_total,
      beneficiaries: manifest.expected_counts.beneficiaries_total,
      contacts: manifest.expected_counts.contacts_total,
      assignments: manifest.expected_counts.assignments_total,
      raw_call_logs_min: manifest.expected_counts.raw_call_logs_min,
      call_correlations_min: manifest.expected_counts.call_correlations_min,
      followup_events_min: manifest.expected_counts.followup_events_min,
      derived_state: manifest.expected_counts.beneficiaries_total,
    },
  }
}