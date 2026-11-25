import assert from 'node:assert/strict'
import { test } from 'node:test'
import { joinPathFromLink, playedAgo } from './links.ts'

test('an invite link in any common shape opens the join page', () => {
  assert.equal(joinPathFromLink('https://table.example.com/?invite=abc&room=r1'), '/join?invite=abc&room=r1')
  assert.equal(joinPathFromLink('  http://192.168.1.5:3000/?invite=abc&room=r1&role=dm  '), '/join?invite=abc&room=r1&role=dm')
  assert.equal(joinPathFromLink('/join?invite=abc'), '/join?invite=abc')
  assert.equal(joinPathFromLink('?invite=abc&room=r1'), '/join?invite=abc&room=r1')
  assert.equal(joinPathFromLink('https://example.com/?room=r1'), undefined, 'a room link without an invite is not an invite')
  assert.equal(joinPathFromLink('hello'), undefined)
  assert.equal(joinPathFromLink(''), undefined)
})

test('last played reads as a short relative time in Thai', () => {
  const now = Date.parse('2026-11-25T12:00:00Z')
  assert.match(playedAgo('2026-11-25T11:55:00Z', now), /5 นาที/)
  assert.match(playedAgo('2026-11-25T09:00:00Z', now), /3 ชั่วโมง/)
  assert.match(playedAgo('2026-11-23T12:00:00Z', now), /2 วัน|เมื่อวานซืน/)
})
