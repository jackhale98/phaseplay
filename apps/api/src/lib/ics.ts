/** Minimal RFC 5545 writer for subscription feeds. */
const esc = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 74) {
    let cut = 74;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
}

export type IcsEvent = {
  uid: string;
  start: number;
  end: number;
  summary: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  cancelled?: boolean;
  updated: number;
  sequence: number;
};

export function buildIcs(name: string, events: IcsEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Phaseplay//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
    'X-PUBLISHED-TTL:PT30M',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@phaseplay.app`,
      `DTSTAMP:${stamp(e.updated)}`,
      `LAST-MODIFIED:${stamp(e.updated)}`,
      `SEQUENCE:${e.sequence}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.end)}`,
      `SUMMARY:${esc((e.cancelled ? 'Cancelled: ' : '') + e.summary)}`,
    );
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push(`STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
