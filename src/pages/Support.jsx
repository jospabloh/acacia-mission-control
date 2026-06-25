import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

export function Support() {
  return (
    <div>
      <PageHeader title="Soporte" subtitle="Tickets en paridad con cada app." />
      <EmptyState icon="support" title="Bandeja de soporte unificada" phase={3}>
        Verás y responderás los tickets de todas las apps desde aquí, sin entrar a cada backend.
      </EmptyState>
    </div>
  )
}
