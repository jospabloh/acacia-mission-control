import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

export function WriteControl() {
  return (
    <div>
      <PageHeader title="Control de escritura" subtitle="Operaciones en paridad con cada app." />
      <EmptyState icon="control" title="Operaciones centralizadas" phase={6}>
        Acciones de administración (licencias, miembros, ajustes) sobre cada app desde un solo panel,
        con auditoría.
      </EmptyState>
    </div>
  )
}
