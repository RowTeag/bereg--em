'use strict';

const fs = require('./runtime-fs');
const path = require('path');
const crypto = require('crypto');

const MAX_AGE = 90 * 24 * 60 * 60 * 1000;
const ID_RE = /^[a-f0-9-]{20,50}$/i;
const clean = (value, max = 240) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function mountSalesSite(app, { directory, support, telegramToken, telegramChatId = '' }) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'activity.json');
  let state = { visitors: [], leads: [] };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    state.visitors = Array.isArray(saved.visitors) ? saved.visitors : [];
    state.leads = Array.isArray(saved.leads) ? saved.leads : [];
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const save = () => {
    const now = Date.now();
    state.visitors = state.visitors.filter(item => Date.parse(item.lastSeen || item.firstSeen) > now - MAX_AGE);
    state.leads = state.leads.filter(item => Date.parse(item.createdAt) > now - MAX_AGE);
    fs.writeFileSync(file + '.tmp', JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  };
  save();
  const windows = new Map();
  const rateLimit = (req, key, max, windowMs = 15 * 60 * 1000) => {
    const now = Date.now();
    const ip = String(req.headers['cf-connecting-ip'] || req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 80);
    const id = `${key}:${ip}`;
    let record = windows.get(id);
    if (!record || now - record.start >= windowMs) record = { start: now, count: 0 };
    record.count++;
    windows.set(id, record);
    if (windows.size > 2000) for (const [entry, value] of windows) if (now - value.start >= windowMs) windows.delete(entry);
    return record.count <= max;
  };
  const ownerOnly = (req, res, next) => {
    if (!req.panelAuthenticated || req.panelUser?.role !== 'superadmin') return res.status(req.panelAuthenticated ? 403 : 401).json({ error: 'Войдите как владелец CRM.' });
    next();
  };
  function getOrCreateVisit(id, req, consent = true) {
    let visitor = ID_RE.test(String(id || '')) ? state.visitors.find(item => item.id === id) : null;
    const now = new Date().toISOString();
    if (!visitor) {
      const ref = String(req.body?.referrer || '').slice(0, 500);
      let source = 'Прямой переход';
      try { const url = new URL(ref); source = url.hostname.slice(0, 120); } catch {}
      const device = /mobile|android|iphone|ipad/i.test(String(req.headers['user-agent'] || '')) ? 'Мобильный' : 'Компьютер';
      visitor = { id: ID_RE.test(String(id || '')) ? id : crypto.randomUUID(), firstSeen: now, lastSeen: now, source, campaign: clean(req.body?.campaign, 140), device, consented: consent, events: [] };
      state.visitors.push(visitor);
    }
    visitor.lastSeen = now;
    return visitor;
  }
  async function notifyTelegram(lead) {
    const token = telegramToken;
    const owner = (support?.state?.operators || []).find(item => item.enabled && item.name === 'Главный оператор' && item.chatId)
      || (support?.state?.operators || []).find(item => item.enabled && item.chatId);
    const targetChat = /^\d{5,24}$/.test(String(telegramChatId)) ? String(telegramChatId) : owner?.chatId;
    if (!token || !targetChat) throw new Error('Не настроен Telegram-получатель заявок.');
    const msg = [
      '🟢 Новая заявка на CRM-демо',
      `Имя: ${lead.name}`,
      lead.business ? `Бизнес: ${lead.business}` : '',
      `Контакт: ${lead.contact}`,
      lead.preferredChannel ? `Связаться через: ${lead.preferredChannel}` : '',
      lead.need ? `Что нужно: ${lead.need}` : '',
      `Время: ${new Date(lead.createdAt).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' })}`,
      lead.visitorId ? `Визит: ${lead.visitorId.slice(0, 8)}` : ''
    ].filter(Boolean).join('\n');
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: targetChat, text: msg }), signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (!data.ok) throw new Error(`Telegram ${data.error_code || 'error'}`);
    lead.telegram = { status: 'sent', sentAt: new Date().toISOString() };
  }

  app.post('/api/sales-site/track', (req, res) => {
    if (!rateLimit(req, 'track', 120)) return res.status(429).json({ error: 'Слишком много запросов.' });
    if (req.body?.consent !== true) return res.json({ ok: true, tracked: false });
    const event = ['page_view', 'cta_click', 'form_start', 'form_submit'].includes(req.body?.event) ? req.body.event : 'page_view';
    const visitor = getOrCreateVisit(req.body?.visitorId, req, true);
    visitor.events.push({ type: event, at: new Date().toISOString(), page: '/crm-offer' });
    visitor.events = visitor.events.slice(-80);
    save();
    res.json({ ok: true, visitorId: visitor.id });
  });

  app.post('/api/sales-site/leads', async (req, res) => {
    if (!rateLimit(req, 'lead', 8)) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
    if (clean(req.body?.website, 200)) return res.status(201).json({ ok: true });
    const name = clean(req.body?.name, 100);
    const business = clean(req.body?.business, 120);
    const contact = clean(req.body?.contact, 180);
    const need = clean(req.body?.need, 700);
    const preferredChannel = ['WhatsApp', 'Telegram', 'Email', 'Phone'].includes(req.body?.preferredChannel) ? req.body.preferredChannel : '';
    if (name.length < 2 || contact.length < 5 || !need || req.body?.privacyAccepted !== true) return res.status(400).json({ error: 'Заполните имя, контакт и задачу, затем подтвердите обработку данных для ответа.' });
    let visitor = null;
    if (req.body?.analyticsConsent === true && ID_RE.test(String(req.body?.visitorId || ''))) visitor = getOrCreateVisit(req.body.visitorId, req, true);
    const lead = { id: crypto.randomUUID(), name, business, contact, preferredChannel, need, visitorId: visitor?.id || '', createdAt: new Date().toISOString(), telegram: { status: 'pending' } };
    state.leads.push(lead);
    if (visitor) {
      visitor.lastSeen = lead.createdAt;
      visitor.leadId = lead.id;
      visitor.events.push({ type: 'form_submit', at: lead.createdAt, page: '/crm-offer' });
    }
    save();
    try { await notifyTelegram(lead); }
    catch (error) { lead.telegram = { status: 'failed', error: clean(error.message, 120), attemptedAt: new Date().toISOString() }; save(); }
    res.status(201).json({ ok: true, telegramDelivered: lead.telegram.status === 'sent' });
  });

  app.get('/api/sales-site/overview', ownerOnly, (req, res) => {
    save();
    const visitors = state.visitors.slice().sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    const leads = state.leads.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ visitors, leads, totals: { visitors: visitors.length, leads: leads.length, pendingTelegram: leads.filter(item => item.telegram?.status !== 'sent').length } });
  });
  app.post('/api/sales-site/leads/:id/retry', ownerOnly, async (req, res) => {
    const lead = state.leads.find(item => item.id === req.params.id);
    if (!lead) return res.sendStatus(404);
    try { await notifyTelegram(lead); save(); res.json({ ok: true }); }
    catch (error) { lead.telegram = { status: 'failed', error: clean(error.message, 120), attemptedAt: new Date().toISOString() }; save(); res.status(502).json({ error: 'Не удалось отправить в Telegram. Проверьте настройки бота и повторите.' }); }
  });

  app.get('/crm-offer', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'sales.html')));
  app.get('/crm-offer/privacy', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'sales-privacy.html')));
  app.get('/crm-offer-admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'sales-admin.html')));
}

module.exports = { mountSalesSite };
