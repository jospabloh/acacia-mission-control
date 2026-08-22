import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './lib/auth/AuthProvider.jsx'
import { ThemeProvider } from './lib/theme/ThemeProvider.jsx'
import ThemeSwitcher from './components/ThemeSwitcher.jsx'
import { LoginGate } from './components/LoginGate.jsx'
import { Layout } from './components/Layout.jsx'
import { Dashboard } from './pages/Dashboard.jsx'
import { Licenses } from './pages/Licenses.jsx'
import { Tenants } from './pages/Tenants.jsx'
import { Sessions } from './pages/Sessions.jsx'
import { Products } from './pages/Products.jsx'
import { Revenue } from './pages/Revenue.jsx'
import { CRM } from './pages/CRM.jsx'
import { Analytics } from './pages/Analytics.jsx'
import { Support } from './pages/Support.jsx'
import { Announcements } from './pages/Announcements.jsx'
import { Health } from './pages/Health.jsx'
import { WriteControl } from './pages/WriteControl.jsx'
import { Settings } from './pages/Settings.jsx'
import { AppDetail } from './pages/AppDetail.jsx'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <LoginGate>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="licenses" element={<Licenses />} />
                <Route path="tenants" element={<Tenants />} />
                <Route path="sessions" element={<Sessions />} />
                <Route path="products" element={<Products />} />
                <Route path="revenue" element={<Revenue />} />
                <Route path="crm" element={<CRM />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="support" element={<Support />} />
                <Route path="announcements" element={<Announcements />} />
                <Route path="health" element={<Health />} />
                <Route path="write-control" element={<WriteControl />} />
                <Route path="settings" element={<Settings />} />
                <Route path="apps/:appId" element={<AppDetail />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </LoginGate>
      </AuthProvider>
      <ThemeSwitcher />
    </ThemeProvider>
  )
}
