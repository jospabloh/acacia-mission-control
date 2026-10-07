// Operational pillars of Mission Control. Per-app links are generated from the
// registry (see <Nav>). `minRole` gates a pillar. (All pillars are live; the
// former `phase` roadmap badges were removed once F1–F8 shipped.)
export const PILLARS = [
  { to: '/',              label: 'Dashboard',   icon: 'dashboard', minRole: 'viewer' },
  { to: '/licenses',      label: 'Licencias',   icon: 'license',   minRole: 'viewer' },
  { to: '/revenue',       label: 'Ingresos',    icon: 'revenue',   minRole: 'viewer' },
  { to: '/crm',           label: 'CRM',         icon: 'crm',       minRole: 'viewer' },
  { to: '/analytics',     label: 'Analítica',   icon: 'analytics', minRole: 'viewer' },
  { to: '/support',       label: 'Soporte',     icon: 'support',   minRole: 'admin'  },
  { to: '/testimonials',  label: 'Testimonios', icon: 'star',      minRole: 'admin'  },
  { to: '/announcements', label: 'Comunicados', icon: 'announce',  minRole: 'admin'  },
  { to: '/health',        label: 'Salud',       icon: 'health',    minRole: 'viewer' },
  { to: '/write-control', label: 'Control',     icon: 'control',   minRole: 'admin'  },
  { to: '/settings',      label: 'Ajustes',     icon: 'settings',  minRole: 'owner'  },
]
