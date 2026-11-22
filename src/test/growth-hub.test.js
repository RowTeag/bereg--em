const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGrowthHub } = require('../lib/growth-hub');

test('growth hub detects multilingual service intent and persists settings', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bereg-growth-'));
  const hub = createGrowthHub({ directory });
  const result = hub.analyze('Терміново шукаю перекладача і нотаріуса в Будапешті. Хто може допомогти?');
  assert.ok(result.matched.includes('перекладач'));
  assert.ok(result.matched.includes('нотаріус'));
  assert.ok(result.score >= 55);
  assert.match(result.suggestedReply, /@bereg_support_bot/);
  hub.state.channel.username = 'bereg_hungary';
  hub.save();
  const restored = createGrowthHub({ directory });
  assert.equal(restored.state.channel.username, 'bereg_hungary');
});
