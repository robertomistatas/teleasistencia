import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'

import { AppShell } from '@/features/core/components/app-shell'
import {
  RequireAuth,
  RequireRole,
} from '@/features/core/components/route-guards'
import { AssignmentsPage } from '@/features/assignments/pages/assignments-page'
import { NotFoundPage } from '@/features/core/pages/not-found-page'
import { RoleHomeRedirect } from '@/features/core/pages/role-home-redirect'
import { UnauthorizedPage } from '@/features/core/pages/unauthorized-page'
import { AuditDashboardPage } from '@/features/auditoria/pages/audit-dashboard-page'
import { SignInPage } from '@/features/auth/sign-in-page'
import { OperationalDashboardPage } from '@/features/operational-dashboard/pages/operational-dashboard-page'
import { OperationalBeneficiaryPage } from '@/features/operational-workspace/pages/operational-beneficiary-page'
import { OperationalWorkspacePage } from '@/features/operational-workspace/pages/operational-workspace-page'
import { AssignmentImportPage } from '@/features/imports/pages/assignment-import-page'
import { BeneficiaryImportPage } from '@/features/imports/pages/beneficiary-import-page'
import { CallImportMonitoringPage } from '@/features/imports/pages/call-import-monitoring-page'
import { CallLogsImportPage } from '@/features/imports/pages/call-logs-import-page'
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
          path="/imports/assignments"
          element={
            <RequireRole allowedRoles={['admin', 'super_admin']}>
              <AssignmentImportPage />
            </RequireRole>
          }
        />

        <Route
          path="/imports/beneficiaries"
          element={
            <RequireRole allowedRoles={['admin', 'super_admin']}>
              <BeneficiaryImportPage />
            </RequireRole>
          }
        />

        <Route
          path="/imports/calls"
          element={
            <RequireRole allowedRoles={['admin', 'super_admin']}>
              <CallLogsImportPage />
            </RequireRole>
          }
        />

        <Route
          path="/imports/calls/monitoring"
          element={
            <RequireRole allowedRoles={['admin', 'super_admin']}>
              <CallImportMonitoringPage />
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
          <Route path="inicio" element={<OperationalDashboardPage />} />
          <Route path="cartera" element={<OperationalWorkspacePage />} />
          <Route path="beneficiarios/:beneficiaryId" element={<OperationalBeneficiaryPage />} />
          <Route path="seguimientos" element={<OperationalWorkspacePage />} />
          <Route path="estado" element={<OperationalWorkspacePage />} />
          <Route path="interacciones" element={<OperationalWorkspacePage />} />
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
          <Route path="inicio" element={<OperationalDashboardPage />} />
          <Route path="beneficiarios" element={<OperationalWorkspacePage />} />
          <Route path="beneficiarios/:beneficiaryId" element={<OperationalBeneficiaryPage />} />
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
          <Route path="inicio" element={<OperationalDashboardPage />} />
          <Route path="beneficiarios" element={<OperationalWorkspacePage />} />
          <Route path="beneficiarios/:beneficiaryId" element={<OperationalBeneficiaryPage />} />
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
