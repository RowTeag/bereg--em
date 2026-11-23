const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {autoReply, semanticReply} = require('../lib/reply-templates');
const {createSupport} = require('../lib/telegram-support');

test('the inbox sends the saved template for a recognized paraphrase and leaves uncertain messages for staff', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bereg-template-ai-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const originalAI = globalThis.__BEREG_TRANSLATION_AI;
  t.after(() => { globalThis.__BEREG_TRANSLATION_AI = originalAI; });
  const savedText = 'Працюємо з понеділка по п’ятницю.';
  fs.writeFileSync(path.join(directory,'reply-templates.json'), JSON.stringify([
    {id:'hours', event:'schedule', match:'Який у вас графік?', language:'uk', text:savedText},
    {id:'hours-en', event:'schedule', match:'What are your hours?', language:'en', text:'Our hours'}
  ]));
  let calls = 0, response = '1';
  globalThis.__BEREG_TRANSLATION_AI = {async run(_model, {messages}) {
    calls++;
    const data = JSON.parse(messages[1].content);
    assert.deepEqual(data.options, [{id:1, topic:'schedule', language:'uk', example:'Який у вас графік?'}]);
    return {response};
  }};
  const delivered = [];
  const service = createSupport({
    directory,
    autoReply:(...args) => autoReply(directory, ...args),
    semanticReply:(...args) => semanticReply(directory, ...args),
    externalSender:async (_client, text) => { delivered.push(text); }
  });
  const incoming = (text, sourceId) => service.ingestExternal({
    provider:'whatsapp', externalId:'123', language:'uk', text, sourceId
  });
  const client = await incoming('а ви до котрої робете', 'one');
  await service.flush();
  assert.deepEqual(delivered, [savedText]);
  assert.equal(client.history.filter(item => item.direction === 'out').length, 1);
  await incoming('а ви до котрої робете', 'one');
  assert.equal(calls, 1);
  response = '0';
  await incoming('скільки і чи моє вже готово', 'two');
  response = '1\nДовільний текст';
  await incoming('некоректна відповідь моделі', 'three');
  assert.equal(client.history.filter(item => item.direction === 'out').length, 1);
});
