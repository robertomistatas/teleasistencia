import { Badge } from '@/components/ui'
import {
  coverageStateMeta,
  type OperationalCoverageState,
} from '@/features/operational-workspace/data'

export function CoverageStateBadge({ state }: { state: OperationalCoverageState }) {
  const meta = coverageStateMeta[state]

  return (
    <Badge tone={meta.tone} className={meta.badgeClass}>
      {meta.label}
    </Badge>
  )
}