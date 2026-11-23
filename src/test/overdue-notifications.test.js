const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSupport } = require('../lib/telegram-support');

test('overdue notices retry, skip resolved conversations and notify once per waiting period', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bereg-overdue-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const originalThreshold = process.env.BEREG_REPLY_MINUTES;
  t.after(() => {
    if (originalThreshold === undefined) delete process.env.BEREG_REPLY_MINUTES;
    else process.env.BEREG_REPLY_MINUTES = originalThreshold;
  });
  process.env.BEREG_REPLY_MINUTES = '60';

  const delivered = [];
  let reject = true;
  const api = async (bot, method, payload) => {
    assert.equal(bot, 'operator');
    assert.equal(method, 'sendMessage');
    if (reject) throw new Error('Temporary Telegram failure');
    delivered.push(payload);
  };
  const support = createSupport({directory, api});
  const incoming = age => ({direction: 'in', at: new Date(Date.now() - age * 60000).toISOString()});
  const outbound = {direction: 'out'};
  const clients = support.state.clients;
  clients.waiting = {id: 'waiting', name: 'Waiting', history: [incoming(120), {...outbound, eventId: 'auto'}]};
  clients.resolved = {id: 'resolved', name: 'Resolved', history: [incoming(120)]};
  clients.demo = {id: 'demo', name: 'Demo', demo: true, history: [incoming(120)]};
  clients.closed = {id: 'closed', name: 'Closed', status: 'closed', history: [incoming(120)]};
  clients.recent = {id: 'recent', name: 'Recent', history: [incoming(5)]};
  await support.flush();
  assert.equal(support.state.queue.length, 0);

  support.state.operators.push({id: 'manager', chatId: '42', enabled: true});
  support.state.overdueRecipient = {id: 'manager', chatId: '42'};
  await support.flush();
  assert.equal(support.state.queue.length, 2);
  assert.ok(support.state.queue.every(item => item.retryAt > Date.now()));

  clients.resolved.history.push(outbound);
  reject = false;
  for (const item of support.state.queue) item.retryAt = 0;
  await support.flush();
  assert.equal(support.state.queue.length, 0);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].chat_id, '42');
  assert.match(delivered[0].text, /Waiting/);

  const restarted = createSupport({directory, api});
  await restarted.flush();
  assert.equal(delivered.length, 1);
  restarted.state.clients.waiting.history.push(outbound, incoming(61));
  await restarted.flush();
  assert.equal(delivered.length, 2);

  restarted.state.operators[0].chatId = '99';
  restarted.state.clients.resolved.history.push(incoming(61));
  await restarted.flush();
  assert.equal(delivered.length, 2);
});
