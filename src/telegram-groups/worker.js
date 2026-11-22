'use strict';
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ quiet: true });
const { translateMessage } = require('../lib/message-translation');

const languageLabels={ru:'🇷🇺 Русский',uk:'🇺🇦 Українська',en:'🇬🇧 English',hu:'🇭🇺 Magyar',vi:'🇻🇳 Tiếng Việt'};
const languageNames={ru:'русский',uk:'українська',en:'English',hu:'magyar',vi:'Tiếng Việt'};

function candidate(message, config, state, now = Date.now()) {
  if (!message || !['group', 'supergroup'].includes(message.chat?.type) || message.from?.is_bot || message.sender_chat) return null;
  const id = String(message.chat.id);
  if (!config.allowedChatIds.map(String).includes(id)) return null;
  if (!message.date || now - message.date * 1000 > 300000) return null;
  const text = (message.text || '').toLowerCase();
  if (!text || text.startsWith('/') || /https?:\/\/|t\.me\//i.test(text)) return null;
  if (!/\?|подскаж|посовет|помог|ищу|нужен|нужна|нужно|потріб|порад|допом|help|looking for|recommend|keresek|segíts/i.test(text)) return null;
  const topic = config.topics.find(t => t.keywords.some(k => text.includes(k.toLowerCase())));
  if (!topic) return null;
  const previous = state.chats[id];
  const day = new Date(now).toISOString().slice(0, 10);
  if (previous && (now - previous.last < config.cooldownMinutes * 60000 || (previous.day === day && previous.count >= config.dailyLimitPerChat))) return null;
  return { chat_id: message.chat.id, text: `${config.company}: ${topic.reply}\nОбращайтесь в наш бот: ${config.botUrl}`, reply_parameters: { message_id: message.message_id }, ...(message.message_thread_id ? {message_thread_id: message.message_thread_id} : {}), link_preview_options: { is_disabled: true } };
}

async function main() {
  const directory = path.resolve(__dirname, '../.private/telegram-groups');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  if (!['preview', 'auto'].includes(config.mode) || !/^https:\/\/t\.me\/[a-zA-Z0-9_]+$/.test(config.botUrl) || config.botUrl.includes('REPLACE') || !config.company || !Array.isArray(config.allowedChatIds) || !config.topics?.length || !config.topics.every(t => t.keywords?.length && t.keywords.every(k => typeof k === 'string' && k.trim()) && typeof t.reply === 'string' && t.reply.length < 3000) || !(config.cooldownMinutes >= 1) || !(config.dailyLimitPerChat >= 1)) throw Error('Заполните config.json: company, botUrl, topics, лимиты и режим.');
  const token = process.env.TELEGRAM_GROUP_BOT_TOKEN;
  if (!token) throw Error('Задайте отдельный TELEGRAM_GROUP_BOT_TOKEN в .env');
  const lockPath = path.join(directory, 'worker.lock');
  const lock = fs.openSync(lockPath, 'wx');
  process.on('exit', () => { fs.closeSync(lock); fs.unlinkSync(lockPath); });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  const statePath = path.join(directory, 'state.json');
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { offset: 0, chats: {}, languages:{} };
  state.languages ||= {};
  const save = () => { fs.writeFileSync(statePath + '.tmp', JSON.stringify(state), {mode: 0o600}); fs.renameSync(statePath + '.tmp', statePath); };
  async function api(method, data) {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data), signal: AbortSignal.timeout(40000) });
    const result = await response.json();
    if (!result.ok) throw Error(`Telegram ${method}: ${result.error_code}`);
    return result.result;
  }
  async function handlePrivate(message){
    const id=String(message.chat.id),text=String(message.text||'').trim();
    if(text==='/start'||text==='/language'||text==='/lang'){
      await api('sendMessage',{chat_id:id,text:'Choose your language / Выберите язык / Оберіть мову / Válasszon nyelvet / Chọn ngôn ngữ:',reply_markup:{keyboard:[[languageLabels.ru,languageLabels.uk],[languageLabels.en,languageLabels.hu],[languageLabels.vi]].map(row=>row.map(text=>({text}))),resize_keyboard:true,one_time_keyboard:true}});return;
    }
    const selected=Object.entries(languageLabels).find(([,label])=>label===text)?.[0];
    if(selected){state.languages[id]=selected;save();const confirmation={ru:'Язык сохранён. Ответы в группе будут на русском.',uk:'Мову збережено. Відповіді в групі будуть українською.',en:'Language saved. Group replies will be in English.',hu:'A nyelv mentve. A csoportválaszok magyarul érkeznek.',vi:'Đã lưu ngôn ngữ. Trả lời trong nhóm sẽ bằng tiếng Việt.'};await api('sendMessage',{chat_id:id,text:confirmation[selected],reply_markup:{remove_keyboard:true}});}
  }
  const webhook = await api('getWebhookInfo', {});
  if (webhook.url) throw Error('У бота установлен webhook. Используйте отдельного бота для групп.');
  console.log(`Group bot: ${config.mode}`);
  for (;;) {
    try {
      const updates = await api('getUpdates', { offset: state.offset, timeout: 25, allowed_updates: ['message'] });
      for (const update of updates) {
        if(update.message?.chat?.type==='private'){
          state.offset=update.update_id+1;save();await handlePrivate(update.message).catch(()=>{});continue;
        }
        const reply = candidate(update.message, config, state);
        // Reserve before sending: an ambiguous network failure must not duplicate advertising.
        state.offset = update.update_id + 1;
        if (reply) {
          const id = String(reply.chat_id), day = new Date().toISOString().slice(0, 10);
          state.chats[id] = { last: Date.now(), day, count: (state.chats[id]?.day === day ? state.chats[id].count : 0) + 1 };
        }
        save();
        if (!reply) continue;
        const message=update.message,userId=String(message.from?.id||'');
        const telegramLanguage=String(message.from?.language_code||'').toLowerCase().split('-')[0];
        const target=state.languages[userId]||(['ru','uk','en','hu','vi'].includes(telegramLanguage)?telegramLanguage:'ru');
        reply.text=await translateMessage(reply.text,target,'ru');
        if (config.mode === 'preview') {
          fs.appendFileSync(path.join(directory, 'preview.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...reply }) + '\n', {mode: 0o600});
          console.log('Черновик сохранён');
        } else {
          try { await api('sendMessage', reply); console.log('Ответ отправлен'); }
          catch { console.error('Отправка не подтверждена; автоматический повтор отключён.'); }
        }
      }
    } catch { console.error('Ошибка получения обновлений; повтор через 10 секунд.'); await new Promise(r => setTimeout(r, 10000)); }
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { candidate };
