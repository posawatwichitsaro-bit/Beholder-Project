import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { extractBeyondFields, maxImportBytes, parseBeyondFields } from '../shared/dndBeyond.ts'

export async function importBeyondPdf(file: File) {
  if (file.size > maxImportBytes) throw new Error('รองรับ PDF ขนาดไม่เกิน 20 MB')
  GlobalWorkerOptions.workerSrc = workerUrl
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0 })
  try { return parseBeyondFields(await extractBeyondFields(await task.promise)) }
  finally { await task.destroy() }
}
