// Vocabulario de tipos de lead + su presentación en el CRM, en un solo lugar.
//
// `LEAD_TYPES` es un espejo literal de `LEAD_TYPES` en api/_lib/leadType.js —
// el cliente no puede importar código de servidor (regla de CLAUDE.md), así
// que la copia vive aquí y leadTypes.test.js falla si se separan de la fuente
// del servidor. `TYPE_LABEL`/`TYPE_TONE`/`TYPE_FILTERS` viven junto a ella (no
// dentro de ella: son presentación — etiqueta en español, tono de color, orden
// en el filtro — no el vocabulario en sí) para que CRM.jsx pueda importarlos y
// para que el mismo test pueda comprobar que ninguno de los tres se quedó
// atrás cuando se agregue un tipo nuevo. Antes eran tres literales sueltos
// dentro de CRM.jsx, sin ninguna prueba que los atara a `LEAD_TYPES`.
export const LEAD_TYPES = ['soporte', 'mejora', 'idea']

// `type` distingue un envío de Soporte a Apps (acaciaco-site) de un lead de
// ventas ordinario (`null` — el significado original y único de la tabla).
export const TYPE_LABEL = { soporte: 'Soporte', mejora: 'Mejora', idea: 'Idea / app nueva' }
export const TYPE_TONE = { soporte: 'bad', mejora: 'info', idea: 'ok' }
export const TYPE_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'sales', label: 'Ventas' },
  { value: 'soporte', label: 'Soporte' },
  { value: 'mejora', label: 'Mejora' },
  { value: 'idea', label: 'Idea / app nueva' },
]
