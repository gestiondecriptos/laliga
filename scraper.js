// Lee las predicciones de MyScorePrediction (Real Madrid, Barcelona, Atlético) y genera data.json
// Node 20, sin librerías. Si algo falla, conserva los datos anteriores y los marca como obsoletos.
const fs = require('fs');
const BASE = 'https://myscoreprediction.com';
const UA = 'Mozilla/5.0 (compatible; laliga-dashboard-personal/1.0)';
const TEAMS = { real: 'real-madrid-cf', barca: 'fc-barcelona', atleti: 'club-atltico-de-madrid' };

const decode = s => s.replace(/&ndash;|&#8211;/g, '–').replace(/&mdash;|&#8212;/g, '—').replace(/&middot;/g, '·')
  .replace(/&times;/g, '×').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"');
const strip = h => decode(h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function parseMatch(html) {
  const t = strip(html), r = {};
  const p = t.match(/AI prediction:\s*(.+?)\s+(\d+)\s*[–-]\s*(\d+)\s+(.+?)\.\s*Win probabilities\s*[—–-]\s*(.+?)\s+(\d+)%,\s*draw\s+(\d+)%,\s*(.+?)\s+(\d+)%/);
  if (p) {
    r.home = p[1]; r.away = p[4];
    r.score = { home: +p[2], away: +p[3] };
    r.probs = { home: +p[6], draw: +p[7], away: +p[9] };
    r.names_consistent = p[5] === p[1] && p[8] === p[4];
  }
  const m = decode(html).match(/exact score (\d+)-(\d+): (\d+)% home win, (\d+)% draw, (\d+)% away win/);
  if (m && r.score) r.meta_consistent = +m[1] === r.score.home && +m[2] === r.score.away && +m[3] === r.probs.home && +m[4] === r.probs.draw && +m[5] === r.probs.away;
  const d = t.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*([A-Za-z]+ \d{1,2}, \d{4})\s*[—–-]\s*(\d{2}:\d{2}) UTC/);
  if (d) { r.date_text = d[1] + ' — ' + d[2] + ' UTC'; const ms = Date.parse(d[1] + ' ' + d[2] + ' UTC'); r.kickoff_iso = isNaN(ms) ? null : new Date(ms).toISOString(); }
  r.matchday = (t.match(/Matchday (\d+)/) || [])[1] || null;
  r.snapshot = (t.match(/Forecast snapshot from (.+?)\.\s/) || [])[1] || null;
  r.confidence = (t.match(/Confidence\s*(High|Medium|Low)/i) || [])[1] || null;
  r.over25 = +(t.match(/\(2\.5\+\)\s*(\d+)%/) || [])[1] || null;
  r.btts = +(t.match(/Both Teams Score\s*(\d+)%/) || [])[1] || null;
  const crests = [...html.matchAll(/https:\/\/crests\.football-data\.org\/[^"'\s)]+/g)].map(x => x[0]);
  r.crest_home = crests[0] || null; r.crest_away = crests.find(c => c !== crests[0]) || null;
  return r;
}
function pick1x2(s) { return s.home > s.away ? '1' : s.home < s.away ? '2' : 'X'; }
function pickByProb(p) { const m = Math.max(p.home, p.draw, p.away); return m === p.home ? '1' : m === p.away ? '2' : 'X'; }

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  const html = await res.text();
  if (res.status !== 200) throw new Error('HTTP ' + res.status + ' en ' + url);
  if (/just a moment|cf-chl/i.test(html)) throw new Error('Página de verificación anti-bot en ' + url);
  return html;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let prev = {}; try { prev = JSON.parse(fs.readFileSync('data.json', 'utf8')); } catch {}
  const out = { updated: new Date().toISOString(), source: BASE, teams: {}, status: 'ok' };
  const today = new Date().toISOString().slice(0, 10);
  let links = [];
  try {
    const liga = await get(BASE + '/la-liga/');
    links = [...new Set([...liga.matchAll(/href="([^"#?]+)"/g)].map(m => m[1]))]
      .map(h => (h.startsWith('http') ? h : BASE + h))
      .map(u => { const m = u.match(/\/la-liga\/(.+)-vs-(.+)-(\d{4}-\d{2}-\d{2})\/$/); return m && { url: u, h: m[1], a: m[2], date: m[3] }; })
      .filter(Boolean);
  } catch (e) { out.status = 'error'; out.error = String(e.message || e); }
  for (const [key, slug] of Object.entries(TEAMS)) {
    try {
      if (out.status === 'error') throw new Error(out.error);
      const next = links.filter(l => (l.h === slug || l.a === slug) && l.date >= today).sort((x, y) => x.date.localeCompare(y.date))[0];
      if (!next) throw new Error('No hay próximo partido publicado en la lista de LaLiga');
      await sleep(1500);
      const r = parseMatch(await get(next.url));
      if (!r.score || !r.probs) throw new Error('No se pudo leer el marcador/probabilidades de ' + next.url);
      out.teams[key] = { ok: true, url: next.url, ...r, pick1x2: pick1x2(r.score), pick_by_prob: pickByProb(r.probs), tracked_is_home: next.h === slug };
    } catch (e) {
      out.status = 'partial';
      out.teams[key] = { ...(prev.teams?.[key] || {}), ok: false, stale: true, error: String(e.message || e) };
    }
  }
  fs.writeFileSync('data.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}
module.exports = { parseMatch, pick1x2, pickByProb };
if (require.main === module) main();
