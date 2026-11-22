const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('./runtime-fs');

const signatures = [
  ['pdf', Buffer.from('%PDF-')],
  ['jpg', Buffer.from('ffd8ff', 'hex')],
  ['png', Buffer.from('89504e470d0a1a0a', 'hex')]
];
const maxBytes = 5 * 1024 * 1024;

function attachOfficeFile(directory, client, input, save) {
  const { fileName, base64, expiresOn = '' } = input || {};
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 150 || /[\\/\x00-\x1f]/.test(fileName)) {
    throw Error('Проверьте название файла.');
  }
  if (expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ||
      !Number.isFinite(Date.parse(expiresOn)) || new Date(expiresOn).toISOString().slice(0,10) !== expiresOn)) {
    throw Error('Проверьте срок действия.');
  }
  if (typeof base64 !== 'string' || base64.length > 4 * Math.ceil(maxBytes / 3)) throw Error('Максимальный размер — 5 МБ.');
  const bytes = Buffer.from(base64, 'base64');
  const type = signatures.find(([,prefix]) => bytes.subarray(0,prefix.length).equals(prefix));
  const extension = path.extname(fileName).slice(1).toLowerCase().replace(/^jpeg$/, 'jpg');
  if (!type || type[0] !== extension || bytes.length > maxBytes || bytes.toString('base64') !== base64) {
    throw Error('Выберите файл PDF, JPEG или PNG.');
  }
  const document = { id: crypto.randomUUID(), source: 'office', fileName, extension, expiresOn, createdAt: new Date().toISOString() };
  const folder = path.join(directory, 'documents');
  fs.mkdirSync(folder, { recursive:true, mode:0o700 });
  const target = path.join(folder, document.id + '.' + extension);
  fs.writeFileSync(target, bytes, { mode:0o600 });
  const previous = client.attachments;
  client.attachments = [...(previous || []), document];
  try { save(); } catch (error) {
    client.attachments = previous;
    fs.unlinkSync(target);
    throw error;
  }
  return document;
}
module.exports = { attachOfficeFile };
