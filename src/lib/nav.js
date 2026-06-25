// Static navigation = the operational pillars of Mission Control. Per-app links
// are generated dynamically from the registry (see <Nav>). `minRole` gates a
// pillar; danger zone is owner-only.
export const PILLARS = [
  { to: '/',              label: 'Dashboard',      minRole: 'viewer' },
  { to: '/licenses',      label: 'Licencias',      minRole: 'viewer' },
  { to: '/revenue',       label: 'Ingresos',       minRole: 'viewer' },
  { to: '/crm',           label: 'CRM',            minRole: 'viewer' },
  { to: '/analytics',     label: 'Analítica',      minRole: 'viewer' },
  { to: '/support',       label: 'Soporte',        minRole: 'admin'  },
  { to: '/announcements', label: 'Comunicados',    minRole: 'admin'  },
  { to: '/health',        label: 'Salud',          minRole: 'viewer' },
  { to: '/write-control', label: 'Control',        minRole: 'admin'  },
  { to: '/settings',      label: 'Ajustes',        minRole: 'owner'  },
]
