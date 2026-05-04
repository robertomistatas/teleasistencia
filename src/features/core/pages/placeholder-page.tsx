import { Link } from 'react-router-dom'

import { PageState, primaryButtonClass } from '@/components/ui'

export function PlaceholderPage({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <PageState
      title={title}
      description={description}
      action={
        <Link
          to="/"
          className={primaryButtonClass}
        >
          Volver al inicio por rol
        </Link>
      }
    />
  )
}