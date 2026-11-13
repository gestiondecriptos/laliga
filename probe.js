// Prueba de MyScorePrediction: NO extrae datos finales, solo comprueba si la web deja leerla
// y guarda en debug.json lo que ve, para escribir después el extractor real.
// Requiere Node 20 (viene en GitHub Actions). No usa ninguna librería.
const fs = require('fs');
const BASE = 'https://myscoreprediction.com';
const UA = 'Mozilla/5.0 (compatible; laliga-dashboard-personal/1.0)';
const out = { at: new Date().toISOString(), steps: [] };

const strip = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function get(url) {
  const r = { url };
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es,en;q=0.8' } });
    r.status = res.status;
    r.html = await res.text();
    r.title = (r.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || null;
    r.blocked = /just a moment|cf-chl|verificaci[oó]n de seguridad|attention required/i.test(r.html);
  } catch (e) { r.error = String(e.message || e); }
  return r;
}
const summary = r => ({ url: r.url, status: r.status, title: r.title, blocked: r.blocked, length: r.html?.length, error: r.error });

(async () => {
  const liga = await get(BASE + '/la-liga/');
  out.steps.push({ step: 'pagina_laliga', ...summary(liga) });
  if (!liga.html || liga.blocked || liga.status !== 200) { fs.writeFileSync('debug.json', JSON.stringify(out, null, 1)); return; }

  const links = [...new Set([...liga.html.matchAll(/href="([^"#?]+)"/g)].map(m => m[1]))]
    .map(h => h.startsWith('http') ? h : BASE + h)
    .filter(h => h.startsWith(BASE + '/la-liga/') && h !== BASE + '/la-liga/');
  out.total_links_laliga = links.length;
  out.sample_links = links.slice(0, 30);
  const pick = re => links.find(h => re.test(h));
  const targets = { real_madrid: pick(/real-madrid/), barcelona: pick(/barcelona/) };
  out.targets = targets;

  for (const [name, url] of Object.entries(targets)) {
    if (!url) { out.steps.push({ step: name, note: 'No se encontró enlace de partido' }); continue; }
    const m = await get(url);
    const text = m.html ? strip(m.html) : '';
    const around = [...text.matchAll(/(scoreline|predicted score|exact score|prediction)/gi)].slice(0, 6)
      .map(x => text.slice(Math.max(0, x.index - 120), x.index + 220));
    out.steps.push({ step: name, ...summary(m), text_start: text.slice(0, 700), around_keywords: around,
      score_like: [...new Set(text.match(/\b\d\s?[-–:]\s?\d\b/g) || [])].slice(0, 10) });
  }
  fs.writeFileSync('debug.json', JSON.stringify(out, null, 1));
})();
