const MAX_SIZE = 2_000_000;
const MAX_BOOKINGS = 5000;

function readBookings(text){
  if(typeof text!=='string'||Buffer.byteLength(text)>MAX_SIZE)throw Error('Выберите файл календаря до 2 МБ.');
  const ICAL = require('ical.js');
  const calendar=new ICAL.Component(ICAL.parse(text));
  if(calendar.name!=='vcalendar')throw Error('Ожидается календарь ICS.');
  const entries=calendar.getAllSubcomponents('vevent');
  if(entries.length>MAX_BOOKINGS)throw Error('Слишком много записей в файле.');
  return entries.map(event=>{
    const uid=event.getFirstPropertyValue('uid'),start=event.getFirstPropertyValue('dtstart');
    if(!uid||!start)throw Error('У записи отсутствует UID или время начала.');
    const recurrence=event.getFirstPropertyValue('recurrence-id')?.toString()||'';
    return {id:JSON.stringify([uid,recurrence]),title:String(event.getFirstPropertyValue('summary')||'Запись'),
      start:start.toString(),zone:start.zone?.tzid||'',status:String(event.getFirstPropertyValue('status')||''),
      recurring:event.hasProperty('rrule')};
  });
}

async function fetchBookings(address) {
  let url;
  try { url = new URL(address.trim().replace(/^webcal:/i, 'https:')); }
  catch { throw Error('Недопустимый адрес календаря.'); }
  if (url.protocol !== 'https:' || !/(^|\.)reservio\.com$/i.test(url.hostname) ||
      url.username || url.password || url.port) throw Error('Недопустимый адрес календаря.');

  let response;
  try { response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(15_000)}); }
  catch { throw Error('Не удалось обновить календарь Reservio.'); }
  if (!response.ok || !response.body) throw Error('Не удалось обновить календарь Reservio.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_SIZE) {
      await reader.cancel();
      throw Error('Выберите файл календаря до 2 МБ.');
    }
    chunks.push(value);
  }
  return readBookings(Buffer.concat(chunks).toString('utf8'));
}

function readCsv(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_SIZE) {
    throw Error('Выберите файл календаря до 2 МБ.');
  }
  const rows = [];
  let row = [], value = '', quoted = false, closedQuote = false, delimiter = '';
  text = text.replace(/^\uFEFF/, '');
  function finishField() {
    row.push(value.trim());
    value = '';
    closedQuote = false;
  }
  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    if (quoted && char !== undefined) {
      if (char !== '"') value += char;
      else if (text[i+1] === '"') { value += '"'; i++; }
      else { quoted = false; closedQuote = true; }
    } else if (char === undefined || char === '\r' || char === '\n') {
      if (quoted) throw Error('Неверный формат CSV.');
      if (char === '\r' && text[i+1] === '\n') i++;
      finishField();
      if (row.some(Boolean)) rows.push(row);
      row = [];
      if (rows.length > MAX_BOOKINGS + 1) throw Error('Слишком много записей в файле.');
    } else if (char === delimiter || (!delimiter && [',', ';', '\t'].includes(char))) {
      delimiter ||= char;
      finishField();
    } else if (char === '"' && !value && !closedQuote) {
      quoted = true;
    } else if (closedQuote || char === '"') {
      throw Error('Неверный формат CSV.');
    } else {
      value += char;
    }
  }
  return rows;
}

const columns = {
  id: ['id', 'booking id', 'reservation id', 'номер записи', 'номер запису', 'foglalás azonosítója', 'id rezerwacji'],
  service: ['service', 'service name', 'event', 'služba', 'szolgáltatás', 'usługa', 'услуга', 'послуга'],
  start: ['start', 'starts at', 'start date', 'date and time', 'booking date', 'booking start', 'appointment date', 'date',
    'datum', 'termín', 'dátum', 'data', 'дата', 'дата записи', 'дата запису', 'дата й час', 'дата начала'],
  time: ['time', 'start time', 'booking time', 'appointment time', 'čas', 'idő', 'godzina', 'время', 'час', 'час початку'],
  client: ['client', 'client name', 'customer', 'customer name', 'klient', 'ügyfél', 'клиент', 'клієнт', 'ім’я клієнта'],
  status: ['status', 'booking status', 'reservation status', 'stav', 'állapot', 'статус', 'статус запису']
};

function readCsvBookings(text) {
  const [first, ...rows] = readCsv(text);
  if (!first) throw Error('В CSV нет записей.');
  const header = first.map(value => value.toLowerCase().replace(/\s+/g, ' '));
  const indexes = Object.fromEntries(Object.entries(columns).map(([key, labels]) => [key, header.findIndex(label => labels.includes(label))]));
  if (indexes.start < 0 || (indexes.service < 0 && indexes.client < 0)) {
    throw Error('В CSV нужны дата записи и столбец услуги или клиента.');
  }
  if (!rows.length) throw Error('В CSV нет записей.');
  return rows.map(row => {
    const get = key => row[indexes[key]] || '';
    const rawDate = get('start');
    if (!rawDate || row.length !== header.length) throw Error('Проверьте дату и столбцы в каждой строке CSV.');
    const start = [rawDate, get('time')].filter(Boolean).join(' ');
    const title = [get('service'), get('client')].filter(Boolean).join(' · ') || 'Запись';
    const id = get('id') || JSON.stringify([start, title]);
    return {id: JSON.stringify(['reservio-csv', id]), start, title, zone: '', status: get('status'), recurring: false};
  });
}

module.exports = {readBookings, fetchBookings, readCsvBookings};
