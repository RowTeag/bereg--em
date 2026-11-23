const fs = require('./runtime-fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const inquiryScenarios = ['schedule', 'price', 'payment', 'documents_ready'];
const languages = new Set(['uk', 'hu', 'ru', 'en']);

function readTemplates(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function mountReplyTemplates(app, directory) {
  const file = path.join(directory, 'reply-templates.json');
  app.get('/api/reply-templates', (req, res) => {
    res.json({ templates: readTemplates(file) });
  });
  app.post('/api/reply-templates', (req, res) => {
    if (!['admin', 'superadmin'].includes(req.panelUser?.role)) {
      return res.status(403).json({ error: 'Изменять шаблоны может администратор.' });
    }
    const { id, language } = req.body || {};
    const fields = ['title', 'text', 'documents'];
    const [title, text, documents] = fields.map(key =>
      typeof req.body?.[key] === 'string' ? req.body[key].trim() : ''
    );
    if (!languages.has(language) || !title || title.length > 120 ||
        (!text && !documents) || [text, documents].filter(Boolean).join('\n\n').length > 3500) {
      return res.status(400).json({ error: 'Укажите язык, название и текст ответа или список документов. Общий лимит ответа — 3500 символов.' });
    }
    const templates = readTemplates(file);
    const existing = templates.find(item => item.id === id);
    if (id && !existing) return res.status(404).json({ error: 'Шаблон не найден.' });
    const event=String(req.body.event||''),match=String(req.body.match||'').trim();
    if(!['','first','phrase','status',...inquiryScenarios].includes(event)||match.length>120||(event&&event!=='first'&&!match)){
      return res.status(400).json({error:'Укажите условие автоматической отправки.'});
    }
    const template = { event, match, id: existing?.id || randomUUID(), language, title, text, documents };
    if (existing) templates[templates.indexOf(existing)] = template;
    else templates.push(template);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file + '.tmp', JSON.stringify(templates), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
    res.json({ template });
  });
}

function autoReply(directory,client,event,value,queue){
  if(client.demo)return;
  const templates=readTemplates(path.join(directory,'reply-templates.json'));
  const phrase=String(value||'').toLocaleLowerCase().trim();
  const matches = template => template.language === client.language &&
    (event === 'first' || phrase === String(template.match || '').toLocaleLowerCase().trim());
  const scenario = event === 'phrase' && templates.find(template => inquiryScenarios.includes(template.event) && matches(template));
  const template = scenario || templates.find(template => template.event === event && matches(template));
  if(!template)return;
  const text=[template.text,template.documents].filter(Boolean).join('\n\n');
  client.history.push({direction:'out',eventId:randomUUID(),at:new Date().toISOString(),text});
  queue.push({bot:client.transport==='chatwoot'||client.provider&&client.provider!=='telegram'?'external':'client',clientId:client.id,text});
}
module.exports = { mountReplyTemplates, autoReply };
