const https = require('node:https');

const MIN_SEARCH_VOLUME = 21;

function send(res, status, body) {
  res.status(status).json(body);
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '').trim();
  if (!url || !key) throw new Error('Supabase ortam değişkenleri eksik.');
  return { url: url.replace(/\/$/, ''), key };
}

async function supabaseRequest(path, options = {}) {
  const { url, key } = supabaseConfig();
  const body = options.body || null;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...options.headers,
  };
  if (body) headers['Content-Length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const request = https.request(new URL(`${url}/rest/v1/${path}`), {
      method: options.method || 'GET',
      headers,
      timeout: 15000,
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        let data;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const details = typeof data === 'object' ? (data.message || data.hint || JSON.stringify(data)) : text;
          reject(new Error(`Supabase HTTP ${response.statusCode}: ${details || 'Bilinmeyen hata'}`));
          return;
        }
        resolve({ data, count: response.headers['content-range'] || null });
      });
    });
    request.on('timeout', () => request.destroy(new Error('Supabase bağlantısı 15 saniye içinde yanıt vermedi.')));
    request.on('error', error => reject(new Error(`Supabase ağ bağlantısı kurulamadı: ${error.message}`)));
    if (body) request.write(body);
    request.end();
  });
}

function number(value) {
  const match = String(value ?? '').replace(/[,%<>\s]/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function keywordKey(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function score(searches, competition, clicks, ctr, trend, words) {
  const volume = Math.min(Math.log1p(searches) / Math.log1p(5000), 1) * 25;
  const competitionScore = (1 - Math.min(Math.log1p(competition) / Math.log1p(500000), 1)) * 20;
  let earned = volume + competitionScore + (words >= 3 ? 10 : 6) + 12;
  if (clicks !== null) earned += Math.min(Math.max(clicks, 0) / Math.max(searches, 1), 1.5) / 1.5 * 10 + 1;
  if (ctr !== null) earned += Math.min(Math.max(ctr, 0), 150) / 150 * 10 + 1;
  if (trend !== null) earned += Math.max(-100, Math.min(trend, 100)) / 100 * 10 + 1;
  return Math.round(Math.max(0, Math.min(earned, 100)) * 100) / 100;
}

function splitCsvLine(line, delimiter) {
  const cells = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { cell += char; i += 1; } else quoted = !quoted;
    } else if (char === delimiter && !quoted) { cells.push(cell.trim()); cell = ''; }
    else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseCsv(content, concept) {
  const lines = String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) throw new Error('CSV boş.');
  const delimiter = [';', '\t', ','].sort((a, b) => splitCsvLine(lines[0], b).length - splitCsvLine(lines[0], a).length)[0];
  const headers = splitCsvLine(lines[0], delimiter).map(header => header.toLowerCase().trim());
  const aliases = (row, names) => names.map(name => row[name]).find(value => value !== undefined && value !== '');
  const stats = { added: 0, updated: 0, rejected_single_word: 0, rejected_low_search: 0, high_competition: 0, duplicates_collapsed: 0, with_clicks: 0, with_ctr: 0, with_trend: 0 };
  const records = new Map();
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line, delimiter);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    const keyword = String(aliases(row, ['keywords', 'keyword', 'tag']) || '').trim().replace(/\s+/g, ' ');
    if (!keyword) continue;
    if (keyword.split(' ').length < 2) { stats.rejected_single_word += 1; continue; }
    const searches = Math.trunc(number(aliases(row, ['average searches', 'avg searches', 'search volume', 'searches'])));
    const competition = Math.trunc(number(aliases(row, ['etsy competition', 'competition'])));
    if (searches < MIN_SEARCH_VOLUME) { stats.rejected_low_search += 1; continue; }
    const rawClicks = aliases(row, ['average clicks', 'avg clicks', 'clicks']);
    const rawCtr = aliases(row, ['average ctr', 'avg ctr', 'ctr', 'click through rate', 'click-through rate']);
    const rawTrend = aliases(row, ['trend change', 'trend', 'change']);
    const clicks = rawClicks === undefined ? null : number(rawClicks);
    const ctr = rawCtr === undefined ? null : number(rawCtr);
    const trend = rawTrend === undefined ? null : number(rawTrend);
    const key = keywordKey(keyword);
    if (records.has(key)) stats.duplicates_collapsed += 1;
    records.set(key, { concept: String(concept).trim(), keyword, searches, competition, score: score(searches, competition, clicks, ctr, trend, keyword.split(' ').length) });
    if (clicks !== null) stats.with_clicks += 1;
    if (ctr !== null) stats.with_ctr += 1;
    if (trend !== null) stats.with_trend += 1;
  }
  const result = [...records.values()].sort((a, b) => b.score - a.score);
  stats.added = result.length;
  stats.high_competition = result.filter(item => item.competition > 100000).length;
  return { records: result, stats, headers };
}

async function dashboard(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.page_size) || 100, 25), 100);
  const offset = (page - 1) * pageSize;
  const { data, count } = await supabaseRequest(`erank_keywords?select=*&order=score.desc,id.desc&offset=${offset}&limit=${pageSize}`, { headers: { Prefer: 'count=exact' } });
  const items = (data || []).filter(item => Number(item.searches || 0) >= MIN_SEARCH_VOLUME && String(item.keyword || '').trim().split(/\s+/).length >= 2);
  const total = Number((count || '*/0').split('/')[1]) || 0;
  send(res, 200, { items, page, page_size: pageSize, total, total_pages: Math.max(Math.ceil(total / pageSize), 1), high_competition_count: null });
}

async function upload(req, res) {
  const { concept, csv_content: csvContent, preview } = req.body || {};
  if (!concept || !csvContent) return send(res, 400, { success: false, error: 'Concept and csv_content are required.' });
  const { records, stats, headers } = parseCsv(csvContent, concept);
  stats.valid_count = records.length;
  if (!records.length) return send(res, 400, { success: false, error: "CSV tarandı ancak hacmi 20'nin üzerinde olan geçerli, çok kelimeli veri bulunamadı.", details: `Okunan sütunlar: ${headers.join(', ')}` });
  if (preview) return send(res, 200, { message: `${records.length} geçerli keyword bulundu.`, stats, headers, preview: records.slice(0, 10) });
  const filter = encodeURIComponent(String(concept).trim());
  const existing = await supabaseRequest(`erank_keywords?select=id,keyword&concept=eq.${filter}`);
  const byKeyword = new Map((existing.data || []).map(item => [keywordKey(item.keyword), item.id]));
  const additions = [];
  let updated = 0;
  for (const record of records) {
    const id = byKeyword.get(keywordKey(record.keyword));
    if (!id) additions.push(record);
    else { await supabaseRequest(`erank_keywords?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(record) }); updated += 1; }
  }
  if (additions.length) await supabaseRequest('erank_keywords', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(additions) });
  stats.added = additions.length; stats.updated = updated;
  send(res, 200, { message: `${concept} için ${additions.length} yeni kayıt eklendi, ${updated} aynı keyword güncellendi.`, stats });
}

async function deleteKeywords(req, res) {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id])
    .map(id => String(id || '').trim())
    .filter(id => /^[0-9a-f-]{1,64}$/i.test(id));
  if (!ids.length) return send(res, 400, { success: false, error: 'Silinecek geçerli ID bulunamadı.' });
  const list = ids.map(id => `"${id}"`).join(',');
  await supabaseRequest(`erank_keywords?id=in.(${encodeURIComponent(list)})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  send(res, 200, { success: true, message: 'Başarıyla silindi.' });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await dashboard(req, res);
    if (req.method === 'POST') return req.body?.action === 'delete' ? await deleteKeywords(req, res) : await upload(req, res);
    return send(res, 405, { success: false, error: 'Method not allowed.' });
  } catch (error) {
    return send(res, 500, { success: false, error: 'Supabase bağlantı hatası', details: error.message });
  }
};
