import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { runAgent } from './agent.js';
import { searchDoctors, getSpecialties } from './doctors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

loadEnv();

function loadEnv() {
  const envPath = join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const sessions = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function serveStatic(pathname, res) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/specialties') {
    return sendJson(res, 200, { specialties: getSpecialties() });
  }

  if (req.method === 'GET' && pathname === '/api/doctors') {
    return sendJson(
      res,
      200,
      searchDoctors({
        specialty: url.searchParams.get('specialty') || undefined,
        gender: url.searchParams.get('gender') || undefined,
        minRating: url.searchParams.get('minRating')
          ? Number(url.searchParams.get('minRating'))
          : undefined,
        minExperience: url.searchParams.get('minExperience')
          ? Number(url.searchParams.get('minExperience'))
          : undefined,
      })
    );
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    const body = await readBody(req);
    const { message, sessionId } = body;

    if (!message?.trim()) {
      return sendJson(res, 400, { error: 'Сообщение не может быть пустым' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return sendJson(res, 500, {
        error: 'OPENROUTER_API_KEY не задан. Скопируйте .env.example в .env и укажите ключ.',
      });
    }

    const model = process.env.OPENROUTER_MODEL || 'openai/gpt-5.4';
    const sid = sessionId || randomUUID();
    const history = sessions.get(sid) || [];
    history.push({ role: 'user', content: message.trim() });

    try {
      const { reply, messages } = await runAgent(history, { apiKey, model });
      sessions.set(sid, messages);
      return sendJson(res, 200, { reply, sessionId: sid });
    } catch (err) {
      console.error('Agent error:', err);
      return sendJson(res, 500, { error: err.message || 'Ошибка агента' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/chat/reset') {
    const body = await readBody(req);
    if (body.sessionId) sessions.delete(body.sessionId);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET') {
    return serveStatic(pathname, res);
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`Doctor booking agent: http://localhost:${PORT}`);
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('⚠️  OPENROUTER_API_KEY не задан — чат не будет работать до настройки .env');
  }
});
