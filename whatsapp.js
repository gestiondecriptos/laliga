// Envía por WhatsApp (vía CallMeBot, servicio gratuito de uso personal) el resumen de la PORRA.
// Lee data.json (generado por scraper.js). Necesita los secretos CALLMEBOT_PHONE y CALLMEBOT_APIKEY.
const fs = require('fs');
const NA = 'No disponible';
const short = n => String(n || '').replace(/^(RCD|RC|FC|CF|CA|UD|SD|CD|Club)\s+/, '').replace(/\s+(CF|FC|CD|UD)$/, '');
function best(p) {
  if (!p || p.home == null || p.draw == null || p.away == null) return null;
  const m = Math.max(p.home, p.draw, p.away);
  return { m, ks: [['1', p.home], ['X', p.draw], ['2', p.away]].filter(([, v]) => v === m).map(([k]) => k) };
}
function buildMessage(D) {
  const lines = ['⚽ PORRA LaLiga'];
  const order = [['real', 'Real Madrid'], ['barca', 'FC Barcelona'], ['atleti', 'Atlético de Madrid']]; // orden fijo
  let stale = D.status !== 'ok';
  for (const [k, name] of order) {
    const t = D.teams?.[k];
    if (!t || !t.score) { lines.push(`${name}: ${NA}`); stale = true; continue; }
    if (t.stale) stale = true;
    const match = `${short(t.home)} - ${short(t.away)}`;
    if (k !== 'atleti') { lines.push(`${t.score.home}-${t.score.away} ${match}`); continue; }
    const b = best(t.probs);
    if (!b) { lines.push(`${match}: ${NA}`); continue; }
    const extra = b.ks.length === 1 ? ` (${b.ks[0] === '1' ? 'gana ' + short(t.home) : b.ks[0] === '2' ? 'gana ' + short(t.away) : 'empate'}, ${b.m}%)` : ` (mismo porcentaje, ${b.m}%)`;
    lines.push(`${b.ks.join('/')} ${match}${extra}`);
  }
  if (stale) lines.push('⚠ Algún dato puede estar obsoleto o no disponible.');
  const upd = D.updated ? new Date(D.updated).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'n/d';
  lines.push(`Fuente: MyScorePrediction (IA, solo entretenimiento). Datos del ${upd}.`);
  return lines.join('\n');
}
async function main() {
  const phone = process.env.CALLMEBOT_PHONE, key = process.env.CALLMEBOT_APIKEY;
  if (!phone || !key) throw new Error('Faltan los secretos CALLMEBOT_PHONE y/o CALLMEBOT_APIKEY');
  const D = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const text = buildMessage(D);
  console.log(text);
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const body = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  console.log('Respuesta de CallMeBot:', res.status, body);
  if (!res.ok) throw new Error('CallMeBot devolvió HTTP ' + res.status);
}
module.exports = { buildMessage };
if (require.main === module) main().catch(e => { console.error(String(e.message || e)); process.exit(1); });
