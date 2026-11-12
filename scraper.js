// Uso: npm i playwright && npx playwright install chromium && node scraper.js
// Genera data.json junto al index.html. Si una fuente falla, conserva los datos anteriores (marcados como obsoletos).
const { chromium } = require('playwright');
const fs = require('fs');

const URLS = {
  forebet: 'https://www.forebet.com/es/predicciones-espana/la-liga',
  predictz: 'https://www.predictz.com/es/pronosticos/espana/la-liga/',
};
const IDS = { 'athletic club':621,'atletico de madrid':13,'ca osasuna':331,'deportivo alaves':1108,'elche cf':1531,'fc barcelona':131,'getafe cf':3709,'levante ud':3368,'malaga cf':1084,'rayo vallecano':367,'rc celta de vigo':940,'rc deportivo de la coruna':897,'rcd espanyol':714,'real betis balompie':150,'real madrid cf':418,'real racing club de santander':630,'real sociedad':681,'sevilla fc':368,'valencia cf':1049,'villarreal cf':1050 };
const ALIAS = { 'real madrid':'real madrid cf','barcelona':'fc barcelona','atletico madrid':'atletico de madrid','atletico':'atletico de madrid','athletic':'athletic club','osasuna':'ca osasuna','alaves':'deportivo alaves','elche':'elche cf','getafe':'getafe cf','levante':'levante ud','malaga':'malaga cf','rayo':'rayo vallecano','celta':'rc celta de vigo','celta vigo':'rc celta de vigo','deportivo':'rc deportivo de la coruna','deportivo la coruna':'rc deportivo de la coruna','espanyol':'rcd espanyol','betis':'real betis balompie','real betis':'real betis balompie','racing santander':'real racing club de santander','racing':'real racing club de santander','real racing':'real racing club de santander','sevilla':'sevilla fc','valencia':'valencia cf','villarreal':'villarreal cf' };
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[.\-]/g,' ').replace(/\s+/g,' ').trim();
const idOf = n => { const k = norm(n); return IDS[k] ?? IDS[ALIAS[k]] ?? null; };
const MINE = { real: 418, barca: 131, atleti: 13 };

let prev = {};
try { prev = JSON.parse(fs.readFileSync('data.json','utf8')); } catch {}
const out = { updated: new Date().toISOString(), status: {}, forebet: prev.forebet || [], predictz: prev.predictz || [], h2h: prev.h2h || {} };
const ok = (k) => out.status[k] = { state: 'ok', at: new Date().toISOString() };
const fail = (k, e) => out.status[k] = { state: 'error', error: String(e.message || e), staleSince: prev.status?.[k]?.at || null };

async function forebet(page) {
  await page.goto(URLS.forebet, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.rcnt', { timeout: 20000 });
  // SELECTORES SIN VERIFICAR CONTRA LA WEB VIVA: ajústalos si Forebet cambia su HTML.
  const rows = await page.$$eval('.rcnt', els => els.map(e => ({
    home: e.querySelector('.homeTeam')?.innerText.trim() || null,
    away: e.querySelector('.awayTeam')?.innerText.trim() || null,
    date: e.querySelector('.date_bah')?.innerText.trim() || null,
    pred: e.querySelector('.forepr')?.innerText.trim() || null,
    probs: [...e.querySelectorAll('.fprc span')].map(s => s.innerText.trim()),
    exact: e.querySelector('.ex_sc')?.innerText.trim() || null,
  })));
  out.forebet = rows.filter(r => r.home && r.away && Object.values(MINE).some(id => [idOf(r.home), idOf(r.away)].includes(id)));
}

async function predictz(page) {
  await page.goto(URLS.predictz, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // SELECTOR SIN VERIFICAR: se parsea el texto de cada bloque; si no hay 3 cuotas se deja null.
  const rows = await page.$$eval('[class*="pttr"], [class*="ptmobh"], .pttable tr', els => els.map(e => e.innerText));
  out.predictz = rows.map(t => {
    const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
    const odds = (t.match(/\b\d{1,2}[.,]\d{2}\b/g) || []).slice(0, 3).map(x => parseFloat(x.replace(',', '.')));
    const pm = t.match(/\b(?:Pron[oó]stico|Tip)\W*([1X2])\b/i);
    return { raw: lines.slice(0, 6), pred: pm ? pm[1].toUpperCase() : null, odds: odds.length === 3 ? odds : null };
  }).filter(r => /real madrid|barcelona|atl[eé]tico/i.test(r.raw.join(' ')));
}

async function h2h(page, key, myId) {
  const f = out.forebet.find(r => [idOf(r.home), idOf(r.away)].includes(myId));
  if (!f) return;
  const rival = idOf(f.home) === myId ? idOf(f.away) : idOf(f.home);
  if (!rival) { out.h2h[key] = { error: 'Rival no está en la tabla de IDs' }; return; }
  const url = `https://www.transfermarkt.es/vergleich/vereineBegegnungen/statistik/${myId}_${rival}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // SELECTOR SIN VERIFICAR: tabla de resultados de Transfermarkt.
  const rows = await page.$$eval('table.items tbody tr', trs => trs.map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.trim())));
  const matches = rows.filter(c => c.some(x => /^\d+:\d+/.test(x))).slice(0, 10).map(c => {
    const score = c.find(x => /^\d+:\d+/.test(x));
    const i = c.indexOf(score);
    return { cells: c, score, date: c.find(x => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(x)) || null, home: c[i - 1] || null, away: c[i + 1] || null, comp: c[0] || null };
  });
  out.h2h[key] = { url, matches };
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'es-ES' })).newPage();
  for (const [k, fn] of [['forebet', forebet], ['predictz', predictz]]) {
    try { await fn(page); ok(k); } catch (e) { fail(k, e); }
  }
  try {
    await h2h(page, 'real', MINE.real); await h2h(page, 'barca', MINE.barca); ok('transfermarkt');
  } catch (e) { fail('transfermarkt', e); }
  await browser.close();
  fs.writeFileSync('data.json', JSON.stringify(out, null, 1));
  console.log(out.status);
})();
