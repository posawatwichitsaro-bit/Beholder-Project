import { readFile, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { extractBeyondFields, maxImportBytes, parseBeyondFields } from '../shared/dndBeyond.ts'

async function main() {
  const path = process.argv[2]
  if (!path) throw new Error('Usage: node scripts/import-dndbeyond.ts <character-sheet.pdf>')
  if ((await stat(path)).size > maxImportBytes) throw new Error('PDF exceeds 20 MB')
  // PDF.js may emit optional rendering warnings while its Node module loads.
  // Leave stdout available for the import JSON.
  const log = console.log
  console.log = console.error
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const fontPath = pathToFileURL(resolve(import.meta.dirname, '../node_modules/pdfjs-dist/standard_fonts')).href + '/'
    const task = getDocument({ data: new Uint8Array(await readFile(path)), standardFontDataUrl: fontPath, verbosity: 0 })
    try {
      const result = parseBeyondFields(await extractBeyondFields(await task.promise))
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } finally { await task.destroy() }
  } finally { console.log = log }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
