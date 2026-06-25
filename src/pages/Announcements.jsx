import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

export function Announcements() {
  return (
    <div>
      <PageHeader title="Comunicados" subtitle="Anuncios al portafolio." />
      <EmptyState icon="announce" title="Comunicados del portafolio" phase={4}>
        Redacta y publica anuncios a tenants o apps específicas, con programación y registro de envío.
      </EmptyState>
    </div>
  )
}
