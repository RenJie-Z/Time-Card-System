import cors from 'cors';
import express from 'express';
import { createAccessToken, decodeAccessToken, hashPassword, verifyPassword } from './auth.js';
import { all, get, initializeDatabase, run } from './db.js';

const LOCAL_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function allowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) return LOCAL_ORIGINS;
  return raw.split(',').map((origin) => origin.trim()).filter(Boolean);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function normalizeTask(row) {
  return row ? { ...row, completed: Boolean(row.completed) } : row;
}

function normalizeCheckin(row) {
  return row || null;
}

function publicUser(row) {
  return { id: row.id, email: row.email, created_at: row.created_at };
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function createApp(db) {
  initializeDatabase(db);
  const app = express();

  app.use(cors({ origin: allowedOrigins(), credentials: true }));
  app.use(express.json());

  async function authenticate(req, res, next) {
    const header = req.get('authorization') || '';
    const [, token] = header.match(/^Bearer\s+(.+)$/i) || [];
    if (!token) {
      res.status(403).json({ detail: 'Not authenticated' });
      return;
    }
    try {
      const payload = decodeAccessToken(token);
      const user = await get(db, 'SELECT * FROM users WHERE id = ?', [Number(payload.sub)]);
      if (!user) {
        res.status(401).json({ detail: 'User not found' });
        return;
      }
      req.user = user;
      next();
    } catch {
      res.status(401).json({ detail: 'Invalid or expired token' });
    }
  }

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/auth/register', asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!isEmail(email) || password.length < 6) {
      res.status(422).json({ detail: 'Valid email and a password of at least 6 characters are required' });
      return;
    }
    const existing = await get(db, 'SELECT id FROM users WHERE lower(email) = lower(?)', [email]);
    if (existing) {
      res.status(409).json({ detail: 'Email already registered' });
      return;
    }
    const result = await run(
      db,
      'INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [email, hashPassword(password)],
    );
    const user = await get(db, 'SELECT * FROM users WHERE id = ?', [result.id]);
    res.status(201).json({ access_token: createAccessToken(user.id), token_type: 'bearer', user: publicUser(user) });
  }));

  app.post('/auth/login', asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await get(db, 'SELECT * FROM users WHERE lower(email) = lower(?)', [email]);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ detail: 'Invalid email or password' });
      return;
    }
    res.json({ access_token: createAccessToken(user.id), token_type: 'bearer', user: publicUser(user) });
  }));

  app.get('/users/me', authenticate, (req, res) => {
    res.json(publicUser(req.user));
  });

  app.get('/checkins/day', authenticate, asyncHandler(async (req, res) => {
    const date = String(req.query.date || '');
    if (!isIsoDate(date)) {
      res.status(422).json({ detail: 'A valid date query parameter is required' });
      return;
    }
    const checkin = await get(db, 'SELECT * FROM study_checkins WHERE user_id = ? AND date = ?', [req.user.id, date]);
    const tasks = await all(
      db,
      'SELECT * FROM study_tasks WHERE user_id = ? AND date = ? ORDER BY created_at, id',
      [req.user.id, date],
    );
    res.json({ date, checkin: normalizeCheckin(checkin), tasks: tasks.map(normalizeTask) });
  }));

  app.put('/checkins/:targetDate', authenticate, asyncHandler(async (req, res) => {
    const { targetDate } = req.params;
    if (!isIsoDate(targetDate)) {
      res.status(422).json({ detail: 'A valid date is required' });
      return;
    }
    const totalMinutes = Math.max(0, Math.min(1440, Number(req.body.total_minutes) || 0));
    const note = String(req.body.note || '').trim();
    await run(
      db,
      `INSERT INTO study_checkins (user_id, date, total_minutes, note, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, date) DO UPDATE SET
         total_minutes = excluded.total_minutes,
         note = excluded.note,
         updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, targetDate, totalMinutes, note],
    );
    const checkin = await get(db, 'SELECT * FROM study_checkins WHERE user_id = ? AND date = ?', [req.user.id, targetDate]);
    res.json(checkin);
  }));

  app.get('/checkins/month', authenticate, asyncHandler(async (req, res) => {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!Number.isInteger(year) || year < 1970 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      res.status(422).json({ detail: 'Valid year and month query parameters are required' });
      return;
    }
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const days = await all(
      db,
      `SELECT c.date, c.total_minutes, c.note,
        COUNT(t.id) AS task_count,
        COALESCE(SUM(CASE WHEN t.completed = 1 THEN 1 ELSE 0 END), 0) AS completed_task_count
       FROM study_checkins c
       LEFT JOIN study_tasks t ON t.user_id = c.user_id AND t.date = c.date
       WHERE c.user_id = ? AND c.date >= ? AND c.date <= ?
       GROUP BY c.id, c.date, c.total_minutes, c.note
       ORDER BY c.date`,
      [req.user.id, start, end],
    );
    res.json({ year, month, days });
  }));

  app.post('/tasks', authenticate, asyncHandler(async (req, res) => {
    const date = String(req.body.date || '');
    const title = String(req.body.title || '').trim();
    if (!isIsoDate(date) || !title) {
      res.status(422).json({ detail: 'Task date and title are required' });
      return;
    }
    const minutes = Math.max(0, Math.min(1440, Number(req.body.minutes) || 0));
    const result = await run(
      db,
      'INSERT INTO study_tasks (user_id, date, title, minutes, completed, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)',
      [req.user.id, date, title.slice(0, 180), minutes],
    );
    const task = await get(db, 'SELECT * FROM study_tasks WHERE id = ?', [result.id]);
    res.status(201).json(normalizeTask(task));
  }));

  app.patch('/tasks/:taskId', authenticate, asyncHandler(async (req, res) => {
    const task = await get(db, 'SELECT * FROM study_tasks WHERE id = ? AND user_id = ?', [req.params.taskId, req.user.id]);
    if (!task) {
      res.status(404).json({ detail: 'Task not found' });
      return;
    }
    const title = req.body.title === undefined ? task.title : String(req.body.title || '').trim().slice(0, 180);
    const minutes = req.body.minutes === undefined ? task.minutes : Math.max(0, Math.min(1440, Number(req.body.minutes) || 0));
    const completed = req.body.completed === undefined ? task.completed : req.body.completed ? 1 : 0;
    if (!title) {
      res.status(422).json({ detail: 'Task title is required' });
      return;
    }
    await run(
      db,
      'UPDATE study_tasks SET title = ?, minutes = ?, completed = ? WHERE id = ? AND user_id = ?',
      [title, minutes, completed, req.params.taskId, req.user.id],
    );
    const updated = await get(db, 'SELECT * FROM study_tasks WHERE id = ?', [req.params.taskId]);
    res.json(normalizeTask(updated));
  }));

  app.patch('/tasks/:taskId/toggle', authenticate, asyncHandler(async (req, res) => {
    const task = await get(db, 'SELECT * FROM study_tasks WHERE id = ? AND user_id = ?', [req.params.taskId, req.user.id]);
    if (!task) {
      res.status(404).json({ detail: 'Task not found' });
      return;
    }
    await run(db, 'UPDATE study_tasks SET completed = ? WHERE id = ?', [task.completed ? 0 : 1, task.id]);
    const updated = await get(db, 'SELECT * FROM study_tasks WHERE id = ?', [task.id]);
    res.json(normalizeTask(updated));
  }));

  app.delete('/tasks/:taskId', authenticate, asyncHandler(async (req, res) => {
    const result = await run(db, 'DELETE FROM study_tasks WHERE id = ? AND user_id = ?', [req.params.taskId, req.user.id]);
    if (!result.changes) {
      res.status(404).json({ detail: 'Task not found' });
      return;
    }
    res.status(204).send();
  }));

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ detail: 'Server error' });
  });

  return app;
}
