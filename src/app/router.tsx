import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'

import { AppShell } from '@/features/core/components/app-shell'
import {
  RequireAuth,
  RequireRole,
} from '@/features/core/components/route-guards'
import { AssignmentsPage } from '@/features/assignments/pages/assignments-page'
import { NotFoundPage } from '@/features/core/pages/not-found-page'
import { PlaceholderPage } from '@/features/core/pages/placeholder-page'
import { RoleHomeRedirect } from '@/features/core/pages/role-home-redirect'
import { UnauthorizedPage } from '@/features/core/pages/unauthorized-page'
import { AuditDashboardPage } from '@/features/auditoria/pages/audit-dashboard-page'
import { SignInPage } from '@/features/auth/sign-in-page'
import { BeneficiaryDetailPage } from '@/features/teleoperadora/pages/beneficiary-detail-page'
import { PortfolioPage } from '@/features/teleoperadora/pages/portfolio-page'
import { TeleoperatorHomePage } from '@/features/teleoperadora/pages/teleoperator-home-page'
import { UsersPage } from '@/features/users/pages/users-page'

function ShellRoute() {
  const location = useLocation()

  return <AppShell key={location.pathname}><Outlet /></AppShell>
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<SignInPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <RoleHomeRedirect />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <ShellRoute />
          </RequireAuth>
        }
      >
        <Route path="/unauthorized" element={<UnauthorizedPage />} />

        <Route
          path="/auditoria"
          element={
            <RequireRole allowedRoles={['admin', 'super_admin']}>
              <AuditDashboardPage />
            </RequireRole>
          }
        />

        <Route
          path="/users"
          element={
            <RequireRole allowedRoles={['admin', 'super_admin']}>
              <UsersPage />
            </RequireRole>
          }
        />

        <Route
          path="/assignments"
          element={
            <RequireRole allowedRoles={['admin', 'super_admin']}>
              <AssignmentsPage />
            </RequireRole>
          }
        />

        <Route
          path="/teleoperadora"
          element={
            <RequireRole allowedRoles={['teleoperadora']}>
              <Outlet />
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="/teleoperadora/inicio" replace />} />
          <Route path="inicio" element={<TeleoperatorHomePage />} />
          <Route path="cartera" element={<PortfolioPage />} />
          <Route path="beneficiarios/:beneficiaryId" element={<BeneficiaryDetailPage />} />
          <Route
            path="seguimientos"
            element={
              <PlaceholderPage
                title="Seguimientos"
                description="La exploracion global de followup_events queda fuera de esta fase."
              />
            }
          />
          <Route
            path="estado"
            element={
              <PlaceholderPage
                title="Estado de seguimiento"
                description="La bandeja consolidada por estado se mantiene en la cartera operativa de esta fase."
              />
            }
          />
          <Route
            path="interacciones"
            element={
              <PlaceholderPage
                title="Historial de interacciones"
                description="El historial detallado esta disponible dentro de la ficha beneficiario implementada en esta fase."
              />
            }
          />
        </Route>

        <Route
          path="/admin"
          element={
            <RequireRole allowedRoles={['admin']}>
              <Outlet />
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="/admin/inicio" replace />} />
          <Route
            path="inicio"
            element={
              <PlaceholderPage
                title="Inicio admin"
                description="La fase actual deja listo el shell y las protecciones para implementar modulos administrativos despues."
              />
            }
          />
          <Route
            path="beneficiarios"
            element={
              <PlaceholderPage
                title="Beneficiarios"
                description="La vista administrativa global queda fuera del alcance actual."
              />
            }
          />
          <Route
            path="auditoria"
            element={
              <Navigate to="/auditoria" replace />
            }
          />
        </Route>

        <Route
          path="/super-admin"
          element={
            <RequireRole allowedRoles={['super_admin']}>
              <Outlet />
            </RequireRole>
          }
        >
          <Route index element={<Navigate to="/super-admin/inicio" replace />} />
          <Route
            path="inicio"
            element={
              <PlaceholderPage
                title="Inicio super admin"
                description="La infraestructura de routing ya discrimina el rol y reserva este espacio para la siguiente fase."
              />
            }
          />
          <Route
            path="beneficiarios"
            element={
              <PlaceholderPage
                title="Beneficiarios"
                description="La operacion global queda reservada para una implementacion posterior."
              />
            }
          />
          <Route
            path="auditoria"
            element={
              <Navigate to="/auditoria" replace />
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}