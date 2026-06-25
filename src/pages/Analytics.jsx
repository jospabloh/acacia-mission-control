import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

export function Analytics() {
  return (
    <div>
      <PageHeader title="Analítica" subtitle="Métricas de web y producto (PostHog)." />
      <EmptyState icon="analytics" title="Analítica en camino" phase={2}>
        Conectaremos PostHog para ver tráfico del sitio y uso por app y tenant en un solo lugar.
      </EmptyState>
    </div>
  )
}
