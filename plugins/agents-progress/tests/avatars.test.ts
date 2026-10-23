import { expect, test } from 'claude-code/testing'

import { NEUTRAL, avatarOf, crab } from '../hooks/avatars'

const AREAS = [
  ['frontend', 'painter'],
  ['backend', 'chef'],
  ['infra', 'engineer'],
  ['infrastructure', 'engineer'],
] as const

const TIERS = [
  ['s', '#1D9E75', 'S'],
  ['m', '#378ADD', 'M'],
  ['l', '#BA7517', 'L'],
  ['xl', '#D85A30', 'XL'],
] as const

test("an implementer dresses for its task's single area and wears its tier colour and badge", () => {
  for (const [area, costume] of AREAS) {
    for (const [tier, accent, badge] of TIERS) {
      expect(avatarOf(`dev-workflow:implementer-${tier}`, [area])).toEqual({ costume, accent, badge })
    }
  }
})

test('an implementer of a mixed, unknown or missing area is plain, with its tier badge', () => {
  for (const areas of [[], ['frontend', 'backend'], ['app']]) {
    expect(avatarOf('dev-workflow:implementer-l', areas)).toEqual({ costume: 'plain', accent: '#BA7517', badge: 'L' })
  }
  expect(avatarOf('dev-workflow:implementer-s')).toEqual({ costume: 'plain', accent: '#1D9E75', badge: 'S' })
})

test('the reviewer, Explore and other agents get their costume without a badge', () => {
  expect(avatarOf('dev-workflow:reviewer', ['backend'])).toEqual({ costume: 'detective', accent: NEUTRAL, badge: null })
  expect(avatarOf('Explore')).toEqual({ costume: 'pirate', accent: NEUTRAL, badge: null })
  expect(avatarOf('general-purpose')).toEqual({ costume: 'plain', accent: NEUTRAL, badge: null })
  expect(avatarOf('implementer-m', ['backend'])).toEqual({ costume: 'plain', accent: NEUTRAL, badge: null })
})

test('a crab draws its costume class, its accent and its badge', () => {
  const svg = crab(avatarOf('dev-workflow:implementer-l', ['frontend']), 0, 0, true)
  expect(svg).toContain('class="c-painter run"')
  expect(svg).toContain('fill="#BA7517"')
  expect(svg).toContain('>L</text>')
  expect(crab(avatarOf('dev-workflow:reviewer'), 0, 0, false)).not.toContain('</text>')
})
