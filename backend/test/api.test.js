import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

process.env.SECRET_KEY = 'test-secret';

function app() {
  return createApp(createDatabase(':memory:'));
}

async function authHeaders(server, email = 'learner@example.com') {
  let response = await request(server).post('/auth/login').send({ email, password: 'secret123' });
  if (response.statusCode !== 200) {
    await request(server).post('/auth/register').send({ email, password: 'secret123' });
    response = await request(server).post('/auth/login').send({ email, password: 'secret123' });
  }
  return { Authorization: `Bearer ${response.body.access_token}` };
}

test('register, login, and current user', async () => {
  const server = app();
  const response = await request(server).post('/auth/register').send({
    email: 'learner@example.com',
    password: 'secret123',
  });
  assert.equal(response.statusCode, 201);
  assert.ok(response.body.access_token);

  const me = await request(server).get('/users/me').set('Authorization', `Bearer ${response.body.access_token}`);
  assert.equal(me.statusCode, 200);
  assert.equal(me.body.email, 'learner@example.com');
});

test('auth is required for checkins', async () => {
  const response = await request(app()).get('/checkins/day?date=2026-05-29');
  assert.equal(response.statusCode, 403);
});

test('checkin and task CRUD', async () => {
  const server = app();
  const headers = await authHeaders(server);

  const saved = await request(server)
    .put('/checkins/2026-05-29')
    .set(headers)
    .send({ total_minutes: 90, note: 'Read algorithms and reviewed notes.' });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.total_minutes, 90);

  const task = await request(server)
    .post('/tasks')
    .set(headers)
    .send({ date: '2026-05-29', title: '算法练习', minutes: 45 });
  assert.equal(task.statusCode, 201);

  const toggled = await request(server).patch(`/tasks/${task.body.id}/toggle`).set(headers);
  assert.equal(toggled.statusCode, 200);
  assert.equal(toggled.body.completed, true);

  const day = await request(server).get('/checkins/day?date=2026-05-29').set(headers);
  assert.equal(day.statusCode, 200);
  assert.equal(day.body.tasks.length, 1);

  const month = await request(server).get('/checkins/month?year=2026&month=5').set(headers);
  assert.equal(month.statusCode, 200);
  assert.equal(month.body.days[0].completed_task_count, 1);

  const updated = await request(server).patch(`/tasks/${task.body.id}`).set(headers).send({ minutes: 60 });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.minutes, 60);

  const deleted = await request(server).delete(`/tasks/${task.body.id}`).set(headers);
  assert.equal(deleted.statusCode, 204);
});
