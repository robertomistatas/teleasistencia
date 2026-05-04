import { Link } from 'react-router-dom'

import { PageState, primaryButtonClass } from '@/components/ui'

export function NotFoundPage() {
  return (
    <main className="app-gradient min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center">
        <PageState
          title="Ruta no encontrada"
          description="La pantalla solicitada no existe en esta fase del frontend."
          action={
            <Link
              to="/"
              className={primaryButtonClass}
            >
              Volver al inicio
            </Link>
          }
        />
      </div>
    </main>
  )
}