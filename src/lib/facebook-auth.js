const crypto = require('crypto');
const fs = require('./runtime-fs');
const path = require('path');

function createFacebookAuth({ directory, graphVersion, redirectUri, env = process.env, fetchImpl = fetch }) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const appFile = path.join(directory, 'facebook-app.json');
  const credentialsFile = path.join(directory, 'facebook-oauth.json');
  const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const writeJson = (file, value) => {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };
  let appConfig = readJson(appFile);
  let credentials = readJson(credentialsFile);
  const states = new Map();
  let refreshPromise;

  const currentApp = () => ({
    appId: String(appConfig.appId || env.FACEBOOK_APP_ID || '').trim(),
    appSecret: String(appConfig.appSecret || env.FACEBOOK_APP_SECRET || '').trim(),
    redirectUri: String(env.FACEBOOK_REDIRECT_URI || appConfig.redirectUri || redirectUri).trim()
  });
  const publicConfig = () => {
    const app = currentApp();
    return { appId: app.appId, appSecretConfigured: Boolean(app.appSecret), redirectUri: app.redirectUri };
  };
  const peek = () => ({
    pageId: String(credentials.pageId || env.FACEBOOK_PAGE_ID || '').trim(),
    accessToken: String(credentials.pageAccessToken || env.FACEBOOK_PAGE_ACCESS_TOKEN || '').trim(),
    pageName: credentials.pageName || '',
    connectedAt: credentials.connectedAt || null,
    refreshedAt: credentials.refreshedAt || null,
    expiresAt: credentials.userExpiresAt || null,
    managed: Boolean(credentials.pageAccessToken)
  });

  function saveAppConfig({ appId, appSecret, nextRedirectUri }) {
    const id = String(appId || '').trim();
    const secret = String(appSecret || '').trim();
    const callback = String(nextRedirectUri || currentApp().redirectUri).trim();
    if (!/^\d{5,30}$/.test(id)) throw new Error('Укажите корректный Meta App ID.');
    if (!secret && !currentApp().appSecret) throw new Error('Укажите Meta App Secret.');
    if (!/^https?:\/\//.test(callback)) throw new Error('Укажите полный адрес OAuth callback.');
    appConfig = { appId: id, appSecret: secret || currentApp().appSecret, redirectUri: callback };
    writeJson(appFile, appConfig);
    return publicConfig();
  }

  async function metaGet(endpoint, params, fallback) {
    const url = new URL(`https://graph.facebook.com/${graphVersion}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(key, value);
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.error) {
      const detail = payload?.error?.message;
      throw new Error(detail ? `${detail}${payload.error.code ? ` (Meta code ${payload.error.code})` : ''}` : fallback);
    }
    return payload;
  }

  async function exchangeLongLived(userToken) {
    const app = currentApp();
    return metaGet('oauth/access_token', {
      grant_type: 'fb_exchange_token', client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: userToken
    }, 'Meta не выдала долгоживущий токен.');
  }

  async function pageForUser(userToken, preferredPageId) {
    const payload = await metaGet('me/accounts', {
      fields: 'id,name,access_token,tasks', limit: '100', access_token: userToken
    }, 'Не удалось получить список Facebook-страниц.');
    const pages = Array.isArray(payload.data) ? payload.data : [];
    const page = pages.find(item => String(item.id) === String(preferredPageId)) || (pages.length === 1 ? pages[0] : null);
    if (!page) throw new Error(pages.length ? 'Выбранная страница не найдена среди доступных. Проверьте FACEBOOK_PAGE_ID.' : 'Meta не вернула доступных страниц. Проверьте роль на странице и разрешения приложения.');
    if (!page.access_token) throw new Error('Meta не выдала Page Access Token для выбранной страницы.');
    return page;
  }

  function begin(userId) {
    const app = currentApp();
    if (!app.appId || !app.appSecret) throw new Error('Сначала сохраните Meta App ID и Meta App Secret в настройках.');
    const state = crypto.randomBytes(32).toString('base64url');
    states.set(state, { userId, expires: Date.now() + 10 * 60 * 1000 });
    const url = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: app.appId,
      redirect_uri: app.redirectUri,
      state,
      response_type: 'code',
      scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_metadata,pages_messaging'
    });
    return url.toString();
  }

  async function complete({ code, state, userId }) {
    const savedState = states.get(String(state || ''));
    states.delete(String(state || ''));
    if (!savedState || savedState.expires < Date.now() || savedState.userId !== userId) throw new Error('Сессия подключения истекла. Начните подключение ещё раз.');
    const app = currentApp();
    const short = await metaGet('oauth/access_token', {
      client_id: app.appId, client_secret: app.appSecret, redirect_uri: app.redirectUri, code
    }, 'Meta не завершила авторизацию.');
    const long = await exchangeLongLived(short.access_token);
    const page = await pageForUser(long.access_token, peek().pageId);
    const now = Date.now();
    credentials = {
      pageId: String(page.id), pageName: page.name, pageAccessToken: page.access_token,
      userAccessToken: long.access_token,
      userExpiresAt: long.expires_in ? now + Number(long.expires_in) * 1000 : null,
      connectedAt: new Date(now).toISOString(), refreshedAt: new Date(now).toISOString(),
      permissions: ['pages_show_list','pages_read_engagement','pages_manage_posts','pages_manage_metadata','pages_messaging']
    };
    writeJson(credentialsFile, credentials);
    return peek();
  }

  async function refresh(force = false) {
    if (!credentials.userAccessToken) return peek();
    const refreshedAt = new Date(credentials.refreshedAt || credentials.connectedAt || 0).getTime();
    if (!force && refreshedAt > Date.now() - 25 * 24 * 60 * 60 * 1000) return peek();
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const long = await exchangeLongLived(credentials.userAccessToken);
      const page = await pageForUser(long.access_token, credentials.pageId);
      const now = Date.now();
      credentials = {
        ...credentials, pageId: String(page.id), pageName: page.name, pageAccessToken: page.access_token,
        userAccessToken: long.access_token,
        userExpiresAt: long.expires_in ? now + Number(long.expires_in) * 1000 : credentials.userExpiresAt,
        refreshedAt: new Date(now).toISOString(), lastRefreshError: null
      };
      writeJson(credentialsFile, credentials);
      return peek();
    })().catch(error => {
      credentials = { ...credentials, lastRefreshError: error.message };
      writeJson(credentialsFile, credentials);
      return peek();
    }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function status() {
    return { ...publicConfig(), ...peek(), refreshError: credentials.lastRefreshError || null };
  }

  return { begin, complete, refresh, peek, status, publicConfig, saveAppConfig, appSecret:()=>currentApp().appSecret };
}

module.exports = { createFacebookAuth };
