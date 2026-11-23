const express = require('express');
const multer = require('multer');
const fs = require('./lib/runtime-fs');
const path = require('path');
const sharp = require('sharp');
const dotenv = require('dotenv');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

dotenv.config();
const appRoot = typeof __dirname === 'string' ? __dirname : (process.env.APP_ROOT || process.cwd());

function createApp(options = {}) {
const isCloudflareWorker = options.worker === true;
const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';
const appDataDirectory = path.resolve(options.appDataDirectory || process.env.APP_DATA_DIR || appRoot);
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

function restoreBootstrapState() {
  const encoded = String(process.env.BEREG_BOOTSTRAP_STATE || '').trim();
  if (!encoded) return;
  const version = String(process.env.BEREG_BOOTSTRAP_VERSION || '1').trim();
  const marker = path.join(appDataDirectory, '.bereg-bootstrap-version');
  let appliedVersion = '';
  try { appliedVersion = fs.readFileSync(marker, 'utf8').trim(); } catch {}
  if (appliedVersion === version) return;
  const allowed = new Set([
    '.private/panel-users.json',
    '.private/panel-access.txt',
    '.private/facebook-app.json',
    '.private/facebook-oauth.json',
    '.private/meta-inbox/config.json',
    '.private/chatwoot/config.json',
    '.private/telegram/support.json',
    '.private/telegram/operator-password.key',
    'generated/app-settings.json',
    'generated/youtube-oauth.json',
    'generated/facebook-analytics-history.json'
  ]);
  let files;
  try { files = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); }
  catch { throw new Error('Не удалось прочитать BEREG_BOOTSTRAP_STATE.'); }
  for (const [relative, item] of Object.entries(files || {})) {
    if (!allowed.has(relative) || !item || typeof item.data !== 'string') continue;
    const target = path.join(appDataDirectory, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, Buffer.from(item.data, 'base64'), { mode: relative.endsWith('.key') || relative.includes('.private/') ? 0o600 : 0o600 });
  }
  fs.mkdirSync(appDataDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(marker, version, { mode: 0o600 });
}

if (!isCloudflareWorker) restoreBootstrapState();
let businessName = process.env.BUSINESS_NAME || 'ваш бизнес';
const businessType = process.env.BUSINESS_TYPE || 'услуги';
const businessLocation = process.env.BUSINESS_LOCATION || 'Венгрия';
const businessServices = process.env.BUSINESS_SERVICES || 'устный перевод и личное сопровождение в государственных учреждениях, банках, у нотариуса, врача, в страховых компаниях и других организациях';
const businessAudience = process.env.BUSINESS_AUDIENCE || 'русскоязычные жители, предприниматели и приезжающие в Венгрию люди, которым нужна помощь при общении на венгерском языке';
const aiModel = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const imageProvider = String(process.env.IMAGE_PROVIDER || 'pollinations-free').toLowerCase();
const pollinationsModel = process.env.POLLINATIONS_IMAGE_MODEL || 'flux';
const aiProvider = process.env.AI_PROVIDER || 'ollama';
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';
const generatedAudioDir = path.join(appDataDirectory, 'generated');
fs.mkdirSync(generatedAudioDir, { recursive: true });
const execFileAsync = promisify(execFile);
const videoJobs = new Map();
const sadTalkerRoot = path.join(appRoot, 'video-engine', 'SadTalker');
const sadTalkerPython = path.join(appRoot, 'video-engine', 'sadtalker-env', 'bin', 'python');
const localFfmpeg = path.join(appRoot, 'video-engine', 'sadtalker-env', 'bin', 'ffmpeg');
const defaultAvatar = path.join(appRoot, 'public', 'assets', 'default-office-avatar.png');
const videoRenderMode = String(process.env.VIDEO_RENDER_MODE || 'heygen').toLowerCase();
const videoRenderBatchSize = Math.max(1, Number.parseInt(process.env.VIDEO_RENDER_BATCH_SIZE || '8', 10) || 8);
const heygenAvatarCache = path.join(generatedAudioDir, 'heygen-avatar.json');
const analyticsHistoryPath = path.join(generatedAudioDir, 'facebook-analytics-history.json');
const facebookGraphVersion = process.env.FACEBOOK_GRAPH_API_VERSION || 'v25.0';
const appSettingsPath = path.join(generatedAudioDir, 'app-settings.json');
const youtubeOauthPath = path.join(generatedAudioDir, 'youtube-oauth.json');
const youtubeClientId = String(process.env.YOUTUBE_CLIENT_ID || '').trim();
const youtubeClientSecret = String(process.env.YOUTUBE_CLIENT_SECRET || '').trim();
const youtubeRedirectUri = String(process.env.YOUTUBE_REDIRECT_URI || `http://localhost:${port}/api/youtube/oauth/callback`).trim();
const youtubeOauthStates = new Map();
const privateDirectory = path.join(appDataDirectory, '.private');
const facebookRedirectUri = String(process.env.FACEBOOK_REDIRECT_URI || `http://localhost:${port}/api/facebook/oauth/callback`).trim();
const facebookAuth = require('./lib/facebook-auth').createFacebookAuth({
  directory: privateDirectory,
  graphVersion: facebookGraphVersion,
  redirectUri: facebookRedirectUri
});
const metaInbox = require('./lib/meta-inbox').createMetaInbox({
  directory:path.join(privateDirectory,'meta-inbox'),
  graphVersion:facebookGraphVersion,
  facebookAuth
});
const chatwootBridge = require('./lib/chatwoot-bridge').createChatwootBridge({
  directory:path.join(privateDirectory,'chatwoot')
});

const defaultAppSettings = {
  businessName,
  defaultPlatform: 'Facebook',
  youtubePeriod: 28,
  autoRefresh: true,
  refreshMinutes: 15,
  notifications: true,
  compactMode: false
};

let appSettings = { ...defaultAppSettings };
try {
  appSettings = { ...defaultAppSettings, ...JSON.parse(fs.readFileSync(appSettingsPath, 'utf8')) };
  businessName = appSettings.businessName || businessName;
} catch (error) {
  appSettings = { ...defaultAppSettings };
}

async function saveAppSettings(nextSettings) {
  appSettings = { ...appSettings, ...nextSettings };
  businessName = appSettings.businessName || businessName;
  await fs.promises.writeFile(appSettingsPath, JSON.stringify(appSettings, null, 2));
  return appSettings;
}

function getFacebookConfig() {
  return facebookAuth.peek();
}

async function readYoutubeCredentials() {
  try {
    return JSON.parse(await fs.promises.readFile(youtubeOauthPath, 'utf8'));
  } catch (error) {
    return null;
  }
}

async function writeYoutubeCredentials(credentials) {
  await fs.promises.writeFile(youtubeOauthPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

async function readGoogleResponse(response, fallback) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.error_description || fallback);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function getYoutubeAccessToken() {
  if (!youtubeClientId || !youtubeClientSecret) {
    const error = new Error('Добавьте YOUTUBE_CLIENT_ID и YOUTUBE_CLIENT_SECRET в .env.');
    error.code = 'YOUTUBE_NOT_CONFIGURED';
    throw error;
  }

  const credentials = await readYoutubeCredentials();
  if (!credentials?.refresh_token) {
    const error = new Error('Подключите YouTube-канал.');
    error.code = 'YOUTUBE_NOT_CONNECTED';
    throw error;
  }

  if (credentials.access_token && Number(credentials.expires_at || 0) > Date.now() + 60_000) {
    return credentials.access_token;
  }

  const body = new URLSearchParams({
    client_id: youtubeClientId,
    client_secret: youtubeClientSecret,
    refresh_token: credentials.refresh_token,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const refreshed = await readGoogleResponse(response, 'Не удалось обновить доступ YouTube.');
  const nextCredentials = {
    ...credentials,
    access_token: refreshed.access_token,
    expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000
  };
  await writeYoutubeCredentials(nextCredentials);
  return refreshed.access_token;
}

async function youtubeApi(url, accessToken) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000)
  });
  return readGoogleResponse(response, 'YouTube API временно недоступен.');
}

function youtubeDate(daysAgo = 0) {
  const date = new Date(Date.now() - daysAgo * 86400000);
  return date.toISOString().slice(0, 10);
}

function youtubeRows(payload) {
  const headers = (payload?.columnHeaders || []).map(item => item.name);
  return (payload?.rows || []).map(row => Object.fromEntries(headers.map((name, index) => [name, row[index]])));
}

async function getYoutubeAnalytics(period = 28) {
  const days = [7, 28, 90].includes(Number(period)) ? Number(period) : 28;
  const accessToken = await getYoutubeAccessToken();
  const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
  channelUrl.search = new URLSearchParams({ part: 'snippet,statistics', mine: 'true' });
  const channelData = await youtubeApi(channelUrl, accessToken);
  const channel = channelData.items?.[0];
  if (!channel) throw new Error('В аккаунте Google не найден YouTube-канал.');

  const reportUrl = (params) => {
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    url.search = new URLSearchParams({ ids: 'channel==MINE', startDate: youtubeDate(days), endDate: youtubeDate(1), ...params });
    return url;
  };

  const [overviewPayload, dailyPayload, topPayload] = await Promise.all([
    youtubeApi(reportUrl({ metrics: 'views,estimatedMinutesWatched,subscribersGained,averageViewDuration,averageViewPercentage' }), accessToken),
    youtubeApi(reportUrl({ dimensions: 'day', metrics: 'views', sort: 'day' }), accessToken),
    youtubeApi(reportUrl({ dimensions: 'video', metrics: 'views,estimatedMinutesWatched,averageViewPercentage', sort: '-views', maxResults: '5' }), accessToken)
  ]);

  let revenue = null;
  try {
    const revenuePayload = await youtubeApi(reportUrl({ metrics: 'estimatedRevenue' }), accessToken);
    revenue = Number(youtubeRows(revenuePayload)[0]?.estimatedRevenue || 0);
  } catch (error) {
    revenue = null;
  }

  const overview = youtubeRows(overviewPayload)[0] || {};
  const daily = youtubeRows(dailyPayload);
  const top = youtubeRows(topPayload);
  const videoIds = top.map(item => item.video).filter(Boolean);
  let videoDetails = [];
  if (videoIds.length) {
    const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videosUrl.search = new URLSearchParams({ part: 'snippet,contentDetails', id: videoIds.join(',') });
    videoDetails = (await youtubeApi(videosUrl, accessToken)).items || [];
  }
  const detailsById = new Map(videoDetails.map(item => [item.id, item]));

  return {
    live: true,
    period: days,
    channel: {
      id: channel.id,
      title: channel.snippet?.title,
      thumbnail: channel.snippet?.thumbnails?.default?.url,
      subscribers: Number(channel.statistics?.subscriberCount || 0)
    },
    overview: {
      views: Number(overview.views || 0),
      watchHours: Number(overview.estimatedMinutesWatched || 0) / 60,
      subscribersGained: Number(overview.subscribersGained || 0),
      revenue,
      averageViewDuration: Number(overview.averageViewDuration || 0),
      averageViewPercentage: Number(overview.averageViewPercentage || 0)
    },
    chart: daily.map(item => ({ date: item.day, views: Number(item.views || 0) })),
    videos: top.map(item => {
      const details = detailsById.get(item.video);
      return {
        id: item.video,
        title: details?.snippet?.title || 'Видео YouTube',
        publishedAt: details?.snippet?.publishedAt,
        thumbnail: details?.snippet?.thumbnails?.medium?.url || details?.snippet?.thumbnails?.default?.url,
        views: Number(item.views || 0),
        watchHours: Number(item.estimatedMinutesWatched || 0) / 60,
        averageViewPercentage: Number(item.averageViewPercentage || 0)
      };
    })
  };
}

function facebookErrorMessage(payload, fallback) {
  const apiError = payload?.error;
  if (!apiError) return fallback;

  const suffix = apiError.code ? ` (Meta code ${apiError.code}${apiError.error_subcode ? `/${apiError.error_subcode}` : ''})` : '';
  return `${apiError.message || fallback}${suffix}`;
}

async function readFacebookResponse(response, fallback) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    const error = new Error(facebookErrorMessage(payload, fallback));
    error.status = response.status;
    error.metaCode = payload?.error?.code;
    throw error;
  }
  return payload;
}

async function getFacebookPage() {
  await facebookAuth.refresh();
  const { pageId, accessToken } = getFacebookConfig();
  if (!pageId || !accessToken) {
    const error = new Error('Добавьте FACEBOOK_PAGE_ID и FACEBOOK_PAGE_ACCESS_TOKEN в файл .env, затем перезапустите сервер.');
    error.code = 'FACEBOOK_NOT_CONFIGURED';
    throw error;
  }

  const url = new URL(`https://graph.facebook.com/${facebookGraphVersion}/${encodeURIComponent(pageId)}`);
  url.searchParams.set('fields', 'id,name,link');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000)
  });
  return readFacebookResponse(response, 'Не удалось проверить Facebook-страницу.');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(appDataDirectory, 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 100000)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/mpeg'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Unsupported video format. Please upload MP4, MOV, AVI, WEBM or MPEG.'));
  }
});

const posts = [];

function metricValuesByDate(insights, metricName) {
  const item = (insights?.data || []).find(entry => entry.name === metricName);
  return (item?.values || []).map(value => ({
    date: value.end_time,
    value: Number(typeof value.value === 'object' ? Object.values(value.value || {}).reduce((sum, current) => sum + Number(current || 0), 0) : value.value || 0)
  }));
}

function sumMetricWindow(values, startDaysAgo, endDaysAgo) {
  const now = Date.now();
  const start = now - startDaysAgo * 24 * 60 * 60 * 1000;
  const end = now - endDaysAgo * 24 * 60 * 60 * 1000;
  return values.reduce((sum, item) => {
    const timestamp = new Date(item.date).getTime();
    return timestamp >= start && timestamp < end ? sum + item.value : sum;
  }, 0);
}

function realPercentChange(current, previous) {
  if (previous === null || previous === undefined) return null;
  if (!previous) return current ? null : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

async function updateAnalyticsHistory(snapshot) {
  let history = [];
  try {
    history = JSON.parse(await fs.promises.readFile(analyticsHistoryPath, 'utf8'));
    if (!Array.isArray(history)) history = [];
  } catch (error) {
    history = [];
  }

  const today = new Date().toISOString().slice(0, 10);
  const entry = { date: today, ...snapshot };
  const existingIndex = history.findIndex(item => item.date === today);
  if (existingIndex >= 0) history[existingIndex] = entry;
  else history.push(entry);
  history = history.filter(item => new Date(item.date).getTime() >= Date.now() - 35 * 24 * 60 * 60 * 1000);
  await fs.promises.writeFile(analyticsHistoryPath, JSON.stringify(history, null, 2));

  const target = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const baseline = history
    .filter(item => new Date(item.date).getTime() <= target)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  return baseline || null;
}

async function getRealFacebookAnalytics() {
  await facebookAuth.refresh();
  const { pageId, accessToken } = getFacebookConfig();
  if (!pageId || !accessToken) throw new Error('Facebook не подключён.');

  const pageUrl = new URL(`https://graph.facebook.com/${facebookGraphVersion}/${encodeURIComponent(pageId)}`);
  pageUrl.searchParams.set('fields', 'id,name,fan_count,followers_count,talking_about_count');
  const pageResponse = await fetch(pageUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000)
  });
  const page = await readFacebookResponse(pageResponse, 'Не удалось получить статистику страницы.');

  const until = new Date();
  const since = new Date(until.getTime() - 15 * 24 * 60 * 60 * 1000);
  const insightsUrl = new URL(`https://graph.facebook.com/${facebookGraphVersion}/${encodeURIComponent(pageId)}/insights`);
  insightsUrl.searchParams.set('metric', 'page_post_engagements,page_views_total,page_daily_follows');
  insightsUrl.searchParams.set('period', 'day');
  insightsUrl.searchParams.set('since', since.toISOString().slice(0, 10));
  insightsUrl.searchParams.set('until', until.toISOString().slice(0, 10));
  const insightsResponse = await fetch(insightsUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000)
  });
  const insights = insightsResponse.ok ? await insightsResponse.json() : { data: [] };
  const engagementValues = metricValuesByDate(insights, 'page_post_engagements');
  const viewValues = metricValuesByDate(insights, 'page_views_total');
  const followValues = metricValuesByDate(insights, 'page_daily_follows');
  const currentViews = sumMetricWindow(viewValues, 7, 0);
  const previousViews = sumMetricWindow(viewValues, 14, 7);
  const currentEngagement = sumMetricWindow(engagementValues, 7, 0);
  const previousEngagement = sumMetricWindow(engagementValues, 14, 7);
  const currentFollows = sumMetricWindow(followValues, 7, 0);
  const effectiveCurrentEngagement = currentEngagement || Number(page.talking_about_count || 0);
  const currentFollowers = Number(page.followers_count ?? page.fan_count ?? 0);
  const historyBaseline = await updateAnalyticsHistory({
    reach: currentViews,
    engagement: effectiveCurrentEngagement,
    ctr: 0,
    followers: currentFollowers
  });
  const labels = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const chartSource = viewValues.length ? viewValues : engagementValues;
  const chart = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.now() - (6 - index) * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    const point = chartSource.find(item => String(item.date || '').startsWith(key));
    return { day: labels[date.getDay()], reach: point?.value || 0 };
  });

  return {
    live: true,
    page: { id: page.id, name: page.name },
    overview: {
      reach: currentViews,
      engagement: effectiveCurrentEngagement,
      ctr: 0,
      followers: currentFollowers,
      followsThisWeek: currentFollows
    },
    changes: {
      reach: realPercentChange(currentViews, viewValues.length ? previousViews : historyBaseline?.reach),
      engagement: realPercentChange(effectiveCurrentEngagement, engagementValues.length ? previousEngagement : historyBaseline?.engagement),
      ctr: realPercentChange(0, historyBaseline?.ctr),
      followers: historyBaseline ? currentFollowers - Number(historyBaseline.followers || 0) : null
    },
    chart
  };
}

function normalizePost(post) {
  return {
    ...post,
    metrics: post.metrics || { reach: 0, engagement: 0, clicks: 0 }
  };
}

function buildPremiumFallbackPost(topic) {
  const raw = (topic || '').trim();
  const safe = raw || `продвижение ${businessType} для ${businessName}`;
  const normalized = safe.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();

  const toHeadline = value => value
    .split(' ')
    .map((word, idx) => {
      const lowerWord = word.toLowerCase();
      if (idx === 0 || ['по', 'для', 'и', 'в', 'на', 'с', 'из', 'как', 'без', 'не', 'а', 'что', 'это'].includes(lowerWord)) {
        return lowerWord === 'и' ? 'и' : lowerWord;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');

  const cleanTitle = toHeadline(normalized);

  let headline = `🔥 ${cleanTitle}: как сделать сильное первое впечатление и превратить интерес в доверие.`;
  let intro = 'Хороший контент работает не только как информация — он помогает человеку понять ценность, почувствовать доверие и принять решение без лишнего давления.';
  let benefits = [
    'Сильный первый контакт и понятная подача',
    'Больше доверия и вовлечённости у аудитории',
    'Рост интереса без перегруза и навязчивости'
  ];

  if (/перевод|переводчик|венгр|язык/.test(lower)) {
    headline = `🔥 ${cleanTitle}: когда качество коммуникации становится вашим конкурентным преимуществом.`;
    intro = 'Услуги переводчика — это не просто перевод слов. Это точная передача смысла, доверия и профессионального уровня в каждой коммуникации с клиентом, партнёром и аудиторией.';
    benefits = [
      'Точная передача смысла без потери контекста',
      'Повышение доверия к вашему бренду и бизнесу',
      'Легче вести переговоры, коммуникацию и продажи'
    ];
  } else if (/курс|обучение|мастер|школа/.test(lower)) {
    headline = `🔥 ${cleanTitle}: результат, который хочется получить уже сегодня.`;
    intro = 'Люди выбирают не просто знания, а понятную систему, которая помогает быстро увидеть результат, почувствовать ясность и сделать следующий шаг без сомнений.';
    benefits = [
      'Полная ясность в ценности и пользе продукта',
      'Усиление экспертности и доверия к бренду',
      'Больше людей, которые готовы действовать сразу'
    ];
  } else if (/космет|красота|уход|бьюти|салон/.test(lower)) {
    headline = `✨ ${cleanTitle}: красота, доверие и эффект, который хочется сохранить.`;
    intro = 'Когда продукт подан красиво и честно, аудитория воспринимает его не как обычное предложение, а как решение, которое действительно важно для её жизни и образа.';
    benefits = [
      'Эстетическая подача, которая цепляет сразу',
      'Понимание пользы без перегруза и скуки',
      'Лучшая лояльность и запоминаемость бренда'
    ];
  } else if (/бизнес|маркет|бренд|продаж|услуга|сервис|консалт/.test(lower)) {
    headline = `📈 ${cleanTitle}: как показать ценность продукта так, чтобы клиент захотел действовать.`;
    intro = 'Хороший пост не просто рассказывает о продукте. Он объясняет, почему это важно именно здесь и сейчас, и помогает аудитории увидеть выгоду в реальной жизни.';
    benefits = [
      'Понятная логика и сильная продающая структура',
      'Больше интереса со стороны реальной аудитории',
      'Рост доверия и конверсии без давления'
    ];
  }

  const bullets = benefits.map(item => `✅ ${item}`).join('\n');
  const closing = 'Когда подача сильная, понятная и живой, аудитория перестаёт просто читать — она начинает видеть в вас решение своей задачи.';
  const cta = `📩 Если хотите, чтобы ваш контент выглядел так же профессионально и привлекательно — напишите “Хочу” в комментариях или сохраните этот пост.\n\n#Brand #Marketing #SocialMedia #Growth`;

  return `${headline}\n\n${intro}\n\n${bullets}\n\n${closing}\n\n${cta}`;
}

function buildPremiumFallbackVideo(prompt) {
  const raw = (prompt || '').trim() || `человек в офисе говорит про ${businessType} в ${businessName}`;
  const normalized = raw.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();

  let voiceover = `Сегодня я хочу показать, почему ${normalized.toLowerCase()} — это важный шаг к росту доверия, узнаваемости и реальных продаж. Когда всё подано понятно и профессионально, аудитория начинает чувствовать ценность продукта сразу.`;

  if (/перевод|переводчик|венгр/.test(lower)) {
    voiceover = 'Сегодня я хочу показать, почему услуги переводчика в Венгрии — это не просто помощь в тексте, а реальная поддержка бизнеса, доверия и коммуникации. Когда всё понятно и грамотно, результат ощущается сразу.';
  } else if (/курс|обучение|маркет/.test(lower)) {
    voiceover = `Сегодня я покажу, почему ${normalized.toLowerCase()} — это мощный инструмент для роста экспертности и доверия. Люди запоминают не только идею, но и ощущение пользы, которая приходит после принятия решения.`;
  }

  return {
    title: normalized.charAt(0).toUpperCase() + normalized.slice(1),
    sceneTitle: normalized.charAt(0).toUpperCase() + normalized.slice(1),
    scene: 'Реалистичная озвучка / офисный кадр / живой диктор',
    voiceover,
    audioLabel: 'Natural voice / 24 kHz / studio mix',
    subtitle: 'Реалистичная съемка в офисе, естественная речь, живой диктор, мягкий свет, аудитория видит человека и слышит его голос без искусственной шапки.'
  };
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();

  return (payload?.output || [])
    .flatMap(item => item?.content || [])
    .filter(item => item?.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n')
    .trim();
}

function normalizePostBrief({ topic, platform, tone, length, goal, audience, language }) {
  const languages={ru:'Russian',uk:'Ukrainian',en:'English',hu:'Hungarian',vi:'Vietnamese'};
  const goals = {
    leads: 'получить обращения и заявки на сопровождение',
    trust: 'укрепить доверие и показать профессионализм переводчика',
    educate: 'объяснить процедуру и подготовить клиента к визиту',
    awareness: 'рассказать об услуге и ситуациях, когда она необходима'
  };
  const audiences = {
    newcomers: 'русскоязычные люди, недавно приехавшие в Венгрию',
    residents: 'русскоязычные жители Венгрии',
    business: 'предприниматели и представители компаний в Венгрии',
    all: businessAudience
  };

  return {
    topic: String(topic || '').trim(),
    platform: ['Facebook', 'Instagram', 'Telegram', 'LinkedIn'].includes(platform) ? platform : 'Facebook',
    tone: ['экспертный', 'дружелюбный', 'продающий', 'вдохновляющий'].includes(tone) ? tone : 'экспертный',
    length: ({ short: 'до 500 знаков', medium: '700–1000 знаков', long: '1200–1800 знаков' })[length] || '700–1000 знаков',
    goal: goals[goal] || goals.leads,
    audience: audiences[audience] || audiences.all,
    language: languages[language] || 'Russian'
  };
}

function buildBusinessBrief(options) {
  const brief = normalizePostBrief(options);
  return `Контекст бизнеса:
- Страница: ${businessName}
- Направление: ${businessType}
- География: ${businessLocation}
- Реальные услуги: ${businessServices}
- Целевая аудитория: ${brief.audience}
- Цель публикации: ${brief.goal}
- Конкретная тема этого поста: ${brief.topic}
- Площадка: ${brief.platform}
- Язык публикации: ${brief.language}
- Тон: ${brief.tone}
- Длина: ${brief.length}`;
}

async function generateAiPostViaOpenAI(options) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('Добавьте OPENAI_API_KEY в файл .env и перезапустите сервер.');
    error.code = 'OPENAI_NOT_CONFIGURED';
    throw error;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: aiModel,
        max_output_tokens: 700,
        store: false,
        instructions: `Ты — SMM-редактор страницы профессионального переводчика в Венгрии. Пиши только на языке, указанном в контексте бизнеса. Каждый текст должен быть только об услугах перевода и сопровождения клиента при решении конкретной задачи. Не превращай тему в общий пост о маркетинге. Пиши от лица специалиста, спокойно, понятно и с уважением к тревогам клиента. Возвращай только готовый текст публикации.`,
        input: `${buildBusinessBrief(options)}

Покажи конкретную жизненную ситуацию по указанной теме: с чем человек сталкивается, чем помогает переводчик и какой следующий шаг сделать. Описывай только перевод, подготовку к разговору и сопровождение коммуникации; не добавляй советы за юриста, врача или банковского специалиста. Никогда не отказывайся писать пост и не вставляй в текст предупреждения о своих ограничениях. Не выдумывай цены, адреса, сроки, гарантии и отзывы. Заверши уместным предложением написать в личные сообщения. Используй не более 2 эмодзи и до 5 хештегов.`
      })
    });

    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      const apiError = details?.error || {};
      let message = apiError.message || `OpenAI вернул ошибку ${response.status}.`;
      if (response.status === 429 && /credits|quota|billing/i.test(message)) {
        message = 'На аккаунте OpenAI закончились API-кредиты. Пополните баланс в настройках Billing и повторите запрос.';
      }
      const error = new Error(message);
      error.status = response.status;
      error.code = apiError.code || apiError.type;
      throw error;
    }

    const payload = await response.json();
    let content = extractResponseText(payload);
    if (!content) throw new Error('OpenAI не вернул текст поста. Попробуйте другую тему.');

    content = content
      .replace(/^```(?:json|txt)?/i, '')
      .replace(/```$/i, '')
      .trim();

    return content;
  } catch (error) {
    console.error('OpenAI post generation failed:', error.message);
    throw error;
  }
}

function buildPostPrompt(options) {
  return `Ты — SMM-редактор страницы профессионального переводчика в Венгрии. Пиши строго на языке, указанном в контексте бизнеса.

${buildBusinessBrief(options)}

Создай готовый пост строго по конкретной теме. Покажи реальную ситуацию клиента, объясни роль переводчика и сопровождения, сними тревогу и закончи приглашением написать в личные сообщения. Не превращай текст в общие рассуждения о бизнесе или маркетинге. Описывай только точный перевод, подготовку к разговору и сопровождение коммуникации; не добавляй советы за юриста, врача или банковского специалиста. Никогда не отказывайся от задачи и не упоминай ограничения модели. Не выдумывай цены, скидки, сроки, гарантии, отзывы, адреса и телефоны. Не пиши пояснения или markdown-заголовки. Используй не более 2 эмодзи и до 5 хештегов. Верни только текст публикации.`;
}

async function generateAiPostViaOllama(options) {
  let response;
  try {
    response = await fetch(`${ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        prompt: buildPostPrompt(options),
        stream: false,
        think: false,
        options: { temperature: 0.45 }
      }),
      signal: AbortSignal.timeout(120000)
    });
  } catch (cause) {
    const error = new Error(`Бесплатная локальная модель не запущена. Запустите Ollama, выполните «ollama pull ${ollamaModel}» и перезапустите приложение.`);
    error.code = 'OLLAMA_UNAVAILABLE';
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const missingModel = response.status === 404 || /not found/i.test(payload?.error || '');
    const error = new Error(missingModel
      ? `Модель ${ollamaModel} не установлена. Выполните: ollama pull ${ollamaModel}`
      : (payload?.error || 'Ollama не смог сгенерировать пост.'));
    error.code = missingModel ? 'OLLAMA_MODEL_MISSING' : 'OLLAMA_ERROR';
    throw error;
  }

  const text = String(payload?.response || '')
    .trim()
    .replace(/^(["«])/, '')
    .replace(/(["»])$/, '')
    .trim();
  if (!text) throw new Error('Локальная модель не вернула текст поста.');
  return text;
}

async function generateAdvisorViaOllama(metrics) {
  const prompt = `Ты — SMM-стратег для бизнеса профессионального переводчика в Венгрии.
Используй только приведённые реальные данные и не придумывай цифры:
Facebook за 7 дней: просмотры страницы ${metrics.facebook.views}, вовлечённость ${metrics.facebook.engagement}, всего подписчиков ${metrics.facebook.followers}, новых подписчиков ${metrics.facebook.newFollowers}.
YouTube за ${metrics.youtube.period} дней: просмотры ${metrics.youtube.views}, часов просмотра ${metrics.youtube.watchHours}, новых подписчиков ${metrics.youtube.subscribersGained}, среднее удержание ${metrics.youtube.retention}%.

Дай на русском ровно 5 коротких, конкретных рекомендаций для привлечения клиентов на услуги перевода и сопровождения. Учитывай, что нулевые значения являются реальными. Для каждого пункта укажи действие и ожидаемый практический результат, но не обещай гарантированный рост и не выдумывай прогнозные проценты. Без markdown-заголовков, по одному пункту на строку.`;
  let response;
  try {
    response = await fetch(`${ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ollamaModel, prompt, stream: false, think: false, options: { temperature: 0.25 } }),
      signal: AbortSignal.timeout(120000)
    });
  } catch (error) {
    throw new Error('Локальная AI-модель сейчас недоступна.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'AI не смог сформировать рекомендации.');
  const text = String(payload?.response || '').trim();
  if (!text) throw new Error('AI не вернул рекомендации.');
  return text;
}

function wantsPostImage(topic) {
  // Всегда генерировать картинку для постов по умолчанию
  return true;
}

function escapeSvgText(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

async function generateLocalPostGraphic(options) {
  const lower = String(options.topic || '').toLowerCase();
  let title = 'ПЕРЕВОДЧИК';
  let subtitle = 'Личное сопровождение';
  if (/банк|сч[её]т|кредит/.test(lower)) subtitle = 'Помощь в банке';
  else if (/врач|больниц|медиц/.test(lower)) subtitle = 'У врача';
  else if (/нотари/.test(lower)) subtitle = 'У нотариуса';
  else if (/гос|миграц|ведомств|учрежден/.test(lower)) subtitle = 'В госучреждениях';

  // Рандомизируем цвета и градиенты для разных картинок
  const colorSchemes = [
    { bg1: '#07152d', bg2: '#123866', bg3: '#081426', accent1: '#ef4444', accent2: '#22c55e', circle1: '#ffffff', circle2: '#3b82f6' },
    { bg1: '#1a1a2e', bg2: '#16213e', bg3: '#0f3460', accent1: '#e94560', accent2: '#00d4ff', circle1: '#f39c12', circle2: '#8e44ad' },
    { bg1: '#0a0e27', bg2: '#1d3557', bg3: '#14213d', accent1: '#f77f00', accent2: '#06a77d', circle1: '#fcbf49', circle2: '#eae2b7' },
    { bg1: '#264653', bg2: '#2a9d8f', bg3: '#1a4d43', accent1: '#e76f51', accent2: '#f4a261', circle1: '#e9c46a', circle2: '#4d908e' },
    { bg1: '#03071e', bg2: '#370617', bg3: '#6a040f', accent1: '#ffc300', accent2: '#00d9ff', circle1: '#ff006e', circle2: '#fb5607' }
  ];
  const scheme = colorSchemes[Math.floor(Math.random() * colorSchemes.length)];

  // Рандомизируем макет элементов
  const layouts = [
    { titleY: 280, subtitleY: 380, ctaY: 540 },
    { titleY: 320, subtitleY: 420, ctaY: 580 },
    { titleY: 250, subtitleY: 360, ctaY: 500 }
  ];
  const layout = layouts[Math.floor(Math.random() * layouts.length)];

  const base = `post-image-${Date.now()}-${Math.round(Math.random() * 100000)}`;
  const svgPath = path.join(generatedAudioDir, `${base}.svg`);
  const outputPath = path.join(generatedAudioDir, `${base}.png`);
  
  // Рандомизируем фигуры на фоне
  const circle1X = Math.random() > 0.5 ? 150 : 850;
  const circle2X = Math.random() > 0.5 ? 120 : 900;
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${scheme.bg1}"/>
        <stop offset="0.55" stop-color="${scheme.bg2}"/>
        <stop offset="1" stop-color="${scheme.bg3}"/>
      </linearGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
        <stop stop-color="${scheme.accent1}"/>
        <stop offset="0.5" stop-color="#ffffff"/>
        <stop offset="1" stop-color="${scheme.accent2}"/>
      </linearGradient>
    </defs>
    <rect width="1080" height="1080" fill="url(#bg)"/>
    <circle cx="${circle1X}" cy="180" r="270" fill="${scheme.circle1}" opacity=".055"/>
    <circle cx="${circle2X}" cy="900" r="330" fill="${scheme.circle2}" opacity=".08"/>
    <path d="M0 820 L130 760 230 805 340 700 420 790 520 730 620 810 710 690 790 785 900 720 1080 800V1080H0Z" fill="${scheme.bg3}" opacity=".85"/>
    <path d="M720 760V500h42v260m-70 0h210m-160-260 18-90 18 90m40 260V570h62v190m-31-190v-70" fill="none" stroke="#dbeafe" stroke-width="10" opacity=".32"/>
    <rect x="94" y="102" width="300" height="12" rx="6" fill="url(#accent)"/>
    <text x="94" y="${layout.titleY}" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="76" font-weight="800">${escapeSvgText(title)}</text>
    <text x="94" y="${layout.subtitleY}" fill="#bfdbfe" font-family="Arial,Helvetica,sans-serif" font-size="56" font-weight="600">${escapeSvgText(subtitle)}</text>
    <text x="94" y="${layout.ctaY - 60}" fill="#dbeafe" font-family="Arial,Helvetica,sans-serif" font-size="34">Понятно • Спокойно • Профессионально</text>
    <rect x="94" y="${layout.ctaY}" width="440" height="88" rx="44" fill="#ffffff" opacity=".12"/><text x="138" y="${layout.ctaY + 58}" fill="#ffffff" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="700">Напишите в личные сообщения</text>
  </svg>`;
  
  await fs.promises.writeFile(svgPath, svg, 'utf8');
  try {
    await execFileAsync('/usr/bin/sips', ['-s', 'format', 'png', svgPath, '--out', outputPath], { timeout: 30000 });
  } finally {
    fs.unlink(svgPath, () => {});
  }
  return { imageUrl: `/generated/${base}.png`, imagePath: `${base}.png`, model: 'локальный генератор (разные варианты)' };
}

async function generatePostImage(options) {
  // Генерируем различные картинки через Pollinations free API каждый раз
  try {
    const topicLower = String(options.topic || '').toLowerCase();
    
    // Получаем текст для темы
    const textLabel = getTextLabelForTopic(topicLower);
    
    // Варианты ситуаций для разных тем
    const situations = [];
    if (/банк|сч[её]т|кредит|счёт/.test(topicLower)) {
      situations.push(
        'professional interpreter in a modern bank lobby helping client open account, daylight',
        'businessman in suit in elegant Budapest bank interior with modern glass and metal design',
        'two people reviewing documents together in a professional bank meeting room, Budapest',
        'modern bank interior with professional atmosphere, client consultation scene'
      );
    } else if (/врач|больниц|медиц|здоров|болезн|лечени/.test(topicLower)) {
      situations.push(
        'medical consultation with professional interpreter in modern Budapest clinic',
        'healthcare provider explaining diagnosis to patient with interpreter, clinical setting',
        'modern medical office with professional doctor and patient discussing health',
        'medical consultation scene in bright modern hospital, professional atmosphere'
      );
    } else if (/нотари|документ|свидетельств|регистр|виза/.test(topicLower)) {
      situations.push(
        'notary office in Budapest with professional interpreter helping client review legal documents',
        'document signing ceremony with lawyer and interpreter in elegant Budapest office',
        'professional environment with paperwork and consultants reviewing government documents',
        'modern notary office with people reviewing contracts and official papers'
      );
    } else if (/гос|миграц|ведомств|учрежден|иммигр/.test(topicLower)) {
      situations.push(
        'professional interpreter assisting client at Budapest government office window',
        'immigration office consultation scene with professionals helping with paperwork',
        'modern government building interior with courteous public service atmosphere',
        'government office reception with professional staff assisting clients'
      );
    } else {
      situations.push(
        'professional business consultation in modern Budapest office setting, daylight',
        'professional service provider helping satisfied client with consultation',
        'modern Budapest office interior with professional business atmosphere',
        'contemporary professional environment with consultants and clients meeting'
      );
    }

    // Случайно выбираем ситуацию
    const situation = situations[Math.floor(Math.random() * situations.length)];
    
    // Варианты стилей и света
    const lightings = ['natural daylight', 'bright studio lighting', 'soft window lighting', 'professional ambient lighting'];
    const lighting = lightings[Math.floor(Math.random() * lightings.length)];
    
    // Варианты эмоций/атмосферы
    const moods = ['professional and trustworthy', 'welcoming and supportive', 'calm and competent', 'friendly and expert'];
    const mood = moods[Math.floor(Math.random() * moods.length)];

    const fullPrompt = `${situation}, ${lighting}, ${mood}, business photography, realistic people, professional setting, no text, no logo, no watermark, no Cyrillic text`;
    
    // Генерируем уникальный seed каждый раз
    const seed = Math.floor(Math.random() * 1000000000);
    
    const imageUrl = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}`);
    imageUrl.searchParams.set('model', 'flux-pro');
    imageUrl.searchParams.set('width', '1024');
    imageUrl.searchParams.set('height', '1024');
    imageUrl.searchParams.set('nologo', 'true');
    imageUrl.searchParams.set('seed', String(seed));
    
    console.log(`Generating Pollinations image with seed ${seed}: ${fullPrompt.substring(0, 80)}...`);
    
    const response = await fetch(imageUrl.toString(), {
      timeout: 60000,
      signal: AbortSignal.timeout(60000)
    });
    
    if (!response.ok) throw new Error(`Pollinations returned ${response.status}`);
    
    const arrayBuffer = await response.arrayBuffer();
    let imageBuffer = Buffer.from(arrayBuffer);
    if (!imageBuffer?.length) throw new Error('No image data received');

    // Добавляем текст на картинку
    imageBuffer = await addTextToImage(imageBuffer, textLabel);

    const filename = `post-image-${Date.now()}-${seed}.jpg`;
    await fs.promises.writeFile(path.join(generatedAudioDir, filename), imageBuffer);
    console.log(`✓ Generated with text: ${filename}`);
    return { imageUrl: `/generated/${filename}`, imagePath: filename, model: 'Pollinations AI (flux-pro)' };
  } catch (error) {
    console.log('Image generation failed:', error.message);
    return generateLocalPostGraphic(options);
  }
}

// Функция для добавления текста на картинку
async function addTextToImage(imageBuffer, text) {
  try {
    // Получаем метаданные картинки
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;
    
    // Создаём SVG с текстом, соответствующий размерам картинки
    const textSvg = `<svg width="${width}" height="200">
      <defs>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="2" dy="2" stdDeviation="3" flood-opacity="0.8"/>
        </filter>
      </defs>
      <rect x="0" y="0" width="${width}" height="200" fill="rgba(0, 0, 0, 0.5)" filter="url(#shadow)"/>
      <text x="${width/2}" y="110" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="white" text-anchor="middle">${text}</text>
    </svg>`;
    
    const textBuffer = Buffer.from(textSvg);
    
    // Объединяем картинку с текстом
    const result = await sharp(imageBuffer)
      .composite([
        {
          input: textBuffer,
          top: 0,
          left: 0,
          blend: 'over'
        }
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
    
    return result;
  } catch (error) {
    console.log('Error adding text to image:', error.message);
    return imageBuffer; // Возвращаем оригинальную картинку если ошибка
  }
}

// Функция для получения текста в зависимости от темы
function getTextLabelForTopic(topicLower) {
  if (/банк|сч[её]т|кредит|счёт/.test(topicLower)) {
    return '💼 Открытие счёта в банке';
  } else if (/врач|больниц|медиц|здоров|болезн|лечени/.test(topicLower)) {
    return '🏥 Медицинское обслуживание';
  } else if (/нотари|документ|свидетельств|регистр/.test(topicLower)) {
    return '📋 Нотариальные услуги';
  } else if (/виза|иммигр|миграц/.test(topicLower)) {
    return '📝 Виза и иммиграция';
  } else if (/гос|ведомств|учрежден/.test(topicLower)) {
    return '🏛️ Государственные услуги';
  } else {
    return '✅ Профессиональная помощь';
  }
}

async function isOllamaReady() {
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return false;
    const payload = await response.json();
    return (payload.models || []).some(item => item.name === ollamaModel || item.model === ollamaModel);
  } catch (error) {
    return false;
  }
}

async function generateSpeechAudio(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.82,
          style: 0.28,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs failed: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `voice-${Date.now()}.mp3`;
    const target = path.join(generatedAudioDir, filename);
    fs.writeFileSync(target, buffer);
    return `/generated/${filename}`;
  } catch (error) {
    console.error('Speech generation failed:', error.message);
    return null;
  }
}

async function generateVideoViaOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: aiModel,
        temperature: 0.8,
        messages: [
          {
            role: 'system',
            content: `Ты — продюсер видеоконтента для Facebook. Создавай сценарий для реалистичного рекламного ролика с живым человеком в офисе, который говорит перед камерой. Делай сценарий как будто это реальная видеозапись, с нормальной естественной речью, не абстрактным описанием. Применяй тему: ${businessName}, ${businessType}.`
          },
          {
            role: 'user',
            content: `Сделай сценарий для 25-30 секунды ролика по теме: ${prompt || 'продвижение бизнеса'}. Укажи только короткий текст озвучки, который звучит как реальная речь человека в офисе на камеру.`
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI video script failed: ${response.status}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (content) {
      const audioUrl = await generateSpeechAudio(content);
      return {
        title: (prompt || 'Рекламный ролик').trim(),
        sceneTitle: (prompt || 'Рекламный ролик').trim(),
        scene: 'Реалистичная озвучка / офисный кадр / живой диктор',
        voiceover: content,
        audioUrl,
        audioLabel: 'Natural voice / 24 kHz / studio mix',
        subtitle: 'Реалистичная съемка в офисе, естественная речь, живой диктор, мягкий свет, аудиторский кадр.'
      };
    }
  } catch (error) {
    console.error('OpenAI video generation failed:', error.message);
  }

  return null;
}

async function generateLocalVideoScript(prompt) {
  const topic = String(prompt || '').trim() || 'продвижение бизнеса';
  const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      stream: false,
      think: false,
      options: { temperature: 0.35, num_predict: 150 },
      prompt: `Напиши только текст естественной русской речи для короткого видео на 5–8 секунд. Человек сидит в офисе и спокойно говорит в камеру. Тема: ${topic}. Бизнес: ${businessName}, ${businessType}. Не используй заголовки, кавычки, ремарки, эмодзи, списки и выдуманные цифры. Одно короткое предложение, не более 16 слов.`
    }),
    signal: AbortSignal.timeout(120000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.response) throw new Error(data.error || 'Локальная модель не создала сценарий.');
  const clean = String(data.response)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^(["«])|(["»])$/g, '')
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  return words.length > 16 ? `${words.slice(0, 16).join(' ').replace(/[,:;–-]+$/, '')}.` : clean;
}

async function renderFastAvatarVideo(audioPath, outputPath) {
  await execFileAsync(localFfmpeg, [
    '-y',
    '-loop', '1',
    '-framerate', '25',
    '-i', defaultAvatar,
    '-i', audioPath,
    '-vf', "scale=760:760:force_original_aspect_ratio=increase,crop=720:720,zoompan=z='min(zoom+0.00035,1.025)':d=1:s=720x720:fps=25,format=yuv420p",
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '24',
    '-tune', 'stillimage',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    outputPath
  ], { timeout: 2 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 });
}

async function renderOpenAiVideo(script, prompt, outputPath, onProgress) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Для реалистичного быстрого видео нужен OPENAI_API_KEY.');

  const form = new FormData();
  form.append('model', process.env.OPENAI_VIDEO_MODEL || 'sora-2');
  form.append('seconds', process.env.OPENAI_VIDEO_SECONDS || '8');
  form.append('size', process.env.OPENAI_VIDEO_SIZE || '1280x720');
  form.append('prompt', [
    'Photorealistic single continuous camera shot of the person from the reference image in a modern office.',
    'The person looks naturally into the camera, speaks Russian with accurate visible lip sync, blinks, breathes, makes subtle head movements and restrained natural hand gestures.',
    'Preserve the same identity, face, clothes and office setting. Natural skin texture and soft daylight. No captions, text, cuts, music or voiceover narrator.',
    `Topic: ${String(prompt || '').trim() || 'business promotion'}.`,
    `The person says in Russian exactly: «${script}»`
  ].join(' '));
  const avatar = fs.readFileSync(defaultAvatar);
  form.append('input_reference', new Blob([avatar], { type: 'image/png' }), 'avatar.png');

  const createResponse = await fetch('https://api.openai.com/v1/videos', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120000)
  });
  const created = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok || !created.id) {
    throw new Error(created.error?.message || `OpenAI video create failed: ${createResponse.status}`);
  }

  let video = created;
  const deadline = Date.now() + 12 * 60 * 1000;
  while (!['completed', 'failed'].includes(video.status)) {
    if (Date.now() >= deadline) throw new Error('OpenAI не успел создать видео за 12 минут.');
    await new Promise(resolve => setTimeout(resolve, 5000));
    const statusResponse = await fetch(`https://api.openai.com/v1/videos/${created.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30000)
    });
    video = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) throw new Error(video.error?.message || `OpenAI video status failed: ${statusResponse.status}`);
    onProgress?.(Number(video.progress) || 0);
  }
  if (video.status === 'failed') throw new Error(video.error?.message || 'OpenAI не смог создать видео.');

  const contentResponse = await fetch(`https://api.openai.com/v1/videos/${created.id}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(120000)
  });
  if (!contentResponse.ok) throw new Error(`OpenAI video download failed: ${contentResponse.status}`);
  fs.writeFileSync(outputPath, Buffer.from(await contentResponse.arrayBuffer()));
}

function getHeyGenApiKey() {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error('Добавьте HEYGEN_API_KEY в файл .env и перезапустите сервер.');
  return apiKey;
}

async function uploadHeyGenAsset(filePath, mimeType) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: mimeType }), path.basename(filePath));
  const response = await fetch('https://api.heygen.com/v3/assets', {
    method: 'POST',
    headers: { 'x-api-key': getHeyGenApiKey() },
    body: form,
    signal: AbortSignal.timeout(120000)
  });
  const payload = await response.json().catch(() => ({}));
  const assetId = payload.data?.asset_id || payload.data?.id || payload.asset_id;
  if (!response.ok || !assetId) throw new Error(payload.message || payload.error?.message || `HeyGen asset upload failed: ${response.status}`);
  return assetId;
}

async function getOrCreateHeyGenAvatar() {
  if (process.env.HEYGEN_AVATAR_ID) return process.env.HEYGEN_AVATAR_ID;
  try {
    const cached = JSON.parse(fs.readFileSync(heygenAvatarCache, 'utf8'));
    if (cached.avatarId) return cached.avatarId;
  } catch {}

  const assetId = await uploadHeyGenAsset(defaultAvatar, 'image/png');
  const response = await fetch('https://api.heygen.com/v3/avatars', {
    method: 'POST',
    headers: { 'x-api-key': getHeyGenApiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'photo',
      name: 'SMM Panel Office Avatar',
      file: { type: 'asset_id', asset_id: assetId }
    }),
    signal: AbortSignal.timeout(120000)
  });
  const payload = await response.json().catch(() => ({}));
  const avatarId = payload.data?.avatar_item?.id;
  if (!response.ok || !avatarId) throw new Error(payload.message || payload.error?.message || `HeyGen avatar create failed: ${response.status}`);
  fs.writeFileSync(heygenAvatarCache, JSON.stringify({ avatarId }, null, 2));
  return avatarId;
}

async function renderHeyGenVideo(audioPath, outputPath, onStage) {
  onStage('Подготавливаю реалистичного аватара');
  const [avatarId, audioAssetId] = await Promise.all([
    getOrCreateHeyGenAvatar(),
    uploadHeyGenAsset(audioPath, 'audio/wav')
  ]);
  onStage('HeyGen анимирует лицо и движения');
  const createResponse = await fetch('https://api.heygen.com/v3/videos', {
    method: 'POST',
    headers: { 'x-api-key': getHeyGenApiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'avatar',
      avatar_id: avatarId,
      audio_asset_id: audioAssetId,
      title: `SMM Panel ${new Date().toISOString()}`,
      resolution: process.env.HEYGEN_VIDEO_RESOLUTION || '1080p',
      aspect_ratio: '16:9',
      output_format: 'mp4',
      motion_prompt: process.env.HEYGEN_MOTION_PROMPT || 'Natural confident presentation: maintain eye contact, blink naturally, use subtle head movement and restrained open hand gestures while speaking.',
      expressiveness: process.env.HEYGEN_EXPRESSIVENESS || 'high',
      engine: { type: 'avatar_iv' }
    }),
    signal: AbortSignal.timeout(120000)
  });
  const created = await createResponse.json().catch(() => ({}));
  const videoId = created.data?.video_id;
  if (!createResponse.ok || !videoId) throw new Error(created.message || created.error?.message || `HeyGen video create failed: ${createResponse.status}`);

  const deadline = Date.now() + 12 * 60 * 1000;
  let video;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const statusResponse = await fetch(`https://api.heygen.com/v3/videos/${videoId}`, {
      headers: { 'x-api-key': getHeyGenApiKey() },
      signal: AbortSignal.timeout(30000)
    });
    const payload = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) throw new Error(payload.message || `HeyGen status failed: ${statusResponse.status}`);
    video = payload.data || payload;
    if (video.status === 'completed') break;
    if (video.status === 'failed') throw new Error(video.failure_message || 'HeyGen не смог создать видео.');
    onStage(video.status === 'processing' ? 'HeyGen создаёт движения и синхронизацию губ' : 'Видео ожидает обработки в HeyGen');
  }
  if (!video?.video_url) throw new Error('HeyGen не успел создать видео за 12 минут.');
  const download = await fetch(video.video_url, { signal: AbortSignal.timeout(120000) });
  if (!download.ok) throw new Error(`HeyGen video download failed: ${download.status}`);
  fs.writeFileSync(outputPath, Buffer.from(await download.arrayBuffer()));
}

async function runLocalVideoJob(jobId, prompt) {
  const job = videoJobs.get(jobId);
  const jobDir = path.join(generatedAudioDir, `video-${jobId}`);
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    job.stage = 'Создаю сценарий локальной моделью';
    job.script = await generateLocalVideoScript(prompt);

    const outputPath = path.join(jobDir, 'office-avatar.mp4');
    if (videoRenderMode === 'openai') {
      job.stage = 'Создаю реалистичное видео';
      await renderOpenAiVideo(job.script, prompt, outputPath, progress => {
        job.progress = progress;
        job.stage = `Создаю реалистичное видео — ${progress}%`;
      });
      job.status = 'completed';
      job.stage = 'Видео готово';
      job.renderMode = 'openai';
      job.videoUrl = `/generated/video-${jobId}/office-avatar.mp4`;
      return;
    }

    const aiffPath = path.join(jobDir, 'speech.aiff');
    const wavPath = path.join(jobDir, 'speech.wav');
    job.stage = 'Озвучиваю русским голосом';
    await execFileAsync('/usr/bin/say', ['-v', 'Milena', '-r', '175', '-o', aiffPath, job.script], { timeout: 120000 });
    await execFileAsync(localFfmpeg, ['-y', '-i', aiffPath, '-ar', '16000', '-ac', '1', wavPath], { timeout: 120000 });

    if (videoRenderMode === 'heygen') {
      await renderHeyGenVideo(wavPath, outputPath, stage => { job.stage = stage; });
      job.status = 'completed';
      job.stage = 'Видео готово';
      job.renderMode = 'heygen';
      job.videoUrl = `/generated/video-${jobId}/office-avatar.mp4`;
      return;
    }

    if (videoRenderMode === 'fast') {
      job.stage = 'Быстро собираю видео';
      await renderFastAvatarVideo(wavPath, outputPath);
      job.status = 'completed';
      job.stage = 'Видео готово';
      job.renderMode = 'fast';
      job.videoUrl = `/generated/video-${jobId}/office-avatar.mp4`;
      return;
    }

    const resultDir = path.join(jobDir, 'result');
    job.stage = 'Анимирую человека и синхронизирую губы';
    await execFileAsync(sadTalkerPython, [
      'inference.py',
      '--driven_audio', wavPath,
      '--source_image', defaultAvatar,
      '--checkpoint_dir', path.join(sadTalkerRoot, 'checkpoints'),
      '--result_dir', resultDir,
      '--size', '256',
      '--preprocess', 'crop',
      '--still',
      '--batch_size', String(videoRenderBatchSize),
      '--cpu'
    ], {
      cwd: sadTalkerRoot,
      timeout: 30 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: `${path.dirname(localFfmpeg)}:${process.env.PATH || ''}`,
        PYTORCH_ENABLE_MPS_FALLBACK: '1',
        MPLCONFIGDIR: path.join(jobDir, 'matplotlib')
      }
    });

    const generated = fs.readdirSync(resultDir).find(name => name.endsWith('.mp4'));
    if (!generated) throw new Error('SadTalker не создал видеофайл.');

    await execFileAsync(localFfmpeg, [
      '-y', '-i', path.join(resultDir, generated),
      '-vf', 'scale=720:720:flags=lanczos',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k', outputPath
    ], { timeout: 5 * 60 * 1000 });

    job.status = 'completed';
    job.stage = 'Видео готово';
    job.renderMode = 'quality';
    job.videoUrl = `/generated/video-${jobId}/office-avatar.mp4`;
  } catch (error) {
    console.error('Local video generation failed:', error.stderr || error.message);
    job.status = 'failed';
    job.stage = 'Ошибка генерации';
    job.error = 'Не удалось создать видео. Проверьте, что локальный видеодвижок запущен, и повторите попытку.';
  }
}

async function publishToFacebook({ content, filePath, fileName, type }) {
  await facebookAuth.refresh();
  const { pageId, accessToken } = getFacebookConfig();

  if (!pageId || !accessToken) {
    const error = new Error('Facebook не подключён. Укажите ID страницы и Page Access Token в .env.');
    error.code = 'FACEBOOK_NOT_CONFIGURED';
    throw error;
  }

  const endpoint = type === 'video' ? 'videos' : (type === 'image' ? 'photos' : 'feed');
  const url = `https://graph.facebook.com/${facebookGraphVersion}/${encodeURIComponent(pageId)}/${endpoint}`;

  if (type === 'video') {
    const form = new FormData();
    form.append('published', 'true');
    form.append('description', content || '');
    const fileBuffer = await fs.promises.readFile(filePath);
    const mimeType = path.extname(fileName || '').toLowerCase() === '.mov' ? 'video/quicktime' : 'video/mp4';
    form.append('source', new Blob([fileBuffer], { type: mimeType }), fileName || 'video.mp4');

    const response = await fetch(url, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10 * 60 * 1000)
    });
    const data = await readFacebookResponse(response, 'Facebook не принял видео.');

    return {
      mode: 'facebook',
      message: 'Видео отправлено на Facebook. Обработка на стороне Meta может занять несколько минут.',
      data
    };
  }

  if (type === 'image') {
    const form = new FormData();
    form.append('published', 'true');
    form.append('message', content || '');
    const fileBuffer = await fs.promises.readFile(filePath);
    const imageMime = /\.jpe?g$/i.test(fileName || '') ? 'image/jpeg' : 'image/png';
    form.append('source', new Blob([fileBuffer], { type: imageMime }), fileName || 'post-image.png');

    const response = await fetch(url, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(120000)
    });
    const data = await readFacebookResponse(response, 'Facebook не принял изображение.');
    return { mode: 'facebook', message: 'Пост с изображением реально опубликован на Facebook.', data };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      message: content,
      published: true
    }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await readFacebookResponse(response, 'Facebook не принял публикацию.');

  return {
    mode: 'facebook',
    message: 'Пост реально опубликован на Facebook.',
    data
  };
}

app.get('/healthz', (req, res) => res.json({ ok: true, app: 'SMM Panel' }));
const viberInbox=require('./lib/viber-inbox').createViberInbox();
viberInbox.mountWebhook(app);
metaInbox.mountWebhook(app);
chatwootBridge.mountWebhook(app);

const auditLog=require('./lib/audit-log').createAuditLog(path.join(privateDirectory,'audit'));
require('./lib/panel-auth').mountPanelAuth(app, { directory:privateDirectory, port, onLogin:(user,context)=>auditLog.record({...user,...context,actorId:user.id,action:'login',page:'login'}), onLogout:(user,context)=>auditLog.record({...user,...context,actorId:user.id,action:'logout',page:'workspace'}) });
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
auditLog.mount(app);
app.use('/generated', (req,res,next) => {
  if (!/\.(png|jpe?g|webp|gif|mp4|webm|mov|wav|mp3|aiff)$/i.test(req.path)) return res.sendStatus(404);
  next();
}, express.static(generatedAudioDir, { dotfiles:'deny' }));
require('./lib/tiktok').createTikTok({directory:path.join(privateDirectory,'tiktok')}).mount(app);
if (!isCloudflareWorker) {
  app.use(express.static(path.join(appRoot, 'public'), {
    etag: false,
    setHeaders: res => res.setHeader('Cache-Control', 'no-store, max-age=0')
  }));
}

const telegramSupport = require('./lib/telegram-support').mountSupport(app, {
  directory: path.join(privateDirectory, 'telegram'),
  tokens: { client: process.env.TELEGRAM_CLIENT_BOT_TOKEN, operator: process.env.TELEGRAM_OPERATOR_BOT_TOKEN },
  workerMode: isCloudflareWorker,
  webhookSecret: process.env.BEREG_TG_WEBHOOK_SECRET || '',
  webhookBaseUrl: process.env.BEREG_PUBLIC_URL || '',
  autoReply:(client,event,value,queue)=>require('./lib/reply-templates').autoReply(path.join(privateDirectory,'crm'),client,event,value,queue),
  semanticReply:(client,text,queue,isCurrent)=>require('./lib/reply-templates').semanticReply(path.join(privateDirectory,'crm'),client,text,queue,isCurrent),
  externalFileSender:(client,attachment,bytes)=>client.transport==='chatwoot'
    ?chatwootBridge.sendFile(client,attachment,bytes):metaInbox.sendFile(client,attachment,bytes),
  externalFileAllowed:metaInbox.acceptsFile,
  externalSender: (client,text)=>client.transport==='chatwoot'?chatwootBridge.sendMessage(client,text):client.transport==='viber'?viberInbox.sendMessage(client,text):metaInbox.sendMessage(client,text)
});
app.locals.beregFlushSupportQueue = telegramSupport.flush;
require('./lib/sales-site').mountSalesSite(app, {
  directory: path.join(privateDirectory, 'sales-site'),
  support: telegramSupport,
  telegramToken: process.env.TELEGRAM_OPERATOR_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_SALES_CHAT_ID || ''
});
const clientStore = require('./lib/clients').mountClients(app,{directory:path.join(privateDirectory,'crm'),support:telegramSupport,workerMode:isCloudflareWorker});
app.locals.beregSyncClients = clientStore.sync;
require('./lib/casework').mountCasework(app,{directory:path.join(privateDirectory,'crm'),clients:clientStore,support:telegramSupport,worker:isCloudflareWorker});
require('./lib/reply-templates').mountReplyTemplates(app, path.join(privateDirectory, 'crm'));
require('./lib/business').mountBusiness(app,{directory:path.join(privateDirectory,'business')});
require('./lib/content-plan').mountContentPlan(app,{directory:path.join(privateDirectory,'content-plan')});
metaInbox.setIngest(event=>telegramSupport.ingestExternal(event),(provider,externalId,language)=>telegramSupport.setClientLanguage(provider,externalId,language),telegramSupport.files.receiveResponse);
chatwootBridge.setIngest(event=>telegramSupport.ingestExternal(event));
viberInbox.setIngest(event=>telegramSupport.ingestExternal(event));
metaInbox.mountAdmin(app);
chatwootBridge.mountAdmin(app);

const growthHub = require('./lib/growth-hub').mountGrowthHub(app, {
  directory: path.join(privateDirectory, 'growth'),
  telegramToken: process.env.TELEGRAM_CLIENT_BOT_TOKEN
});

require('./lib/telegram-account').mountTelegramAccount(app, {
  directory: path.join(privateDirectory, 'telegram-account'),
  growth: growthHub,
  getBusiness: () => ({
    name: 'BEREG', pageName: businessName, services: businessServices,
    botUrl: `https://t.me/${String(process.env.TELEGRAM_CLIENT_BOT_USERNAME || 'bereg_support_bot').replace(/^@/, '')}`
  })
});

app.get('/api/health', async (req, res) => {
  const ollamaReady = await isOllamaReady();
  res.json({
    ok: true,
    app: 'SMM Panel',
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    aiModel,
    aiProvider,
    ollamaReady,
    ollamaModel,
    facebookConfigured: Boolean(getFacebookConfig().pageId && getFacebookConfig().accessToken),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/settings', (req, res) => {
  res.json({ settings: appSettings });
});

app.put('/api/settings', async (req, res) => {
  try {
    const platforms = ['Facebook', 'Instagram', 'Telegram', 'LinkedIn'];
    const periods = [7, 28, 90];
    const refreshMinutes = Math.min(60, Math.max(1, Number(req.body.refreshMinutes) || 15));

    const settings = await saveAppSettings({
      businessName: String(req.body.businessName || businessName).trim().slice(0, 100) || businessName,
      defaultPlatform: platforms.includes(req.body.defaultPlatform) ? req.body.defaultPlatform : 'Facebook',
      youtubePeriod: periods.includes(Number(req.body.youtubePeriod)) ? Number(req.body.youtubePeriod) : 28,
      autoRefresh: Boolean(req.body.autoRefresh),
      refreshMinutes,
      notifications: Boolean(req.body.notifications),
      compactMode: Boolean(req.body.compactMode)
    });
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: 'Не удалось сохранить настройки.' });
  }
});

const facebookOwnerOnly = (req,res,next) => req.panelUser.role === 'superadmin' ? next() : res.status(403).json({error:'Подключение Facebook доступно только суперадминистратору.'});

app.get('/api/facebook/config', facebookOwnerOnly, (req,res) => res.json(facebookAuth.publicConfig()));

app.post('/api/facebook/config', facebookOwnerOnly, (req,res) => {
  try {
    res.json(facebookAuth.saveAppConfig({
      appId:req.body.appId,
      appSecret:req.body.appSecret,
      nextRedirectUri:req.body.redirectUri
    }));
  } catch(error) { res.status(400).json({error:error.message}); }
});

app.get('/api/facebook/connect', facebookOwnerOnly, (req,res) => {
  try { res.redirect(facebookAuth.begin(req.panelUser.id)); }
  catch(error) { res.redirect(`/?facebook=config&message=${encodeURIComponent(error.message)}`); }
});

app.get('/api/facebook/oauth/callback', facebookOwnerOnly, async(req,res) => {
  try {
    if(req.query.error) throw new Error(String(req.query.error_description || 'Meta отклонила подключение.'));
    await facebookAuth.complete({code:String(req.query.code||''),state:String(req.query.state||''),userId:req.panelUser.id});
    res.redirect('/?facebook=connected');
  } catch(error) { res.redirect(`/?facebook=error&message=${encodeURIComponent(error.message)}`); }
});

const facebookRefreshTimer=setInterval(()=>facebookAuth.refresh().catch(()=>{}),24*60*60*1000);
facebookRefreshTimer.unref();

app.get('/api/facebook/status', async (req, res) => {
  try {
    const page = await getFacebookPage();
    const connection=facebookAuth.status();
    res.json({
      connected: true,
      canUpload: String((await readYoutubeCredentials())?.scope || '').split(' ').includes('https://www.googleapis.com/auth/youtube.upload'),
      page: { id: page.id, name: page.name, link: page.link },
      graphVersion: facebookGraphVersion,
      managed:connection.managed,
      connectedAt:connection.connectedAt,
      expiresAt:connection.expiresAt,
      refreshError:connection.refreshError
    });
  } catch (error) {
    const status = error.code === 'FACEBOOK_NOT_CONFIGURED' ? 503 : 502;
    res.status(status).json({ connected: false, error: error.message });
  }
});

app.get('/api/posts', (req, res) => {
  res.json({ posts: posts.map(normalizePost) });
});

app.get('/api/analytics', async (req, res) => {
  try {
    res.json({ analytics: await getRealFacebookAnalytics() });
  } catch (error) {
    res.status(502).json({ error: error.message, analytics: { live: false, overview: { reach: 0, engagement: 0, ctr: 0, followers: 0 }, chart: [] } });
  }
});

app.get('/api/youtube/status', async (req, res) => {
  if (!youtubeClientId || !youtubeClientSecret) {
    return res.status(503).json({ connected: false, configured: false, error: 'YouTube OAuth ещё не настроен.' });
  }
  try {
    const accessToken = await getYoutubeAccessToken();
    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.search = new URLSearchParams({ part: 'snippet,statistics', mine: 'true' });
    const data = await youtubeApi(url, accessToken);
    const channel = data.items?.[0];
    if (!channel) throw new Error('В этом Google-аккаунте не найден YouTube-канал.');
    res.json({
      connected: true,
      configured: true,
      channel: {
        id: channel.id,
        title: channel.snippet?.title,
        thumbnail: channel.snippet?.thumbnails?.default?.url,
        subscribers: Number(channel.statistics?.subscriberCount || 0)
      }
    });
  } catch (error) {
    const status = error.code === 'YOUTUBE_NOT_CONNECTED' ? 401 : 502;
    res.status(status).json({ connected: false, configured: true, error: error.message });
  }
});


app.post('/api/youtube/videos', async (req, res) => {
  let token;
  try {
    token = await getYoutubeAccessToken();
    if (!String((await readYoutubeCredentials())?.scope || '').split(' ').includes('https://www.googleapis.com/auth/youtube.upload')) return res.status(403).json({ error: 'Переподключите канал и разрешите загрузку видео.' });
  } catch (error) { return res.status(401).json({ error: error.message }); }
  upload.single('video')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Максимальный размер — 200 МБ.' : err.message });
    try {
      const title = String(req.body.title || '').trim();
      const description = String(req.body.description || '');
      const privacyStatus = req.body.privacyStatus;
      if (!req.file?.size || !title || title.length > 100 || /[<>]/.test(title + description) || Buffer.byteLength(description) > 5000 || !['private','unlisted','public'].includes(privacyStatus) || !['true','false'].includes(req.body.madeForKids)) return res.status(400).json({ error: 'Проверьте видео, название (до 100 символов), описание (до 5000 байт, без < и >), видимость и аудиторию.' });
      const session = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Upload-Content-Type': req.file.mimetype, 'X-Upload-Content-Length': String(req.file.size) },
        body: JSON.stringify({ snippet: { title, description }, status: { privacyStatus, selfDeclaredMadeForKids: req.body.madeForKids === 'true' } }), signal: AbortSignal.timeout(30000)
      });
      if (!session.ok) await readGoogleResponse(session, 'Не удалось начать загрузку.');
      const location = session.headers.get('location');
      if (!location || new URL(location).protocol !== 'https:' || new URL(location).hostname !== 'www.googleapis.com') throw new Error('Некорректный адрес загрузки YouTube.');
      const stream = fs.createReadStream(req.file.path);
      let video;
      try {
        const response = await fetch(location, { method: 'PUT', headers: { 'Content-Type': req.file.mimetype, 'Content-Length': String(req.file.size) }, body: stream, duplex: 'half', signal: AbortSignal.timeout(1800000) });
        video = await readGoogleResponse(response, 'Загрузка прервана. Проверьте YouTube Studio перед повтором.');
      } finally { stream.destroy(); }
      if (!video?.id) throw new Error('Проверьте результат загрузки в YouTube Studio.');
      res.json({ video: { id: video.id, privacyStatus: video.status?.privacyStatus } });
    } catch (error) { res.status(502).json({ error: error.message }); }
    finally { if (req.file) await fs.promises.unlink(req.file.path).catch(() => {}); }
  });
});

app.get('/api/youtube/connect', (req, res) => {
  if (!youtubeClientId || !youtubeClientSecret) {
    return res.status(503).send('Сначала добавьте YOUTUBE_CLIENT_ID и YOUTUBE_CLIENT_SECRET в .env.');
  }
  const state = crypto.randomBytes(24).toString('hex');
  youtubeOauthStates.set(state, Date.now() + 10 * 60 * 1000);
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.search = new URLSearchParams({
    client_id: youtubeClientId,
    redirect_uri: youtubeRedirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    state,
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
      'https://www.googleapis.com/auth/yt-analytics-monetary.readonly'
    ].join(' ')
  });
  res.redirect(authUrl.toString());
});

app.get('/api/youtube/oauth/callback', async (req, res) => {
  const state = String(req.query.state || '');
  const expiresAt = youtubeOauthStates.get(state);
  youtubeOauthStates.delete(state);
  if (!state || !expiresAt || expiresAt < Date.now()) {
    return res.status(400).send('Сеанс подключения истёк. Вернитесь в панель и повторите подключение.');
  }
  if (req.query.error) return res.redirect('/?youtube=denied');
  try {
    const body = new URLSearchParams({
      client_id: youtubeClientId,
      client_secret: youtubeClientSecret,
      code: String(req.query.code || ''),
      grant_type: 'authorization_code',
      redirect_uri: youtubeRedirectUri
    });
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000)
    });
    const tokens = await readGoogleResponse(response, 'Не удалось подключить YouTube.');
    const existing = await readYoutubeCredentials();
    await writeYoutubeCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || existing?.refresh_token,
      expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      scope: tokens.scope
    });
    res.redirect('/?youtube=connected');
  } catch (error) {
    res.status(502).send(`Не удалось подключить YouTube: ${error.message}`);
  }
});

app.get('/api/youtube/analytics', async (req, res) => {
  try {
    res.json({ analytics: await getYoutubeAnalytics(req.query.period) });
  } catch (error) {
    const status = ['YOUTUBE_NOT_CONFIGURED', 'YOUTUBE_NOT_CONNECTED'].includes(error.code) ? 503 : 502;
    res.status(status).json({ error: error.message, analytics: { live: false } });
  }
});

app.post('/api/ai/advisor', async (req, res) => {
  try {
    const period = appSettings.youtubePeriod || 28;
    const [facebookResult, youtubeResult] = await Promise.allSettled([
      getRealFacebookAnalytics(),
      getYoutubeAnalytics(period)
    ]);
    const facebook = facebookResult.status === 'fulfilled' ? facebookResult.value : null;
    const youtube = youtubeResult.status === 'fulfilled' ? youtubeResult.value : null;
    if (!facebook && !youtube) throw new Error('Нет доступных данных Facebook или YouTube для анализа.');

    const metrics = {
      facebook: {
        views: Number(facebook?.overview?.reach || 0),
        engagement: Number(facebook?.overview?.engagement || 0),
        followers: Number(facebook?.overview?.followers || 0),
        newFollowers: Number(facebook?.overview?.followsThisWeek || 0)
      },
      youtube: {
        period,
        views: Number(youtube?.overview?.views || 0),
        watchHours: Number(youtube?.overview?.watchHours || 0),
        subscribersGained: Number(youtube?.overview?.subscribersGained || 0),
        retention: Number(youtube?.overview?.averageViewPercentage || 0)
      }
    };
    const advice = await generateAdvisorViaOllama(metrics);
    res.json({
      success: true,
      advice,
      metrics,
      source: `AI ${ollamaModel} · Facebook + YouTube API`,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Не удалось сформировать рекомендации.' });
  }
});

app.post('/api/ai/post', async (req, res) => {
  try {
    const topic = String(req.body?.topic || '').trim();
    if (!topic) return res.status(400).json({ error: 'Введите тему поста.' });

    const options = {
      topic,
      platform: req.body?.platform,
      tone: req.body?.tone,
      length: req.body?.length,
      goal: req.body?.goal,
      audience: req.body?.audience,
      language: req.body?.language
    };

    let text;
    let source;
    let model;

    if (aiProvider === 'ollama') {
      text = await generateAiPostViaOllama(options);
      source = 'ollama';
      model = ollamaModel;
    } else {
      try {
        text = await generateAiPostViaOpenAI(options);
        source = 'openai';
        model = aiModel;
      } catch (openAiError) {
        const canFallback = openAiError.status === 429 || openAiError.code === 'OPENAI_NOT_CONFIGURED';
        if (!canFallback) throw openAiError;
        text = await generateAiPostViaOllama(options);
        source = 'ollama';
        model = ollamaModel;
      }
    }

    let image = null;
    let imageError = null;
    if (wantsPostImage(topic)) {
      try {
        image = await generatePostImage(options);
      } catch (error) {
        console.error('OpenAI image generation failed:', error.message);
        imageError = error.message;
      }
    }

    return res.json({ success: true, text, source, model, image, imageError });
  } catch (error) {
    const status = error.code === 'OPENAI_NOT_CONFIGURED' ? 503 : (error.status || 502);
    res.status(status).json({ error: error.message || 'Не удалось сгенерировать пост через OpenAI.' });
  }
});

app.post('/api/ai/video', (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  const jobId = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  videoJobs.set(jobId, { id: jobId, status: 'processing', stage: 'Запускаю генератор', prompt });
  runLocalVideoJob(jobId, prompt);
  res.status(202).json({ success: true, jobId });
});

app.get('/api/ai/video/:jobId', (req, res) => {
  const job = videoJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Задача генерации не найдена.' });
  res.json(job);
});

app.post('/api/posts', upload.single('video'), async (req, res) => {
  try {
    const generatedImagePath = String(req.body.generatedImagePath || '').trim();
    const safeImageName = path.basename(generatedImagePath);
    const imagePath = generatedImagePath && safeImageName === generatedImagePath
      ? path.join(generatedAudioDir, safeImageName)
      : null;
    const hasGeneratedImage = Boolean(imagePath && fs.existsSync(imagePath) && /^post-image-[\w.-]+\.(?:png|jpe?g)$/i.test(safeImageName));
    const type = req.file ? 'video' : (hasGeneratedImage ? 'image' : 'text');
    const content = req.body.content || '';
    const createdAt = new Date().toISOString();

    if (!content.trim() && !req.file) {
      return res.status(400).json({ error: 'Write a post or upload a video.' });
    }

    const newPost = {
      id: `post-${Date.now()}`,
      type,
      content: content.trim(),
      status: 'sending',
      platform: 'Facebook',
      createdAt,
      metrics: { reach: 0, engagement: 0, clicks: 0 }
    };

    posts.unshift(newPost);

    let publishingResult;

    try {
      if (req.file) {
        publishingResult = await publishToFacebook({
          content,
          filePath: req.file.path,
          fileName: req.file.originalname,
          type: 'video'
        });
      } else if (hasGeneratedImage) {
        publishingResult = await publishToFacebook({
          content,
          filePath: imagePath,
          fileName: safeImageName,
          type: 'image'
        });
      } else {
        publishingResult = await publishToFacebook({ content, type: 'text' });
      }

      newPost.status = 'published';
      newPost.facebookId = publishingResult.data?.id || null;
      newPost.facebookUrl = newPost.facebookId ? `https://www.facebook.com/${newPost.facebookId}` : null;
      if (hasGeneratedImage) newPost.imageUrl = `/generated/${safeImageName}`;
    } catch (error) {
      newPost.status = 'failed';
      newPost.error = error.message;
      publishingResult = { mode: 'facebook', error: error.message, message: error.message };
      console.error('Facebook publish failed:', error.message);
    } finally {
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }
    }

    const success = newPost.status === 'published';
    res.status(success ? 201 : (publishingResult.error ? 502 : 500)).json({
      success,
      post: normalizePost(newPost),
      publishingResult
    });
  } catch (error) {
    console.error('Post creation error:', error);
    res.status(500).json({ error: 'Unable to create post.' });
  }
});

if (!isCloudflareWorker) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(appRoot, 'public', 'index.html'));
  });
}

if (!isCloudflareWorker) {
  app.listen(port, host, () => {
    console.log(`SMM Panel listening on http://${host}:${port}`);
  });
}

return app;
}

if (require.main === module) createApp();
module.exports = { createApp };
