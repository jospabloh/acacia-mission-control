import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

export function Health() {
  return (
    <div>
      <PageHeader title="Salud" subtitle="Uptime, costos y alertas." />
      <EmptyState icon="health" title="Salud y costos del portafolio" phase={5}>
        Latencia y disponibilidad por app, costos de infraestructura y alertas accionables.
      </EmptyState>
    </div>
  )
}
