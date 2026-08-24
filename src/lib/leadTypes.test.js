// El vocabulario de tipos de lead está duplicado a propósito (el cliente no
// puede importar api/_lib) en tres formas dentro de src/lib/leadTypes.js:
// LEAD_TYPES en sí, y las claves de TYPE_LABEL/TYPE_TONE/TYPE_FILTERS que
// CRM.jsx usa para mostrarlo. Esta prueba es lo que impide que se separen —
// mismo patrón que src/lib/licenseCatalog.test.js. Antes de esto, un tipo
// nuevo en api/_lib/leadType.js podía llegar al CRM sin etiqueta, sin tono de
// color y sin entrada en el filtro, en silencio.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LEAD_TYPES as SERVER_LEAD_TYPES } from '../../api/_lib/leadType.js'
import { LEAD_TYPES, TYPE_LABEL, TYPE_TONE, TYPE_FILTERS } from './leadTypes.js'

test('el vocabulario del cliente coincide con el del servidor', () => {
  assert.deepEqual([...LEAD_TYPES].sort(), [...SERVER_LEAD_TYPES].sort())
})

test('TYPE_LABEL tiene una entrada por cada tipo, ni una de más', () => {
  assert.deepEqual(Object.keys(TYPE_LABEL).sort(), [...LEAD_TYPES].sort())
})

test('TYPE_TONE tiene una entrada por cada tipo, ni una de más', () => {
  assert.deepEqual(Object.keys(TYPE_TONE).sort(), [...LEAD_TYPES].sort())
})

test('TYPE_FILTERS ofrece un chip por cada tipo, además de los especiales all/sales', () => {
  const typeValues = TYPE_FILTERS.map((f) => f.value).filter((v) => v !== 'all' && v !== 'sales')
  assert.deepEqual(typeValues.sort(), [...LEAD_TYPES].sort())
})
