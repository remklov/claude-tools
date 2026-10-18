// Detects ticket requests such as "starte mit Ticket NV-9" or "nimm das nächste Ticket".

const START_VERBS = '(?:starte?|beginne?|nimm|arbeite\\s+an|übernimm|mach(?:e)?|bearbeite|start|begin|work\\s+on|pick(?:\\s+up)?|take|do|handle)';
const NEXT = /(?:(?:das\s+)?nächste[ns]?\s+(?:ticket|aufgabe|task)|next\s+(?:ticket|task))/i;

export function detectIntent(prompt, idPattern) {
  const text = String(prompt ?? '');
  if (NEXT.test(text) && new RegExp(`${START_VERBS}|^\\s*${NEXT.source}`, 'i').test(text)) return { next: true, ids: [] };
  const idSource = idPattern.replace(/^\^/, '').replace(/\$$/, '');
  const ids = [];
  const pattern = new RegExp(`${START_VERBS}(?:\\s+\\S+){0,5}?\\s+(?:(?:mit|an|on|ticket|task|aufgabe|dem|the)\\s+)*(${idSource})`, 'gi');
  for (const match of text.matchAll(pattern)) ids.push(match[1]);
  if (ids.length) {
    for (const match of text.matchAll(new RegExp(`(?:,|und|and|&)\\s*(${idSource})`, 'g'))) if (!ids.includes(match[1])) ids.push(match[1]);
  }
  return ids.length ? { next: false, ids } : null;
}
