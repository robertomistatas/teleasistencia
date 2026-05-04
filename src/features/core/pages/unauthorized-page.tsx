import { Link } from 'react-router-dom'

import { PageState, primaryButtonClass } from '@/components/ui'

export function UnauthorizedPage() {
  return (
    <PageState
      title="Acceso restringido"
      description="La ruta existe, pero no corresponde al rol del usuario autenticado."
      action={
        <Link
          to="/"
          className={primaryButtonClass}
        >
          Ir a mi inicio
        </Link>
      }
    />
  )
}