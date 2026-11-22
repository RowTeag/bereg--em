#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}

async function metaRequest(url, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...headers,
      ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message || `Meta API ${response.status}`);
  }
  return payload;
}

async function main() {
  const variables = await readStdin();
  const action = process.argv[2] || 'inspect';
  const token = String(variables.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneId = String(variables.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const appId = String(variables.FACEBOOK_APP_ID || '').trim();
  const version = String(variables.FACEBOOK_GRAPH_API_VERSION || 'v25.0').trim();
  if (!token || !phoneId || !appId) throw new Error('В Railway не хватает WhatsApp токена, Phone Number ID или Meta App ID.');
  const graph = `https://graph.facebook.com/${version}`;

  if (action === 'apply') {
    const imagePath = path.resolve(__dirname, '../public/assets/telegram/client.png');
    const image = fs.readFileSync(imagePath);
    const sessionUrl = new URL(`${graph}/${appId}/uploads`);
    sessionUrl.searchParams.set('file_name', 'bereg-whatsapp-support.png');
    sessionUrl.searchParams.set('file_length', String(image.length));
    sessionUrl.searchParams.set('file_type', 'image/png');
    const session = await metaRequest(sessionUrl, { method: 'POST', token });
    const upload = await metaRequest(`${graph}/${session.id}`, {
      method: 'POST',
      token,
      headers: { file_offset: '0', 'Content-Type': 'application/octet-stream' },
      body: image
    });
    if (!upload.h) throw new Error('Meta не вернула дескриптор загруженного аватара.');
    await metaRequest(`${graph}/${phoneId}/whatsapp_business_profile`, {
      method: 'POST',
      token,
      body: {
        messaging_product: 'whatsapp',
        profile_picture_handle: upload.h,
        about: 'BEREG — помощь в Венгрии',
        address: '1117 Budapest, Budafoki út 60.',
        description: 'Переводы, документы и сопровождение в Венгрии. Напишите нам — оператор поможет выбрать услугу и ответит на вопросы.',
        email: 'ugyintezesmagyarorszagon@gmail.com',
        websites: [
          'https://bereg-panel-production.up.railway.app',
          'https://www.facebook.com/profile.php?id=1294857643710619'
        ],
        vertical: 'PROF_SERVICES'
      }
    });
  }

  const result = await metaRequest(`${graph}/${phoneId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`, { token });
  const profile = result.data?.[0] || {};
  console.log(JSON.stringify({
    ok: true,
    action,
    profile: {
      about: profile.about || '',
      address: profile.address || '',
      description: profile.description || '',
      email: profile.email || '',
      profilePictureConfigured: Boolean(profile.profile_picture_url),
      websites: profile.websites || [],
      vertical: profile.vertical || ''
    }
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
