import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader.jsx'
import { PortfolioSections } from '../components/PortfolioSections.jsx'
import { usePortfolioData, SECTIONS } from '../lib/usePortfolioData.js'

const CAT_LABEL = Object.fromEntries(SECTIONS.map((s) => [s.key, s.label]))

export function Products() {
  const [params] = useSearchParams()
  const cat = params.get('cat') // 'app' | 'freeware' | 'site' | null (= all)
  const { byCat, stats, sessByApp, byApp, hasKpis, error } = usePortfolioData()

  return (
    <div>
      <PageHeader
        title={cat ? CAT_LABEL[cat] ?? 'Productos' : 'Productos'}
        subtitle={cat ? 'Detalle de esta categoría del portafolio.' : 'Todo lo que opera ACACIA, por categoría.'}
      />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">No se pudo leer el registro: {error}</p>}
      <PortfolioSections byCat={byCat} stats={stats} sessByApp={sessByApp} byApp={byApp} hasKpis={hasKpis} onlyCategory={cat} />
    </div>
  )
}
