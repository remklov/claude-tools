// Pixel crabs, adapted from the savvy-progress mod
// (https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress):
// the crab body, the chef, engineer, detective and pirate costumes and their
// CSS motion. The painter and scientist costumes and the role/area mapping are new.
//
// MIT License
//
// Copyright (c) 2026 johnnyvizz
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

export type Costume = 'painter' | 'chef' | 'engineer' | 'detective' | 'scientist' | 'pirate' | 'plain'

export type Avatar = {
  costume: Costume
  accent: string
  /** The tier badge (`S` to `XL`), or null for agents without one. */
  badge: string | null
}

export type Role = 'implementer' | 'reviewer' | 'investigator' | 'orchestrator'

export const NEUTRAL = '#888780'

// The one place that maps roles, areas and tiers to costumes and colours.
const AVATARS: {
  readonly costumeByRole: Readonly<Record<string, Costume>>
  readonly costumeByArea: Readonly<Record<string, Costume>>
  readonly tier: Readonly<Record<string, { readonly accent: string; readonly badge: string }>>
} = {
  costumeByRole: { reviewer: 'detective', investigator: 'scientist', Explore: 'pirate' },
  costumeByArea: { frontend: 'painter', backend: 'chef', data: 'chef', infra: 'engineer', tooling: 'engineer' },
  tier: {
    s: { accent: '#1D9E75', badge: 'S' },
    m: { accent: '#378ADD', badge: 'M' },
    l: { accent: '#BA7517', badge: 'L' },
    xl: { accent: '#D85A30', badge: 'XL' },
  },
}

const AGENT_TYPE = /^(?:[^:]+:)?(implementer|reviewer|investigator|orchestrator)(?:-(s|m|l|xl))?$/

// `dev-workflow:implementer-m` → { role: 'implementer', tier: 'm' }; other agent types → role null.
export function parseAgentType(agentType: string): { role: Role | null; tier: string | null; bare: string } {
  const bare = agentType.replace(/^[^:]*:/, '')
  const match = AGENT_TYPE.exec(agentType)
  if (!match) return { role: null, tier: null, bare }
  return { role: (match[1] ?? null) as Role | null, tier: match[2] ?? null, bare }
}

export function avatarOf(agentType: string, areas: readonly string[] = []): Avatar {
  const { role, tier, bare } = parseAgentType(agentType)
  const tierStyle = tier ? AVATARS.tier[tier] : undefined
  const accent = tierStyle?.accent ?? NEUTRAL
  const badge = tierStyle?.badge ?? null
  if (role === 'implementer') {
    const costumes = [...new Set(areas.map(area => AVATARS.costumeByArea[area]).filter((c): c is Costume => Boolean(c)))]
    return { costume: costumes.length === 1 ? (costumes[0] ?? 'plain') : 'plain', accent, badge }
  }
  return { costume: AVATARS.costumeByRole[role ?? bare] ?? 'plain', accent, badge }
}

// A 24x18 crab on a 30x28 grid. The body keeps the brand clay; the accent
// colour lives in the costume.
const CLAY = '#D97757'
const INK = '#1F1E1D'

// `group` puts a pixel in a named group: `bd` (the default) is the body and its
// costume, `la`/`lb` the leg pairs, `it` a prop with its own motion.
type Fill = (x: number, y: number, width: number, height: number, color: string, group?: string) => void

const stamp = (fill: Fill, x: number, y: number, pattern: string[], palette: Record<string, string>, group?: string): void =>
  pattern.forEach((line, rowOffset) =>
    [...line].forEach((char, columnOffset) => {
      const color = palette[char]
      if (color) fill(x + columnOffset, y + rowOffset, 1, 1, color, group)
    }),
  )

// `armGroup` lets a raised claw travel with the prop it holds.
const crabBody = (fill: Fill, armOffset = 0, armGroup?: string): void => {
  fill(7, 10, 16, 12, CLAY)
  fill(3, 14, 4, 4, CLAY)
  fill(23, 14 + armOffset, 4, 4, CLAY, armGroup)
  fill(9, 12, 2, 2, INK)
  fill(19, 12, 2, 2, INK)
  fill(7, 22, 2, 4, CLAY, 'la')
  fill(17, 22, 2, 4, CLAY, 'la')
  fill(11, 22, 2, 4, CLAY, 'lb')
  fill(21, 22, 2, 4, CLAY, 'lb')
}

const COSTUMES: Record<Costume, (fill: Fill, accent: string) => void> = {
  // Beret in the accent colour; the brush strokes.
  painter: (fill, accent) => {
    crabBody(fill, -4, 'it')
    stamp(fill, 5, 4, ['..........aa......', '....aaaaaaaaaa....', '..aaaaaaaaaaaaaa..', '.aaaaaaaaaaaaaaaaa', '..dddddddddddddd..'], { a: accent, d: INK })
    fill(25, 4, 1, 6, '#A0703F', 'it')
    fill(25, 3, 1, 1, '#C9CCD2', 'it')
    fill(24, 0, 3, 3, '#E8505B', 'it')
  },
  // Chef's toque with an accent band; tosses the omelette.
  chef: (fill, accent) => {
    crabBody(fill, -4, 'it')
    stamp(fill, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: accent, d: '#B45F43' })
    fill(22, 8, 7, 2, '#4A4A48', 'it')
    fill(26, 10, 1, 1, '#4A4A48', 'it')
    fill(24, 7, 3, 1, '#F5B731', 'it')
  },
  // Engineer in a hard hat with an accent badge; the wrench turns a bolt.
  engineer: (fill, accent) => {
    crabBody(fill)
    stamp(fill, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    fill(13, 5, 4, 2, accent)
    stamp(fill, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // Detective in a deerstalker; the magnifier sweeps.
  detective: (fill, accent) => {
    crabBody(fill, -4, 'it')
    stamp(fill, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    fill(6, 9, 18, 1, accent)
    stamp(fill, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    fill(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it')
    fill(25, 6, 1, 4, '#7A4A26', 'it')
  },
  // Scientist in goggles and a lab coat; the flask bubbles.
  scientist: (fill, accent) => {
    crabBody(fill, -4, 'it')
    stamp(fill, 7, 16, ['wwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwww', 'wwwwwwkwwkwwwwww', 'wwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwww'], { w: '#F4F3EE', k: '#C9CCD2' })
    stamp(fill, 8, 11, ['.gggg...gggg.', 'gaaaagggaaaag', '.gggg...gggg.'], { g: '#3A3A3C', a: accent })
    stamp(fill, 23, 3, ['.ggg.', '..g..', '..g..', '.gag.', 'gaaag', 'gaaag', '.ggg.'], { g: '#C9CCD2', a: accent }, 'it')
  },
  // Pirate scouting the code; the cutlass fences.
  pirate: fill => {
    crabBody(fill)
    stamp(fill, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    fill(7, 11, 11, 1, INK)
    fill(18, 11, 4, 3, INK)
    fill(27, 6, 1, 9, '#C9CCD2', 'it')
    fill(26, 15, 3, 1, '#7A4A26', 'it')
  },
  plain: fill => crabBody(fill),
}

// Pure CSS, so the compositor animates without redraws. A running crab walks and
// its prop moves; `prefers-reduced-motion` stops all of it.
export const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.c-painter.run .it{transform-origin:50% 100%;animation:paint .5s ease-in-out infinite}
@keyframes paint{50%{transform:rotate(-20deg)}}
.c-chef.run .it{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}
.c-engineer.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-detective.run .it{animation:scan 1s steps(1) infinite}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-pirate.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
.c-scientist.run .it{animation:bub 1s steps(1) infinite}
@keyframes bub{50%{transform:translateY(-1px)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const BADGE_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"

// One crab as an SVG group at (x, y), with the tier badge at its lower right.
export function crab(avatar: Avatar, x: number, y: number, isWalking: boolean): string {
  const groups = new Map<string, string[]>([['bd', []]])
  const fill: Fill = (column, row, width, height, color, group = 'bd') => {
    const rects = groups.get(group) ?? []
    rects.push(`<rect x="${column}" y="${row}" width="${width}" height="${height}" fill="${color}"/>`)
    groups.set(group, rects)
  }
  COSTUMES[avatar.costume](fill, avatar.accent)
  const group = (name: string) => `<g class="${name}">${(groups.get(name) ?? []).join('')}</g>`
  // Props nest inside the body so they ride its bob; legs step on their own.
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${groups.has('it') ? group('it') : ''}</g>`
  const badgeWidth = avatar.badge ? 6 + avatar.badge.length * 6 : 0
  const badge = avatar.badge
    ? `<rect x="${x + 33 - badgeWidth}" y="${y + 22}" width="${badgeWidth}" height="11" rx="3" fill="${avatar.accent}"/><text x="${x + 33 - badgeWidth / 2}" y="${y + 30.5}" text-anchor="middle" font-family="${BADGE_FONT}" font-size="9" font-weight="700" fill="#ffffff">${avatar.badge}</text>`
    : ''
  return `<g transform="translate(${x},${y}) scale(1.1)" shape-rendering="crispEdges"><g class="c-${avatar.costume}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>${badge}`
}
