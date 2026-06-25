// Operational pillars of Mission Control. Per-app links are generated from the
// registry (see <Nav>). `minRole` gates a pillar; `phase` marks what's live vs.
// roadmap so the UI can badge "pronto".
export const PILLARS = [
  { to: '/',              label: 'Dashboard',   icon: 'dashboard', minRole: 'viewer', phase: 0 },
  { to: '/licenses',      label: 'Licencias',   icon: 'license',   minRole: 'viewer', phase: 1 },
  { to: '/revenue',       label: 'Ingresos',    icon: 'revenue',   minRole: 'viewer', phase: 1 },
  { to: '/crm',           label: 'CRM',         icon: 'crm',       minRole: 'viewer', phase: 1 },
  { to: '/analytics',     label: 'Analítica',   icon: 'analytics', minRole: 'viewer', phase: 2 },
  { to: '/support',       label: 'Soporte',     icon: 'support',   minRole: 'admin',  phase: 3 },
  { to: '/announcements', label: 'Comunicados', icon: 'announce',  minRole: 'admin',  phase: 4 },
  { to: '/health',        label: 'Salud',       icon: 'health',    minRole: 'viewer', phase: 5 },
  { to: '/write-control', label: 'Control',     icon: 'control',   minRole: 'admin',  phase: 6 },
  { to: '/settings',      label: 'Ajustes',     icon: 'settings',  minRole: 'owner',  phase: 8 },
]
