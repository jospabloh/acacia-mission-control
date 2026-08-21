// El catálogo del cliente (src/lib/licenseCatalog.js) es una copia a mano del
// modelo de licencias del servidor, porque el cliente no puede importar código
// de api/_lib. Esta prueba es lo que impide que se separen: compara app por app
// y falla si el servidor gana una app, un plan, un estado o una fecha que el
// panel no ofrece — que es exactamente cómo rumbo se quedó sin "Solo lectura" y
// radar sin ningún control durante meses.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LICENSE_CATALOG } from './licenseCatalog.js'
import { licenseCapabilities, licenseControlAppIds } from '../../api/_lib/licenseControl.js'

test('el catálogo del panel cubre todas las apps del servidor', () => {
  assert.deepEqual(Object.keys(LICENSE_CATALOG).sort(), licenseControlAppIds().sort())
})

test('cada app declara las mismas capacidades en el panel y en el servidor', () => {
  for (const appId of licenseControlAppIds()) {
    assert.deepEqual(LICENSE_CATALOG[appId], licenseCapabilities(appId), `capacidades distintas para ${appId}`)
  }
})
