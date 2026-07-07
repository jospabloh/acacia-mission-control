import { PageHeader, StatCard } from '../components/PageHeader.jsx'
import { PortfolioSections } from '../components/PortfolioSections.jsx'
import { usePortfolioData } from '../lib/usePortfolioData.js'

export function Dashboard() {
  const { apps, stats, byApp, sessByApp, error, hasKpis, byCat, totals } = usePortfolioData()

  return (
    <div>
      <PageHeader title="Portafolio" subtitle="Control y analíticas de todo lo que opera ACACIA — un clic entra al panel de cada app." />

      {error && <p className="mb-4 text-sm text-red-600">No se pudo leer el registro: {error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Productos" value={totals.products} accent hint="en el portafolio" to="/products" />
        <StatCard label="Apps SaaS" value={totals.saas} hint="con backend operable" to="/products?cat=app" />
        <StatCard label="Tenants" value={totals.tenants} hint="clientes sincronizados" to="/tenants" />
        <StatCard label="Licencias activas" value={totals.active} hint="al día de hoy" to="/licenses" />
        <StatCard label="Sesiones activas" value={totals.sessions} hint={`${totals.online} en línea ahora`} to="/sessions" />
      </div>

      <div className="mt-9">
        <PortfolioSections byCat={byCat} stats={stats} sessByApp={sessByApp} byApp={byApp} hasKpis={hasKpis} />
      </div>

      {apps.length === 0 && !error && (
        <p className="mt-6 text-sm text-ink-soft">El registro está vacío. Aplica los seeds.</p>
      )}
    </div>
  )
}
