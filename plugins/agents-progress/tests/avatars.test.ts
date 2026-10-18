import { expect, test } from 'claude-code/testing'

import { NEUTRAL, avatarOf, crab, parseAgentType } from '../hooks/avatars'

const TIERS = [
  ['s', '#1D9E75', 'S'],
  ['m', '#378ADD', 'M'],
  ['l', '#BA7517', 'L'],
  ['xl', '#D85A30', 'XL'],
] as const

test('agent types parse into role and tier, with or without the plugin prefix', () => {
  expect(parseAgentType('dev-workflow:implementer-m')).toEqual({ role: 'implementer', tier: 'm', bare: 'implementer-m' })
  expect(parseAgentType('implementer-xl')).toEqual({ role: 'implementer', tier: 'xl', bare: 'implementer-xl' })
  expect(parseAgentType('dev-workflow:reviewer')).toEqual({ role: 'reviewer', tier: null, bare: 'reviewer' })
  expect(parseAgentType('Explore').role).toBe(null)
})

test('an implementer wears the costume of its task area and its tier colour and badge', () => {
  for (const [tier, accent, badge] of TIERS) {
    expect(avatarOf(`dev-workflow:implementer-${tier}`, ['frontend'])).toEqual({ costume: 'painter', accent, badge })
    expect(avatarOf(`dev-workflow:implementer-${tier}`, ['backend', 'data'])).toEqual({ costume: 'chef', accent, badge })
    expect(avatarOf(`dev-workflow:implementer-${tier}`, ['infra'])).toEqual({ costume: 'engineer', accent, badge })
  }
})

test('an implementer across areas, or without a known task, is a plain crab with its badge', () => {
  expect(avatarOf('dev-workflow:implementer-l', ['frontend', 'backend'])).toEqual({ costume: 'plain', accent: '#BA7517', badge: 'L' })
  expect(avatarOf('dev-workflow:implementer-s')).toEqual({ costume: 'plain', accent: '#1D9E75', badge: 'S' })
})

test('reviewer, investigator, Explore and other agents get their costume without a badge', () => {
  expect(avatarOf('dev-workflow:reviewer')).toEqual({ costume: 'detective', accent: NEUTRAL, badge: null })
  expect(avatarOf('dev-workflow:investigator')).toEqual({ costume: 'scientist', accent: NEUTRAL, badge: null })
  expect(avatarOf('Explore')).toEqual({ costume: 'pirate', accent: NEUTRAL, badge: null })
  expect(avatarOf('general-purpose')).toEqual({ costume: 'plain', accent: NEUTRAL, badge: null })
})

test('a crab draws its costume class, its accent and its badge', () => {
  const svg = crab(avatarOf('dev-workflow:implementer-l', ['frontend']), 0, 0, true)
  expect(svg).toContain('class="c-painter run"')
  expect(svg).toContain('fill="#BA7517"')
  expect(svg).toContain('>L</text>')
  expect(crab(avatarOf('dev-workflow:investigator'), 0, 0, false)).toContain('class="c-scientist"')
  expect(crab(avatarOf('dev-workflow:reviewer'), 0, 0, false)).not.toContain('</text>')
})
