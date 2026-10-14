import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import { frFR } from '@mui/material/locale'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './features/auth/components/AppLayout'
import { RequireSession } from './features/auth/components/RequireSession'
import { SessionProvider } from './features/auth/hooks/useSession'
import { RequireAdmin } from './features/auth/components/RequireAdmin'
import { DailyBatchPage } from './features/batches/pages/DailyBatchPage'
import { DecisionQueuePage } from './features/decisions/pages/DecisionQueuePage'
import { ImportsPage } from './features/imports/pages/ImportsPage'
import { PoliciesPage } from './features/policies/pages/PoliciesPage'
import { RequireProfile } from './features/profiles/components/RequireProfile'
import { RequireProfileLoaded } from './features/profiles/hooks/useProfile'
import { LoginPage } from './features/auth/pages/LoginPage'
import { JournalPage } from './features/audit/pages/JournalPage'
import { GroupsPage } from './features/groups/pages/GroupsPage'
import { HomePage } from './features/home/pages/HomePage'
import { ScopesPage } from './features/scopes/pages/ScopesPage'
import { UsersImportPage } from './features/users/pages/UsersImportPage'
import { UsersPage } from './features/users/pages/UsersPage'
import { NotifyProvider } from './shared/notify'

const theme = createTheme({ palette: { primary: { main: '#1565c0' } } }, frFR)

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <SessionProvider>
          <NotifyProvider>
            <Routes>
              <Route path="/connexion" element={<LoginPage />} />
              <Route element={<RequireSession />}>
                {/* rule-recouvrement-session-profile: the profile is known before any protected render. */}
                <Route element={<RequireProfileLoaded />}>
                  <Route element={<AppLayout />}>
                    <Route path="/" element={<HomePage />} />
                    <Route element={<RequireAdmin />}>
                      <Route path="/utilisateurs" element={<UsersPage />} />
                      <Route path="/groupes" element={<GroupsPage />} />
                      <Route path="/perimetres" element={<ScopesPage />} />
                      <Route path="/utilisateurs/import" element={<UsersImportPage />} />
                    </Route>
                    {/* rule-recouvrement-screen-guard: the Journal is open to the administrator and the supervisor. */}
                    <Route element={<RequireProfile profiles={['supervisor']} admin />}>
                      <Route path="/journal" element={<JournalPage />} />
                    </Route>
                    <Route element={<RequireProfile profiles={['supervisor']} />}>
                      <Route path="/imports" element={<ImportsPage />} />
                      <Route path="/politique" element={<PoliciesPage />} />
                    </Route>
                    <Route element={<RequireProfile profiles={['supervisor']} />}>
                      {/* rule-recouvrement-screen-batch */}
                      <Route path="/lot-du-jour" element={<DailyBatchPage />} />
                    </Route>
                    <Route element={<RequireProfile profiles={['supervisor']} />}>
                      {/* rule-recouvrement-screen-queue */}
                      <Route path="/file-de-decisions" element={<DecisionQueuePage />} />
                    </Route>
                    {/* Later lots add their protected pages here. */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Route>
              </Route>
            </Routes>
          </NotifyProvider>
        </SessionProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
