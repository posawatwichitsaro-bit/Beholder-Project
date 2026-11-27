import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { appVersion, releaseName } from '../shared/version.ts'

test('the shown release matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.equal(releaseName('0.12.0'), '0.12')
  assert.equal(appVersion, releaseName(pkg.version))
})
