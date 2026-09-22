// ============ Yahya AI Server Pro - ALL IN ONE FILE ============
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

// ---------- الإعدادات ----------
const PORT = parseInt(process.env.PORT, 10) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const APP_NAME = 'Yahya AI Server Pro';
const VERSION = '1.0.0';

// ---------- Logger ----------
const ts = () => new Date().toISOString();
const log = {
  info: (m, d) => console.log(d ? `[INFO] ${ts()} - ${m} ${JSON.stringify(d)}` : `[INFO] ${ts()} - ${m}`),
  error: (m, e) => console.error(e ? `[ERROR] ${ts()} - ${m}` : `[ERROR] ${ts()} - ${m}`, e || ''),
  success: (m) => console.log(`✅ [SUCCESS] ${ts()} - ${m}`)
};

// ---------- AI (Groq) ----------
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
let cachedModel = null;
let cacheExpiry = 0;

async function resolveModel(apiKey) {
  if (cachedModel && Date.now() < cacheExpiry) return cachedModel;

  const r = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` }
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error?.message || 'Groq models error'), { statusCode: r.status });

  const ids = Array.isArray(body.data) ? body.data.map((m) => m.id) : [];
  const preferred = [process.env.GROQ_MODEL, 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile'].filter(Boolean);
  const model = preferred.find((id) => ids.includes(id)) || ids.find((id) => !/(whisper|tts|embed|vision|guard)/i.test(id));
  if (!model) throw new Error('No text model available');

  cachedModel = model;
  cacheExpiry = Date.now() + 5 * 60 * 1000;
  return model;
}

async function generateAiReply(userMessage) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const e = new Error('GROQ_API_KEY is not configured');
    e.code = 'AI_CONFIG_MISSING';
    throw e;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const model = await resolveModel(apiKey);
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        messages: [
          {
            role: 'system',
            content: 'أنت MAi Bot، مساعد عربي واضح وعملي. أجب بالعربية بإجابة مفيدة ومباشرة، ولا تكرر سؤال المستخدم.'
          },
          { role: 'user', content: userMessage }
        ]
      }),
      signal: controller.signal
    });

    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.error?.message || 'Groq request failed'), { statusCode: r.status });

    const reply = body.choices?.[0]?.message?.content;
    if (!reply || !reply.trim()) throw new Error('Empty AI response');
    return reply.trim();
  } finally {
    clearTimeout(timeout);
  }
}

function aiErrorMessage(e) {
  if (e.code === 'AI_CONFIG_MISSING') return 'GROQ_API_KEY غير مضبوط في السيرفر.';
  if (e.statusCode === 401 || e.statusCode === 403) return 'مفتاح Groq غير صالح.';
  if (e.statusCode === 429) return 'تم تجاوز حد الاستخدام في Groq.';
  if (e.statusCode >= 400 && e.statusCode < 500) return `خطأ من Groq: ${e.message}`;
  if (e.name === 'AbortError') return 'تأخر الرد أكثر من 30 ثانية.';
  return 'تعذر الوصول للذكاء الاصطناعي حاليًا.';
}

// ---------- Express ----------
const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => { log.info(`${req.method} ${req.path}`); next(); });

// ---------- Routes ----------
app.get('/', (req, res) => res.json({
  message: `🚀 Welcome to ${APP_NAME}`,
  version: VERSION,
  status: 'running',
  timestamp: new Date().toISOString(),
  endpoints: { health: '/health', status: '/status', ask: '/ask', echo: '/api/echo' }
}));

app.get('/health', (req, res) => res.json({
  status: 'healthy', service: APP_NAME,
  timestamp: new Date().toISOString(),
  uptime: process.uptime(), environment: NODE_ENV
}));

app.get('/status', (req, res) => res.json({
  service: APP_NAME, status: 'operational', version: VERSION,
  environment: NODE_ENV, timestamp: new Date().toISOString(),
  uptime: `${Math.floor(process.uptime())} seconds`
}));

app.post('/api/echo', (req, res) => res.json({
  message: 'Echo received', receivedData: req.body, timestamp: new Date().toISOString()
}));

app.post('/ask', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'No message provided' });
  }
  try {
    const reply = await generateAiReply(message);
    res.json({ reply });
  } catch (e) {
    log.error('AI error', e);
    res.status(e.statusCode || 500).json({ error: aiErrorMessage(e) });
  }
});

// ---------- Error Handler ----------
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  log.error(`${req.method} ${req.path} - ${err.message}`);
  res.status(statusCode).json({
    error: true,
    message: err.message || 'Internal Server Error',
    statusCode,
    path: req.path,
    timestamp: new Date().toISOString(),
    ...(NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ---------- Start ----------
app.listen(PORT, () => log.success(`Server running on port ${PORT}`));

