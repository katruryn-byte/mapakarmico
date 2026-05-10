const { createClient } = require('redis');
const { buildPromptMapaKarmico } = require('./prompt-mapa-karmico');
const {
  API_CONFIG_BASE, API_CONFIG_CASAS, API_CONFIG_ASPECTOS,
  formatarPlanetasParaPrompt, formatarCasasParaPrompt, formatarAspectosParaPrompt,
  calcularCasaDoPlaneta, PLANETAS_KARMICOS
} = require('./astro-config');
const { getTimezone } = require('./timezone-config');

async function aguardarAprovacao(sessionId, redisUrl, maxTentativas = 5, intervalMs = 2000) {
  for (let i = 0; i < maxTentativas; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const rc = createClient({ url: redisUrl });
    rc.on('error', e => console.error('Redis:', e));
    await rc.connect();
    const raw = await rc.get(`session:${sessionId}`);
    await rc.quit();
    if (raw) {
      const s = JSON.parse(raw);
      if (s.status === 'approved') return true;
    }
  }
  return false;
}

async function chamarAPI(endpoint, body) {
  const res = await fetch(`https://json.freeastrologyapi.com/western/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.FREEASTROLOGY_API_KEY },
    body: JSON.stringify(body)
  });
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { dados, sessionId } = req.body;
  if (!sessionId) return res.status(401).json({ error: 'Sessao nao encontrada', code: 'NO_SESSION' });

  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;

  try {
    const rc = createClient({ url: redisUrl });
    rc.on('error', e => console.error('Redis:', e));
    await rc.connect();
    const sessionData = await rc.get(`session:${sessionId}`);
    await rc.quit();

    if (!sessionData) return res.status(401).json({ error: 'Sessao invalida', code: 'INVALID_SESSION' });

    let session = JSON.parse(sessionData);
    if (session.status !== 'approved') {
      const aprovado = await aguardarAprovacao(sessionId, redisUrl, 5, 2000);
      if (!aprovado) return res.status(401).json({ error: 'Pagamento nao confirmado', code: 'NOT_APPROVED' });
    }

    let planetasReais = [], casasReais = null, aspectosReais = [];

    if (dados && dados.lat && dados.lon && dados.data) {
      const timezone = getTimezone(dados.data, dados.hora, dados.cidade);
      const dt = new Date(dados.data + 'T' + (dados.hora || '12:00') + ':00');
      const bodyBase = {
        year: dt.getFullYear(), month: dt.getMonth() + 1, date: dt.getDate(),
        hours: dt.getHours(), minutes: dt.getMinutes(), seconds: 0,
        latitude: parseFloat(dados.lat), longitude: parseFloat(dados.lon),
        timezone
      };

      try {
        const d = await chamarAPI('planets', { ...bodyBase, config: { ...API_CONFIG_BASE } });
        if (d?.output && Array.isArray(d.output)) planetasReais = d.output;
      } catch(e) { console.log('Planetas erro:', e.message); }

      try {
        const d = await chamarAPI('houses', { ...bodyBase, config: { ...API_CONFIG_CASAS } });
        if (d?.output?.Houses) casasReais = d.output;
      } catch(e) { console.log('Casas erro:', e.message); }

      if (casasReais?.Houses && planetasReais.length > 0) {
        planetasReais.forEach(item => {
          item.casaNum = calcularCasaDoPlaneta(item.fullDegree || 0, casasReais.Houses);
        });
      }

      try {
        const d = await chamarAPI('aspects', { ...bodyBase, config: { ...API_CONFIG_ASPECTOS } });
        if (d?.output && Array.isArray(d.output)) aspectosReais = d.output;
      } catch(e) { console.log('Aspectos erro:', e.message); }
    }

    const planetasInfo = formatarPlanetasParaPrompt(planetasReais, casasReais, PLANETAS_KARMICOS);
    const casasInfo = formatarCasasParaPrompt(casasReais);
    const aspectosInfo = formatarAspectosParaPrompt(aspectosReais);

    const promptFinal = buildPromptMapaKarmico(dados, planetasInfo, casasInfo, aspectosInfo);

    if (dados?.nome) {
      fetch(process.env.SHEETDB_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [{ Data: new Date().toLocaleString('pt-BR'), Nome: dados.nome, WhatsApp: dados.whatsapp || '', Email: dados.email || '', Cidade: dados.cidade || '', Nascimento: dados.data || '', Hora: dados.hora || '', Tipo: 'mapa-karmico', Valor: '47.97' }] })
      }).catch(e => console.log('SheetDB:', e.message));
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8000, messages: [{ role: 'user', content: promptFinal }] })
    });

    const data = await response.json();
    if (planetasReais.length > 0) data.planetas = planetasReais;
    if (casasReais) data.casas = casasReais;
    if (aspectosReais.length > 0) data.aspectos = aspectosReais;
    return res.status(200).json(data);

  } catch (error) {
    console.error('Erro geral:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
