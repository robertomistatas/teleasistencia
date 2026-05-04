import { Badge } from '@/components/ui'
import { followupStatusMeta } from '@/features/teleoperadora/data'
import type { FollowupStatus } from '@/lib/types'

export function StatusBadge({ status }: { status: FollowupStatus }) {
  const meta = followupStatusMeta[status]

  return <Badge tone={meta.tone}>{meta.label}</Badge>
}