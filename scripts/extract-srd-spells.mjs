/**
 * Build public/data/srd-spells.json from the English SRD 5.2.1 PDF (CC BY 4.0).
 *
 *   node scripts/extract-srd-spells.mjs <SRD_CC_v5.2.1.pdf> public/data/srd-spells.json
 *
 * Spell descriptions run from page 107 to page 175. Each spell is a 12 pt
 * heading (names in small caps arrive in pieces), a "Level N School (classes)"
 * line, four labelled fields (Casting Time, Range, Components, Duration), then
 * the text. The parts the table automates (attack or save, damage, healing,
 * area, slot scaling, a condition on a failed save) are read from that text;
 * anything not read that way stays in the description for the table to read.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const [pdfPath, outputPath] = process.argv.slice(2)
if (!pdfPath || !outputPath) throw Error('Usage: node scripts/extract-srd-spells.mjs <SRD_CC_v5.2.1.pdf> <srd-spells.json>')
const pdf = await getDocument({ data: new Uint8Array(await readFile(pdfPath)), useSystemFonts: true }).promise

// Font ids change from run to run in pdfjs, so the layout is read from text size and wording only.
const size = item => Math.round(item.height * 10) / 10
const fieldNames = new Set(['Casting Time', 'Range', 'Components', 'Component', 'Duration'])
const spells = []
let spell
for (let page = 107; page <= 175; page++) {
  const items = (await (await pdf.getPage(page)).getTextContent()).items.filter(item => item.str?.trim() && item.transform[5] > 35)
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    // A spell heading: 12 pt (small-caps pieces on the same line are smaller), followed by its "Level N …" / "… Cantrip" line.
    if (size(item) === 12) {
      let name = item.str
      let end = index
      while (items[end + 1] && Math.abs(items[end + 1].transform[5] - item.transform[5]) < 1 && size(items[end + 1]) < 12) {
        name += items[++end].str.toLowerCase()
      }
      const next = items[end + 1]
      if (next && size(next) === 10 && /^(Level \d|\w+ Cantrip)/.test(next.str.trim())) {
        spell = { name: name.replace(/\s+/g, ' ').trim(), page, subtitle: [], fields: {}, text: [] }
        spells.push(spell)
        index = end
        continue
      }
    }
    if (!spell) continue
    const label = item.str.trim().replace(/:$/, '')
    const isLabel = (candidate) => candidate && item !== undefined && candidate.str.trim().endsWith(':') && fieldNames.has(candidate.str.trim().replace(/:$/, ''))
    if (!spell.text.length && isLabel(item)) {
      // Labels are 9.5 or 10 pt. A value runs to the next label; Duration ends with its own line (the text starts after).
      const values = []
      while (items[index + 1] && !isLabel(items[index + 1]) && (label !== 'Duration' || Math.abs(items[index + 1].transform[5] - item.transform[5]) < 1)) values.push(items[++index].str)
      spell.fields[label] = values.join(' ').trim()
      continue
    }
    if (size(item) === 10 && !spell.text.length && !Object.keys(spell.fields).length) { spell.subtitle.push(item.str); continue }
    spell.text.push({ str: item.str, bold: /^(Using a Higher-Level Spell Slot\.|Cantrip Upgrade\.)$/.test(item.str.trim()) })
  }
}
await pdf.cleanup?.()

/** Join PDF lines: hyphen at a line end joins the word, unless the joined word is not a word (keep "level-1"). */
function joinText(parts) {
  let text = ''
  for (const part of parts) {
    const piece = part.str
    if (text.endsWith('-') && /^[a-z]/.test(piece) && !/\d-$/.test(text)) text = text.slice(0, -1) + piece
    else text += (text && !text.endsWith(' ') ? ' ' : '') + piece
  }
  return text.replace(/\s+/g, ' ').replace(/ ([,.;:])/g, '$1').trim()
}

const abilityOf = { Strength: 'STR', Dexterity: 'DEX', Constitution: 'CON', Intelligence: 'INT', Wisdom: 'WIS', Charisma: 'CHA' }
const slug = name => 'srd-5.2.1:spell:' + name.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const catalog = spells.map(({ name, page, subtitle, fields, text }) => {
  const header = subtitle.join(' ').replace(/\s+/g, ' ')
  const levelMatch = /^Level (\d) (\w+)(?: \(([^)]*)\))?/.exec(header)
  const cantripMatch = /^(\w+) Cantrip(?: \(([^)]*)\))?/.exec(header)
  if (!levelMatch && !cantripMatch) throw Error(name + ': no level line in "' + header + '"')
  const level = levelMatch ? Number(levelMatch[1]) : 0
  const school = levelMatch ? levelMatch[2] : cantripMatch[1]
  const classes = (levelMatch ? levelMatch[3] : cantripMatch[2] ?? '').split(',').map(entry => entry.trim()).filter(Boolean)
  // Split the body into the main text and the "Using a Higher-Level Spell Slot." / "Cantrip Upgrade." paragraphs.
  const sections = { main: [] }
  let current = 'main'
  for (const part of text) {
    if (part.bold && /Higher-Level Spell Slot|Cantrip Upgrade/.test(part.str)) { current = /Cantrip/.test(part.str) ? 'cantrip' : 'higher'; sections[current] = []; continue }
    sections[current].push(part)
  }
  const description = joinText(sections.main)
  const higher = sections.higher ? joinText(sections.higher) : undefined
  const cantripText = sections.cantrip ? joinText(sections.cantrip) : undefined
  const duration = fields.Duration ?? ''
  const castingTime = fields['Casting Time'] ?? ''
  const attack = /make (?:a|one) (melee|ranged) spell attack/i.exec(description)?.[1]?.toLowerCase()
  const save = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/.exec(description)?.[1]
  const damage = /(\d+d\d+(?: ?\+ ?\d+)?) (Acid|Bludgeoning|Cold|Fire|Force|Lightning|Necrotic|Piercing|Poison|Psychic|Radiant|Slashing|Thunder) damage/.exec(description)
  const healing = /regains? (?:a number of )?Hit Points equal to (\d+d\d+)( plus your spellcasting ability modifier)?/i.exec(description)
  const area = /(\d+)-foot(?:-radius|-long|-wide|-tall)?(?:,? \d+-foot-(?:wide|tall|high))? (Sphere|Cone|Cube|Line|Cylinder|Emanation)/.exec(description)
  // The condition a failed save gives ("…must succeed on a Wisdom saving throw or have the Paralyzed condition").
  const condition = /(?:has|have|gains?) the (Blinded|Charmed|Deafened|Frightened|Grappled|Incapacitated|Paralyzed|Petrified|Poisoned|Prone|Restrained|Stunned|Unconscious) condition/.exec(description)?.[1]
  const perSlot = higher && /(?:increases|healing increases|damage increases)[^.]*?by (\d+d\d+) for each spell slot level above (\d)/i.exec(higher)
  return {
    id: slug(name), name, level, school, classes,
    castingTime, range: fields.Range ?? '', components: fields.Components ?? fields.Component ?? '', duration,
    concentration: /Concentration/i.test(duration), ritual: /Ritual/i.test(castingTime),
    ...(attack ? { attack } : {}),
    ...(save ? { save: abilityOf[save], half: /half as much damage/i.test(description) } : {}),
    ...(damage ? { damage: damage[1].replace(/\s/g, ''), damageType: damage[2].toLowerCase() } : {}),
    ...(healing ? { healing: healing[1], healingAddsModifier: Boolean(healing[2]) } : {}),
    ...(area ? { area: { shape: area[2], size: Number(area[1]) } } : {}),
    ...(condition ? { condition } : {}),
    ...(perSlot ? { perSlot: perSlot[1] } : {}),
    ...(cantripText && /increases by (\d+d\d+)/.test(cantripText) ? { cantripScaling: /increases by (\d+d\d+)/.exec(cantripText)[1] } : {}),
    description, ...(higher ? { higherLevels: higher } : {}), ...(cantripText ? { cantripUpgrade: cantripText } : {}),
    source: { pdfPage: page }
  }
})
const output = {
  schemaVersion: 1,
  attribution: 'This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.',
  spells: catalog
}
await writeFile(outputPath, JSON.stringify(output, null, 1) + '\n')
console.log(catalog.length + ' spells')
