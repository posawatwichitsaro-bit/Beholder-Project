import { readFile, writeFile } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// Coordinates and font sizes correspond to the English SRD 5.2.1 PDF.
const document = await getDocument({ data: new Uint8Array(await readFile(process.argv[2])), useSystemFonts: true }).promise
const monsters = []
let block
for (let page = 258; page <= 364; page++) {
  const content = await (await document.getPage(page)).getTextContent()
  for (const item of content.items) {
    const str = item.str?.trim()
    if (!str || item.transform[5] < 35) continue
    if (item.height === 15) {
      if (block?.name === 'Gray' && str === 'Ooze') { block.name += ' Ooze'; continue }
      block = { name: str, page, fragments: [] }
      monsters.push(block)
    } else if (item.height > 15) block = undefined
    else if (block) block.fragments.push({ str, height: item.height })
  }
}
const catalog = monsters.map(({ name, page, fragments }) => {
  const text = fragments.map(item => item.str).join(' ').replace(/−/g, '-').replace(/\bW IS\b/gi, 'Wis').replace(/\bI NT\b/gi, 'Int').replace(/\bD EX\b/gi, 'Dex')
  const field = (pattern) => {
    const match = text.match(pattern)
    if (!match) throw Error(name + ' missing ' + pattern + ' in ' + text.slice(0,600))
    return match[1]
  }
  const abilities = Object.fromEntries(['STR','DEX','CON','INT','WIS','CHA'].map(key => [key, +field(new RegExp(key.split('').join('\\s*') + '\\s+(\\d+)', 'i'))]))
  const type = field(/^(?:Tiny|Small|Medium|Large|Huge|Gargantuan)\s+(.+?),/i)
  const fieldNames = new Set(['AC', 'HP', 'Speed', 'Skills', 'Resistances', 'Immunities', 'Vulnerabilities', 'Gear', 'Senses', 'Languages', 'CR'])
  const statBlock = fragments.map((item, i) => {
    const next = fragments[i + 1]
    const actionTitle = item.height === 9.5 && item.str.endsWith('.') && next?.height === 9.5 && item.str.split(' ').length <= 4
    const newLine = fieldNames.has(item.str) || item.height === 12 || fragments[i - 1]?.height === 12 || actionTitle
    return (newLine ? '\n' : ' ') + item.str
  }).join('').trim().replace(/\bW IS\b/g, 'Wis').replace(/\bI NT\b/g, 'Int').replace(/\bD EX\b/g, 'Dex')
    .replace(/([a-z])- ([a-z])/g, '$1$2')
  return { name, page, size: text.split(' ')[0], type, cr: field(/\bCR\s+([\d/]+)/), ac: +field(/\bAC\s+(\d+)/), hp: +field(/\bHP\s+(\d+)/),
    initiative: +field(/Initiative\s+([+-]?\d+)/), speed: Number(text.match(/Speed\s+(\d+)/)?.[1] ?? 0), abilities, statBlock }
})
if (catalog.length !== 330 || new Set(catalog.map(m => m.name)).size !== 330) throw Error('Unexpected monster count')
await writeFile('public/data/srd-monsters.json', JSON.stringify(catalog) + '\n')
