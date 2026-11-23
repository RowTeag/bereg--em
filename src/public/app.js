const postForm = document.getElementById('postForm');
const postContent = document.getElementById('postContent');
const aiPrompt = document.getElementById('aiPrompt');
const videoPrompt = document.getElementById('videoPrompt');
const videoInput = document.getElementById('videoInput');
const videoName = document.getElementById('videoName');
const postsList = document.getElementById('postsList');
const chart = document.getElementById('chart');
const statusText = document.getElementById('statusText');
const pageTitle = document.getElementById('pageTitle');
const exportBtn = document.getElementById('exportBtn');
const newPostBtn = document.getElementById('newPostBtn');
const generateAiBtn = document.getElementById('generateAiBtn');
const generateVideoBtn = document.getElementById('generateVideoBtn');
const aiPlatform = document.getElementById('aiPlatform');
const aiPostLanguage = document.getElementById('aiPostLanguage');
const aiTone = document.getElementById('aiTone');
const aiLength = document.getElementById('aiLength');
const aiGoal = document.getElementById('aiGoal');
const aiAudience = document.getElementById('aiAudience');
const aiConnection = document.getElementById('aiConnection');
const facebookConnection = document.getElementById('facebookConnection');
const generatedImagePath = document.getElementById('generatedImagePath');
const generatedImagePreview = document.getElementById('generatedImagePreview');
const generatedImage = document.getElementById('generatedImage');
const removeGeneratedImage = document.getElementById('removeGeneratedImage');
const settingsForm = document.getElementById('settingsForm');
const refreshConnectionsBtn = document.getElementById('refreshConnectionsBtn');
const generateAdviceBtn = document.getElementById('generateAdviceBtn');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mainNav = document.getElementById('mainNav');

const tabs = document.querySelectorAll('.tab');
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.section-panel');

const sectionTitles = {
  dashboard: 'Overview',
  content: 'Content',
  'telegram-support': 'Telegram · поддержка',
  'youtube-publish': 'YouTube publishing',
  'growth-center': 'Growth and sales',
  calendar: 'Calendar',
  analytics: 'Analytics',
  advisor: 'AI advisor',
  settings: 'Settings',
  employees: 'Employees',
  'response-templates': 'Шаблоны ответов'
};

let currentTab = 'text';
let facebookConnected = false;
let youtubeConnected = false;
let currentSettings = null;
let analyticsRefreshTimer = null;

function clearGeneratedImage() {
  generatedImagePath.value = '';
  generatedImage.removeAttribute('src');
  generatedImagePreview.hidden = true;
}

removeGeneratedImage.addEventListener('click', clearGeneratedImage);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeExternalUrl(value) {
  try { const url = new URL(String(value || '')); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(document.documentElement.lang, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderChart(data) {
  if (!data.length) {
    chart.innerHTML = '<div class="empty-chart">Данные Facebook пока не накоплены</div>';
    return;
  }
  const maxValue = Math.max(...data.map(item => item.reach), 1);
  chart.innerHTML = data
    .map(item => {
      const height = Math.max((item.reach / maxValue) * 100, 18);
      return `
        <div class="bar-column">
          <div class="bar" style="height:${height}%"></div>
          <div class="bar-label">${item.day}</div>
        </div>
      `;
    })
    .join('');
}

function formatMetric(value) {
  const number = Number(value || 0);
  if (number >= 1000000) return `${(number / 1000000).toFixed(1).replace('.0', '')}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(1).replace('.0', '')}K`;
  return String(number);
}

function renderChange(elementId, value, suffix) {
  const element = document.getElementById(elementId);
  if (value === null || value === undefined) {
    element.textContent = 'нет данных за прошлую неделю';
    element.className = 'neutral';
    return;
  }
  const number = Number(value || 0);
  const sign = number > 0 ? '+' : '';
  element.textContent = `${sign}${number}${suffix}`;
  element.className = number > 0 ? 'positive' : (number < 0 ? 'negative' : 'neutral');
}

function renderFacebookAnalytics(analytics, errorMessage = '') {
  const status = document.getElementById('fbAnalyticsStatus');
  if (!analytics?.live) {
    status.textContent = 'Нет подключения';
    status.className = 'chip warning';
    document.getElementById('fbAnalyticsPage').textContent = errorMessage || 'Не удалось получить данные Meta.';
    return;
  }
  const overview = analytics.overview || {};
  const changes = analytics.changes || {};
  document.getElementById('fbAnalyticsReach').textContent = formatMetric(overview.reach);
  document.getElementById('fbAnalyticsEngagement').textContent = formatMetric(overview.engagement);
  document.getElementById('fbAnalyticsFollowers').textContent = formatMetric(overview.followers);
  document.getElementById('fbAnalyticsFollows').textContent = `+${formatMetric(overview.followsThisWeek)}`;
  const changeLabel = value => value === null || value === undefined
    ? 'Сравнение появится после накопления истории'
    : `${Number(value) > 0 ? '+' : ''}${value}% к прошлой неделе`;
  document.getElementById('fbAnalyticsReachChange').textContent = changeLabel(changes.reach);
  document.getElementById('fbAnalyticsEngagementChange').textContent = changeLabel(changes.engagement);
  document.getElementById('fbAnalyticsFollowersChange').textContent = changes.followers === null || changes.followers === undefined
    ? 'История подписчиков накапливается'
    : `${Number(changes.followers) > 0 ? '+' : ''}${changes.followers} за неделю`;
  document.getElementById('fbAnalyticsPage').textContent = `Страница «${analytics.page?.name || 'Facebook'}»`;
  status.textContent = 'Данные Meta · онлайн';
  status.className = 'chip success';
}

function renderPosts(items) {
  postsList.innerHTML = items.slice(0, 5).map(post => `
    <article class="post-item">
      <div class="post-icon">${post.type === 'video' ? '▶' : (post.type === 'image' ? '▧' : 'T')}</div>
      <div>
        <h4>${post.type === 'video' ? 'Видео-пост' : 'Текстовый пост'}</h4>
        <p>${escapeHtml(post.content || 'Видео опубликовано в Facebook.')}</p>
        <div class="post-meta">
          <span>${formatDate(post.createdAt)}</span>
          <span>${post.metrics?.reach || 0} охват</span>
          ${post.facebookUrl ? `<a href="${escapeHtml(post.facebookUrl)}" target="_blank" rel="noopener">Открыть в Facebook</a>` : ''}
        </div>
      </div>
      <div class="post-status ${escapeHtml(post.status)}">${post.status === 'published' ? 'опубликован' : post.status === 'failed' ? 'ошибка' : 'отправка'}</div>
    </article>
  `).join('');
}

function generateAiPostText(topic) {
  const rawTopic = (topic || '').trim();

  if (!rawTopic) {
    return '📌 Напишите тему, и я сделаю готовый продающий пост в стиле premium Facebook.\n\nНапример: продвижение услуги, запуск курса, экспертный контент, бренд, продажа продукта.';
  }

  const text = rawTopic.replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();

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

  const cleanTitle = toHeadline(text);

  const isTranslation = /перевод|переводчик|венгр|венгер|язык/i.test(lower);
  const isCourse = /курс|обучение|мастер|программа|школа/i.test(lower);
  const isBeauty = /космет|красота|уход|бьюти|салон/i.test(lower);
  const isBusiness = /бизнес|маркет|бренд|продаж|услуга|сервис|консалт/i.test(lower);
  const isLifestyle = /здоров|еда|питание|дом|образ жизни|семья/i.test(lower);

  let headline = `🔥 ${cleanTitle}: как сделать сильное первое впечатление и превратить интерес в доверие.`;
  let intro = 'Хороший контент работает не только как информация — он помогает человеку понять ценность, почувствовать доверие и принять решение без лишнего давления.';
  let benefits = [
    'Сильный первый контакт и понятная подача',
    'Больше доверия и вовлечённости у аудитории',
    'Рост интереса без перегруза и навязчивости'
  ];

  if (isTranslation) {
    headline = `🔥 ${cleanTitle}: когда качество коммуникации становится вашим конкурентным преимуществом.`;
    intro = 'Услуги переводчика — это не просто перевод слов. Это точная передача смысла, доверия и профессионального уровня в каждой коммуникации с клиентом, партнёром и аудиторией.';
    benefits = [
      'Точная передача смысла без потери контекста',
      'Повышение доверия к вашему бренду и бизнесу',
      'Легче вести переговоры, коммуникацию и продажи'
    ];
  } else if (isCourse) {
    headline = `🔥 ${cleanTitle}: результат, который хочется получить уже сегодня.`;
    intro = 'Люди выбирают не просто знания, а понятную систему, которая помогает быстро увидеть результат, почувствовать ясность и сделать следующий шаг без сомнений.';
    benefits = [
      'Полная ясность в ценности и пользе продукта',
      'Усиление экспертности и доверия к бренду',
      'Больше людей, которые готовы действовать сразу'
    ];
  } else if (isBeauty) {
    headline = `✨ ${cleanTitle}: красота, доверие и эффект, который хочется сохранить.`;
    intro = 'Когда продукт подан красиво и честно, аудитория воспринимает его не как обычное предложение, а как решение, которое действительно важно для её жизни и образа.';
    benefits = [
      'Эстетическая подача, которая цепляет сразу',
      'Понимание пользы без перегруза и скуки',
      'Лучшая лояльность и запоминаемость бренда'
    ];
  } else if (isBusiness) {
    headline = `📈 ${cleanTitle}: как показать ценность продукта так, чтобы клиент захотел действовать.`;
    intro = 'Хороший пост не просто рассказывает о продукте. Он объясняет, почему это важно именно здесь и сейчас, и помогает аудитории увидеть выгоду в реальной жизни.';
    benefits = [
      'Понятная логика и сильная продающая структура',
      'Больше интереса со стороны реальной аудитории',
      'Рост доверия и конверсии без давления'
    ];
  } else if (isLifestyle) {
    headline = `💫 ${cleanTitle}: маленькие привычки, которые создают большой эффект.`;
    intro = 'Люди любят контент, который не только информирует, но и помогает почувствовать пользу на личном уровне — просто и естественно.';
    benefits = [
      'Доверительная подача без навязчивости',
      'Эмоциональная связь с аудиторией',
      'Лучшая узнаваемость и запоминаемость бренда'
    ];
  }

  const bullets = benefits.map(item => `✅ ${item}`).join('\n');
  const closing = 'Когда подача сильная, понятная и живой, аудитория перестаёт просто читать — она начинает видеть в вас решение своей задачи.';
  const cta = '📩 Если хотите, чтобы ваш контент выглядел так же профессионально и привлекательно — напишите “Хочу” в комментариях или сохраните этот пост.\n\n#Brand #Marketing #SocialMedia #Growth';

  return `${headline}\n\n${intro}\n\n${bullets}\n\n${closing}\n\n${cta}`;
}

function createVideoScene(prompt) {
  const text = (prompt || '').trim();
  const safeText = text || 'реалистичный человек в офисе озвучивает презентацию про услуги';
  const normalized = safeText.replace(/\s+/g, ' ').trim();
  const topic = normalized.toLowerCase();

  let voiceover = `Сейчас я расскажу, почему ${normalized.toLowerCase()} — это важный шаг для роста и доверия аудитории. Важно не просто говорить, а показывать пользу, которая действительно ощущается и понятна клиенту.`;

  if (/перевод|переводчик|венгр/i.test(topic)) {
    voiceover = 'Сегодня я хочу показать, почему услуги переводчика в Венгрии — это не просто помощь в тексте, а реальная поддержка бизнеса, доверия и коммуникации. Когда всё понятно и грамотно, результат ощущается сразу.';
  } else if (/курс|обучение|маркет/i.test(topic)) {
    voiceover = `Сейчас я покажу, почему ${normalized.toLowerCase()} — это мощный инструмент для роста экспертности и доверия. Люди запоминают не только идею, но и ощущение её пользы.`;
  }

  const title = normalized.charAt(0).toUpperCase() + normalized.slice(1);

  return {
    title,
    sceneTitle: title,
    scene: 'Реалистичная озвучка / офисный кадр / живой диктор',
    voiceover,
    audioLabel: 'Natural voice / 24 kHz / studio mix',
    subtitle: 'Реалистичная съемка в офисе, естественная речь, живой диктор, мягкий свет, аудитория видит человека и слышит голос без лишней шапки.'
  };
}

function renderVideoScene(scene) {
  const preview = document.querySelector('.video-preview');
  const card = preview || document.createElement('div');
  card.className = 'video-preview';
  card.innerHTML = `
    <div class="video-status-row">
      <div class="video-status-badge"><span class="status-dot"></span> Локальное AI-видео</div>
      <a class="video-publish-btn" href="${scene.videoUrl}" download>Скачать MP4</a>
    </div>

    <div class="video-stage-panel">
      <div class="video-stage-realistic video-result-stage">
        <video class="generated-video" controls playsinline preload="metadata" poster="/assets/default-office-avatar.png" src="${scene.videoUrl}"></video>
      </div>

      <div class="video-script">
        ${scene.voiceover}
      </div>
    </div>

    <div class="video-scene-meta">
      <h4>${scene.sceneTitle}</h4>
      <p>${scene.scene}</p>
    </div>
  `;

  const form = document.getElementById('postForm');
  if (!preview) {
    form.insertAdjacentElement('beforeend', card);
  }
}

function showSection(targetId) {
  navItems.forEach(nav => nav.classList.toggle('active', nav.dataset.target === targetId));
  sections.forEach(section => section.classList.toggle('active', section.id === targetId));
  window.syncSidebarGroups?.(targetId);
  const topbarActions = document.querySelector('.topbar-actions');
  if (topbarActions) topbarActions.hidden = ['settings', 'advisor', 'youtube-publish', 'growth-center', 'employees', 'inbox', 'clients', 'team-access', 'response-templates'].includes(targetId);
  if (targetId === 'inbox' && crmNotice) crmNotice.hidden = true;

  if (sectionTitles[targetId]) {
    pageTitle.textContent = sectionTitles[targetId];
  }
}

const crmNotice = document.getElementById('crmNewClientNotice');
let knownCrmNoticeCount = null;
let crmNoticeSoundEnabled = localStorage.getItem('crmNoticeSoundEnabled') !== 'false';
function playCrmNoticeSound() {
  if (!crmNoticeSoundEnabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.45);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + 0.46);
    oscillator.onended = () => audio.close();
  } catch {}
}
async function pollCrmNotice() {
  if (document.hidden || !crmNotice || pollCrmNotice.running || document.querySelector('#inbox.active')) return;
  pollCrmNotice.running = true;
  try {
    const response = await fetch('/api/clients-sync');
    if (!response.ok) return;
    const status = await response.json();
    const count = Number(status.newApplications || 0);
    if (knownCrmNoticeCount !== null && count > knownCrmNoticeCount) playCrmNoticeSound();
    knownCrmNoticeCount = count;
    crmNotice.replaceChildren();
    if (!count) { crmNotice.hidden = true; return; }
    const language = window.crmLanguage?.() || 'uk';
    const notificationCopy = {
      en: count === 1 ? 'New application from the BEREG website.' : `${count} new applications from the BEREG website.`,
      uk: count === 1 ? 'Нова заявка з сайту BEREG.' : `Нових заявок із сайту BEREG: ${count}.`,
      vi: count === 1 ? 'Có đơn đăng ký mới từ website BEREG.' : `Có ${count} đơn đăng ký mới từ website BEREG.`
    };
    const copy = document.createElement('strong');
    copy.textContent = notificationCopy[language] || notificationCopy.en;
    const open = document.createElement('button');
    open.className = 'ghost-btn'; open.type = 'button';
    open.textContent = ({en:'Open applications',uk:'Відкрити заявки',vi:'Mở danh sách đăng ký'})[language] || 'Open applications';
    open.addEventListener('click', async () => {
      const role = window.__beregAuth?.user?.role;
      showSection(role === 'operator' ? 'inbox' : 'clients');
      try { await fetch('/api/clients-sync/ack', {method:'POST',headers:{'X-CSRF-Token':window.__beregAuth?.csrf||''}}); }
      finally { crmNotice.hidden = true; }
    });
    const sound = document.createElement('button');
    sound.className = 'ghost-btn crm-sound-toggle'; sound.type = 'button';
    sound.textContent = crmNoticeSoundEnabled
      ? ({en:'Sound on',uk:'Звук увімкнено',vi:'Đã bật âm thanh'})[language]
      : ({en:'Enable sound',uk:'Увімкнути звук',vi:'Bật âm thanh'})[language];
    sound.addEventListener('click', () => {
      crmNoticeSoundEnabled = !crmNoticeSoundEnabled;
      localStorage.setItem('crmNoticeSoundEnabled', String(crmNoticeSoundEnabled));
      sound.textContent = crmNoticeSoundEnabled
        ? ({en:'Sound on',uk:'Звук увімкнено',vi:'Đã bật âm thanh'})[language]
        : ({en:'Enable sound',uk:'Увімкнути звук',vi:'Bật âm thanh'})[language];
      if (crmNoticeSoundEnabled) playCrmNoticeSound();
    });
    crmNotice.append(copy, document.createTextNode(' '), open, document.createTextNode(' '), sound);
    crmNotice.hidden = false;
  } catch {} finally { pollCrmNotice.running = false; }
}
pollCrmNotice();
setInterval(pollCrmNotice, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollCrmNotice(); });
document.addEventListener('crm-language-change', () => { if (!crmNotice.hidden) pollCrmNotice(); });

function closeMobileMenu() {
  document.body.classList.remove('mobile-menu-open');
  mobileMenuBtn.setAttribute('aria-expanded', 'false');
  mobileMenuBtn.setAttribute('aria-label', 'Открыть меню');
}

mobileMenuBtn.addEventListener('click', () => {
  const isOpen = document.body.classList.toggle('mobile-menu-open');
  mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
  mobileMenuBtn.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
});

function formatAdvice(text) {
  return escapeHtml(text).replaceAll('**', '')
    .split(/\n+/)
    .filter(Boolean)
    .map(line => `<p>${line}</p>`)
    .join('');
}

async function loadAiAdvice() {
  const result = document.getElementById('advisorResult');
  generateAdviceBtn.disabled = true;
  generateAdviceBtn.textContent = 'Анализирую…';
  result.className = 'advisor-result-loading';
  result.innerHTML = '<span class="advisor-loader"></span><p>Сверяю показатели и формирую план роста…</p>';
  try {
    const response = await fetch('/api/ai/advisor', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось сформировать рекомендации.');
    const facebook = data.metrics.facebook || {};
    const youtube = data.metrics.youtube || {};
    document.getElementById('advisorFbViews').textContent = formatMetric(facebook.views);
    document.getElementById('advisorFbEngagement').textContent = formatMetric(facebook.engagement);
    document.getElementById('advisorYtViews').textContent = formatMetric(youtube.views);
    document.getElementById('advisorYtRetention').textContent = `${formatYoutubeNumber(youtube.retention, 1)}%`;
    document.getElementById('advisorDataStatus').textContent = `Обновлено ${new Date(data.generatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · ${data.source}`;
    result.className = 'advisor-result-content';
    result.innerHTML = formatAdvice(data.advice);
  } catch (error) {
    result.className = 'advisor-result-error';
    result.innerHTML = `<strong>Не удалось выполнить анализ</strong><p>${escapeHtml(error.message)}</p>`;
  } finally {
    generateAdviceBtn.disabled = false;
    generateAdviceBtn.textContent = 'Обновить рекомендации';
  }
}

function applySettings(settings) {
  currentSettings = settings;
  if (aiPlatform && settings.defaultPlatform) aiPlatform.value = settings.defaultPlatform;
  document.body.classList.toggle('compact-mode', Boolean(settings.compactMode));
  document.body.classList.toggle('hide-panel-notifications', !settings.notifications);

  document.querySelectorAll('.youtube-period button').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.period) === Number(settings.youtubePeriod));
  });

  if (analyticsRefreshTimer) clearInterval(analyticsRefreshTimer);
  if (settings.autoRefresh) {
    analyticsRefreshTimer = setInterval(async () => {
      await loadDashboard();
      if (youtubeConnected) await loadYoutubeAnalytics(settings.youtubePeriod);
    }, Math.max(1, Number(settings.refreshMinutes || 15)) * 60 * 1000);
  }
}

async function loadSettings() {
  const response = await fetch('/api/settings');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось загрузить настройки');
  const settings = data.settings;
  document.getElementById('settingBusinessName').value = settings.businessName || '';
  document.getElementById('settingDefaultPlatform').value = settings.defaultPlatform || 'Facebook';
  document.getElementById('settingYoutubePeriod').value = String(settings.youtubePeriod || 28);
  document.getElementById('settingRefreshMinutes').value = settings.refreshMinutes || 15;
  document.getElementById('settingAutoRefresh').checked = Boolean(settings.autoRefresh);
  document.getElementById('settingNotifications').checked = Boolean(settings.notifications);
  document.getElementById('settingCompactMode').checked = Boolean(settings.compactMode);
  applySettings(settings);
  return settings;
}

async function refreshConnectionSettings() {
  refreshConnectionsBtn.disabled = true;
  refreshConnectionsBtn.textContent = 'Проверяю…';
  const [facebookResult, youtubeResult] = await Promise.allSettled([
    fetch('/api/facebook/status').then(async response => ({ response, data: await response.json() })),
    fetch('/api/youtube/status').then(async response => ({ response, data: await response.json() }))
  ]);

  const facebook = facebookResult.status === 'fulfilled' ? facebookResult.value : null;
  const facebookConnectedNow = Boolean(facebook?.response.ok && facebook.data.connected);
  document.getElementById('settingsFacebookStatus').textContent = facebookConnectedNow
    ? facebook.data.page.name
    : (facebook?.data.error || 'Нет подключения');
  document.getElementById('settingsFacebookBadge').textContent = facebookConnectedNow ? 'Подключён' : 'Ошибка';
  document.getElementById('settingsFacebookBadge').className = `chip ${facebookConnectedNow ? 'success' : 'warning'}`;

  const youtube = youtubeResult.status === 'fulfilled' ? youtubeResult.value : null;
  const youtubeConnectedNow = Boolean(youtube?.response.ok && youtube.data.connected);
  document.getElementById('settingsYoutubeStatus').textContent = youtubeConnectedNow
    ? youtube.data.channel.title
    : (youtube?.data.error || 'Нет подключения');
  document.getElementById('settingsYoutubeBadge').textContent = youtubeConnectedNow ? 'Подключён' : 'Ошибка';
  document.getElementById('settingsYoutubeBadge').className = `chip ${youtubeConnectedNow ? 'success' : 'warning'}`;
  refreshConnectionsBtn.disabled = false;
  refreshConnectionsBtn.textContent = 'Обновить состояния';
}

let facebookAppReady=false;
async function loadFacebookOauthConfig(){
  if(document.body.dataset.role!=='superadmin')return;
  const status=document.getElementById('facebookOauthStatus');
  try{
    const response=await fetch('/api/facebook/config');const data=await response.json();
    if(!response.ok)throw new Error(data.error);
    document.getElementById('facebookAppId').value=data.appId||'';
    document.getElementById('facebookAppSecret').value='';
    document.getElementById('facebookAppSecret').placeholder=data.appSecretConfigured?'Секрет сохранён · оставьте пустым, чтобы не менять':'Введите секрет один раз';
    document.getElementById('facebookRedirectUri').value=data.redirectUri||'';
    facebookAppReady=Boolean(data.appId&&data.appSecretConfigured);
    document.getElementById('connectFacebookBtn').setAttribute('aria-disabled',String(!facebookAppReady));
    status.textContent=facebookAppReady?'Данные приложения сохранены. Можно подключить Facebook.':'Для автоматического подключения нужен Meta App Secret.';
  }catch(error){status.textContent=error.message;}
}
document.getElementById('saveFacebookApp').onclick=async()=>{
  const button=document.getElementById('saveFacebookApp'),status=document.getElementById('facebookOauthStatus');button.disabled=true;
  try{
    const response=await fetch('/api/facebook/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appId:document.getElementById('facebookAppId').value,appSecret:document.getElementById('facebookAppSecret').value,redirectUri:document.getElementById('facebookRedirectUri').value})});
    const data=await response.json();if(!response.ok)throw new Error(data.error);
    await loadFacebookOauthConfig();status.textContent='Данные приложения сохранены. Теперь нажмите «Подключить через Facebook».';
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
};
document.getElementById('connectFacebookBtn').onclick=event=>{if(!facebookAppReady){event.preventDefault();document.getElementById('facebookOauthStatus').textContent='Сначала сохраните Meta App ID и Meta App Secret.';}};
loadFacebookOauthConfig();

document.querySelectorAll('.youtube-period button').forEach(button => {
  button.addEventListener('click', async () => {
    document.querySelectorAll('.youtube-period button').forEach(item => item.classList.toggle('active', item === button));
    document.querySelector('.youtube-performance h3').textContent = `Просмотры за ${button.dataset.period} дней`;
    if (youtubeConnected) await loadYoutubeAnalytics(button.dataset.period);
  });
});

function setAnalyticsPlatform(platform) {
  document.querySelectorAll('.platform-tab').forEach(tab => {
    const isActive = tab.dataset.platform === platform;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('.analytics-platform-panel').forEach(panel => {
    const isActive = panel.id === `${platform}-analytics`;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  });
}

document.querySelectorAll('.platform-tab').forEach(button => {
  button.addEventListener('click', async () => {
    const platform = button.dataset.platform;
    setAnalyticsPlatform(platform);
    if (platform === 'youtube' && !youtubeConnected) await checkYoutubeConnection();
  });
});

function formatYoutubeNumber(value, digits = 0) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(Number(value || 0));
}

function formatDuration(seconds) {
  const total = Math.round(Number(seconds || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function renderYoutubeChart(items) {
  const line = document.getElementById('ytChartLine');
  const area = document.getElementById('ytChartArea');
  const point = document.getElementById('ytChartPoint');
  const dates = document.getElementById('ytChartDates');
  if (!items.length) {
    line.setAttribute('d', '');
    area.setAttribute('d', '');
    dates.innerHTML = '<span>За выбранный период данных пока нет</span>';
    return;
  }
  const width = 720;
  const height = 215;
  const max = Math.max(...items.map(item => item.views), 1);
  const coords = items.map((item, index) => ({
    x: items.length === 1 ? width / 2 : (index / (items.length - 1)) * width,
    y: height - (item.views / max) * (height - 18)
  }));
  const path = coords.map((item, index) => `${index ? 'L' : 'M'}${item.x.toFixed(1)} ${item.y.toFixed(1)}`).join(' ');
  line.setAttribute('d', path);
  area.setAttribute('d', `${path} L${width} 230 L0 230 Z`);
  const lastPoint = coords[coords.length - 1];
  point.setAttribute('cx', lastPoint.x);
  point.setAttribute('cy', lastPoint.y);
  const indexes = [...new Set([0, Math.floor((items.length - 1) / 2), items.length - 1])];
  dates.innerHTML = indexes.map(index => `<span>${new Date(items[index].date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>`).join('');
}

function renderYoutubeVideos(items) {
  const list = document.getElementById('youtubeVideoList');
  if (!items.length) {
    list.innerHTML = '<div class="youtube-empty">За выбранный период видео с просмотрами не найдено.</div>';
    return;
  }
  list.innerHTML = items.map((video, index) => `
    <a class="youtube-video-row" href="https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}" target="_blank" rel="noopener">
      <div class="youtube-rank">${String(index + 1).padStart(2, '0')}</div>
      <div class="youtube-thumb">${video.thumbnail ? `<img src="${escapeHtml(video.thumbnail)}" alt="">` : ''}<span>▶</span></div>
      <div class="youtube-video-title"><strong>${escapeHtml(video.title)}</strong><span>${formatYoutubeNumber(video.watchHours, 1)} ч просмотра</span></div>
      <div class="youtube-video-metric"><strong>${formatYoutubeNumber(video.views)}</strong><span>просмотров</span></div>
      <div class="youtube-video-metric"><strong>${formatYoutubeNumber(video.averageViewPercentage, 1)}%</strong><span>удержание</span></div>
    </a>
  `).join('');
}

async function loadYoutubeAnalytics(period = 28) {
  const connection = document.getElementById('youtubeConnection');
  connection.textContent = 'Обновляю реальные данные…';
  try {
    const response = await fetch(`/api/youtube/analytics?period=${period}`);
    const data = await response.json();
    if (!response.ok || !data.analytics?.live) throw new Error(data.error || 'Не удалось загрузить аналитику');
    const analytics = data.analytics;
    const overview = analytics.overview;
    document.getElementById('ytViews').textContent = formatYoutubeNumber(overview.views);
    document.getElementById('ytHours').textContent = `${formatYoutubeNumber(overview.watchHours, 1)} ч`;
    document.getElementById('ytSubscribers').textContent = `+${formatYoutubeNumber(overview.subscribersGained)}`;
    document.getElementById('ytRevenue').textContent = overview.revenue === null ? 'Недоступно' : `$${formatYoutubeNumber(overview.revenue, 2)}`;
    document.getElementById('ytChartTotal').textContent = formatYoutubeNumber(overview.views);
    document.getElementById('ytRetention').textContent = `${formatYoutubeNumber(overview.averageViewPercentage, 1)}%`;
    const retentionScore = document.getElementById('ytRetentionScore');
    retentionScore.textContent = overview.averageViewPercentage > 0
      ? (overview.averageViewPercentage >= 50 ? 'Высокое' : overview.averageViewPercentage >= 30 ? 'Среднее' : 'Низкое')
      : 'Нет данных';
    document.getElementById('ytAverageDuration').textContent = formatDuration(overview.averageViewDuration);
    document.getElementById('ytChannelSubscribers').textContent = formatYoutubeNumber(analytics.channel.subscribers);
    document.getElementById('ytRetentionRing').style.background = `conic-gradient(var(--youtube) 0 ${Math.min(overview.averageViewPercentage, 100)}%, rgba(148,163,184,.12) ${Math.min(overview.averageViewPercentage, 100)}%)`;
    renderYoutubeChart(analytics.chart || []);
    renderYoutubeVideos(analytics.videos || []);
    connection.textContent = `Подключён: ${analytics.channel.title}`;
    connection.className = 'youtube-connection connected';
  } catch (error) {
    connection.textContent = error.message;
    connection.className = 'youtube-connection error';
  }
}

async function checkYoutubeConnection() {
  const connection = document.getElementById('youtubeConnection');
  const connectButton = document.getElementById('youtubeConnectBtn');
  try {
    const response = await fetch('/api/youtube/status');
    const data = await response.json();
    if (!response.ok || !data.connected) throw Object.assign(new Error(data.error || 'YouTube не подключён'), { configured: data.configured });
    youtubeConnected = true;
    connection.textContent = `Подключён: ${data.channel.title}`;
    connection.className = 'youtube-connection connected';
    connectButton.textContent = 'Переподключить';
    await loadYoutubeAnalytics(document.querySelector('.youtube-period button.active')?.dataset.period || 28);
  } catch (error) {
    youtubeConnected = false;
    connection.textContent = error.configured === false ? 'Нужна настройка Google OAuth' : error.message;
    connection.className = 'youtube-connection error';
    connectButton.textContent = error.configured === false ? 'Настроить подключение' : 'Подключить канал';
  }
}

async function loadDashboard() {
  const online={facebook:false,youtube:false};
  const refreshStatus=()=>{
    const sources=Object.entries(online).filter(([,connected])=>connected).map(([name])=>name==='facebook'?'Facebook':'YouTube');
    const badge=document.getElementById('liveDataBadge');
    badge.textContent=sources.length?'Online':'No live data';
    badge.className=`chip ${sources.length?'success':'warning'}`;
    document.getElementById('liveDataSummary').textContent=sources.length
      ?`Live metrics: ${sources.join(' and ')}. The dashboard remains available while other channels load.`
      :'Connect a channel to load live metrics. Posts and the rest of the CRM load independently.';
  };
  const readJson=async url=>{
    const response=await fetch(url);
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||`Request failed (${response.status})`);
    return data;
  };

  readJson('/api/posts').then(data=>renderPosts(data.posts||[])).catch(()=>{
    postsList.innerHTML='<div class="empty-chart">Posts are temporarily unavailable. Refresh to try again.</div>';
  });

  readJson('/api/analytics').then(data=>{
    const analytics=data.analytics||{},overview=analytics.overview||{},changes=analytics.changes||{};
    online.facebook=Boolean(analytics.live);
    renderFacebookAnalytics(analytics,data.error||'');
    document.getElementById('reachValue').textContent=formatMetric(overview.reach);
    document.getElementById('engagementValue').textContent=formatMetric(overview.engagement);
    document.getElementById('ctrValue').textContent=formatMetric(overview.followers);
    document.getElementById('dashboardFbFollows').textContent=formatMetric(overview.followsThisWeek);
    renderChange('reachChange',changes.reach,'% vs last week');
    renderChange('engagementChange',changes.engagement,'% vs last week');
    renderChange('ctrChange',changes.followers,' за неделю');
    renderChart(analytics.chart||[]);
    refreshStatus();
  }).catch(error=>{
    renderFacebookAnalytics(null,error.message||'Facebook metrics are unavailable.');
    renderChart([]);refreshStatus();
  });

  readJson(`/api/youtube/analytics?period=${currentSettings?.youtubePeriod||28}`).then(data=>{
    const analytics=data.analytics||{},overview=analytics.overview||{};
    online.youtube=Boolean(analytics.live);
    document.getElementById('followersValue').textContent=formatMetric(overview.views);
    document.getElementById('followersChange').textContent=analytics.live
      ?`Live data for ${analytics.period} days`:'YouTube is not connected';
    document.getElementById('dashboardYtHours').textContent=analytics.live?`${formatYoutubeNumber(overview.watchHours,1)} hrs`:'—';
    document.getElementById('dashboardYtSubscribers').textContent=analytics.live?formatMetric(overview.subscribersGained):'—';
    document.getElementById('dashboardYtRetention').textContent=analytics.live?`${formatYoutubeNumber(overview.averageViewPercentage,1)}%`:'—';
    refreshStatus();
  }).catch(()=>{
    document.getElementById('followersChange').textContent='Статистика YouTube временно недоступна';
    document.getElementById('dashboardYtHours').textContent='—';
    document.getElementById('dashboardYtSubscribers').textContent='—';
    document.getElementById('dashboardYtRetention').textContent='—';
    refreshStatus();
  });
}

async function checkAiConnection() {
  if (window.location.protocol === 'file:') {
    aiConnection.textContent = 'Откройте localhost:3000';
    statusText.textContent = 'Для генерации откройте приложение через http://localhost:3000';
    return;
  }

  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    if (data.ollamaReady) {
      aiConnection.textContent = `Бесплатная модель · ${data.ollamaModel}`;
    } else if (data.aiConfigured) {
      aiConnection.textContent = `OpenAI подключён · ${data.aiModel}`;
    } else {
      aiConnection.textContent = 'Установите Ollama';
    }
    aiConnection.classList.toggle('connected', Boolean(data.ollamaReady || data.aiConfigured));
  } catch (error) {
    aiConnection.textContent = 'Сервер недоступен';
    statusText.textContent = 'Запустите сервер командой npm start и откройте http://localhost:3000';
  }
}

async function checkFacebookConnection() {
  try {
    const response = await fetch('/api/facebook/status');
    const data = await response.json();
    if (!response.ok || !data.connected) throw new Error(data.error || 'Facebook не подключён');

    facebookConnected = true;
    facebookConnection.textContent = `Подключена: ${data.page.name}`;
    facebookConnection.className = 'chip success';
    statusText.textContent = `Готово к реальной публикации на странице «${data.page.name}»`;
  } catch (error) {
    facebookConnected = false;
    const isExpiredToken = /expired|ист[её]к|code\s*190|190\/463|session has expired/i.test(error.message);
    facebookConnection.textContent = isExpiredToken ? 'Нужно переподключить' : 'Facebook не подключён';
    facebookConnection.className = isExpiredToken ? 'chip warning' : 'chip light';
    statusText.textContent = isExpiredToken
      ? 'Доступ к Facebook истёк. Обновите подключение в настройках.'
      : 'Facebook пока не подключён. Проверьте настройки страницы.';
    statusText.title = error.message;
  }
}

videoInput.addEventListener('change', () => {
  const file = videoInput.files[0];
  if (file) {
    videoName.textContent = file.name;
    statusText.textContent = 'Видео выбрано для публикации';
    currentTab = 'video';
    tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.type === 'video'));
  } else {
    videoName.textContent = 'Файл не выбран';
    statusText.textContent = facebookConnected ? 'Готово к публикации в Facebook' : 'Сначала подключите Facebook в .env';
  }
});

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    currentTab = tab.dataset.type;
    tabs.forEach(item => item.classList.toggle('active', item === tab));

    if (currentTab === 'video') {
      statusText.textContent = 'Режим видео активен';
    } else {
      statusText.textContent = 'Режим текстового поста';
    }
  });
});

navItems.forEach(item => {
  item.addEventListener('click', async () => {
    showSection(item.dataset.target);
    closeMobileMenu();
    if (item.dataset.target === 'settings') {
      await loadSettings().catch(error => {
        document.getElementById('settingsSaveStatus').textContent = error.message;
      });
      await refreshConnectionSettings();
    }
    if (item.dataset.target === 'advisor') await loadAiAdvice();
  });
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMobileMenu();
});

generateAdviceBtn.addEventListener('click', loadAiAdvice);

refreshConnectionsBtn.addEventListener('click', refreshConnectionSettings);

settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  const saveStatus = document.getElementById('settingsSaveStatus');
  const saveButton = settingsForm.querySelector('button[type="submit"]');
  saveButton.disabled = true;
  saveButton.textContent = 'Сохраняю…';
  try {
    const payload = {
      businessName: document.getElementById('settingBusinessName').value,
      defaultPlatform: document.getElementById('settingDefaultPlatform').value,
      youtubePeriod: Number(document.getElementById('settingYoutubePeriod').value),
      refreshMinutes: Number(document.getElementById('settingRefreshMinutes').value),
      autoRefresh: document.getElementById('settingAutoRefresh').checked,
      notifications: document.getElementById('settingNotifications').checked,
      compactMode: document.getElementById('settingCompactMode').checked
    };
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось сохранить настройки');
    applySettings(data.settings);
    saveStatus.replaceChildren(metaLabel('Сохранено в'), ' ', new Date().toLocaleTimeString(document.documentElement.lang, { hour: '2-digit', minute: '2-digit' }));
    saveStatus.className = 'saved';
  } catch (error) {
    saveStatus.textContent = error.message;
    saveStatus.className = 'error';
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Сохранить изменения';
  }
});

generateAiBtn.addEventListener('click', async () => {
  const topic = aiPrompt.value.trim();
  if (!topic) {
    statusText.textContent = 'Введите тему поста';
    aiPrompt.focus();
    return;
  }

  try {
    generateAiBtn.disabled = true;
    generateAiBtn.textContent = 'ChatGPT пишет…';
    statusText.textContent = 'ChatGPT создаёт пост...';
    const response = await fetch('/api/ai/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        platform: aiPlatform.value,
        tone: aiTone.value,
        length: aiLength.value,
        goal: aiGoal.value,
        audience: aiAudience.value,
        language: aiPostLanguage?.value || 'uk'
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось сгенерировать пост');

    postContent.value = data.text;
    if (data.image) {
      generatedImage.src = data.image.imageUrl;
      generatedImagePath.value = data.image.imagePath;
      generatedImagePreview.hidden = false;
    } else {
      clearGeneratedImage();
    }
    currentTab = 'text';
    tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.type === 'text'));
    const provider = data.source === 'ollama' ? 'бесплатную локальную модель' : 'OpenAI';
    statusText.textContent = data.image
      ? `Готово: текст и картинка созданы (${data.image.model})`
      : (data.imageError
        ? `Текст готов, но картинка не создана: ${data.imageError}`
        : `Готово: пост создан через ${provider} (${data.model})`);
    postContent.focus();
    postContent.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    statusText.textContent = error.message;
  } finally {
    generateAiBtn.disabled = false;
    generateAiBtn.textContent = 'Сгенерировать через ChatGPT';
  }
});

generateVideoBtn.addEventListener('click', async () => {
  try {
    generateVideoBtn.disabled = true;
    generateVideoBtn.textContent = 'Запускаю генератор…';
    statusText.textContent = 'Запускаю локальную генерацию видео…';
    const response = await fetch('/api/ai/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: videoPrompt.value || aiPrompt.value || 'человек в офисе говорит про продвижение бизнеса' })
    });

    const data = await response.json();
    if (!response.ok || !data.jobId) throw new Error(data.error || 'Не удалось запустить генерацию.');

    let job;
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const jobResponse = await fetch(`/api/ai/video/${data.jobId}`);
      job = await jobResponse.json();
      statusText.textContent = job.stage || 'Генерирую видео…';
      generateVideoBtn.textContent = job.stage || 'Генерирую…';
      if (job.status === 'completed') break;
      if (job.status === 'failed') throw new Error(job.error || 'Генерация завершилась с ошибкой.');
    }

    renderVideoScene({
      videoUrl: job.videoUrl,
      voiceover: job.script,
      sceneTitle: videoPrompt.value || 'Человек рассказывает в офисе',
      scene: job.renderMode === 'fast'
        ? 'AI-аватар / русская речь / быстрый MP4'
        : 'Реалистичный AI-персонаж / движения / русская речь / синхронизация губ'
    });
    videoInput.value = '';
    videoName.textContent = 'Сгенерированное видео готово — скачайте MP4';
    statusText.textContent = 'Видео готово: можно посмотреть и скачать MP4';
    const preview = document.querySelector('.video-preview');
    if (preview) {
      preview.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (error) {
    statusText.textContent = error.message;
  } finally {
    generateVideoBtn.disabled = false;
    generateVideoBtn.textContent = 'Сгенерировать видео';
  }
});

newPostBtn.addEventListener('click', () => {
  showSection('dashboard');
  postContent.focus();
  postContent.scrollIntoView({ behavior: 'smooth', block: 'center' });
  statusText.textContent = 'Готово к созданию нового поста';
});

exportBtn.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/posts');
    const data = await response.json();
    const posts = data.posts || [];
    const blob = new Blob([JSON.stringify(posts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'facebook-posts-export.json';
    link.click();
    URL.revokeObjectURL(url);
    statusText.textContent = 'Экспорт публикаций успешно создан';
  } catch (error) {
    statusText.textContent = 'Ошибка экспорта данных';
  }
});

postForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(postForm);
  const content = (postContent.value || '').trim();

  if (!content && !videoInput.files[0]) {
    statusText.textContent = 'Сначала добавьте текст или загрузите видео';
    return;
  }

  if (!facebookConnected) {
    await checkFacebookConnection();
    return;
  }

  statusText.textContent = 'Публикация в Facebook...';

  try {
    const response = await fetch('/api/posts', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error
        || result.publishingResult?.error
        || result.publishingResult?.message
        || 'Что-то пошло не так'
      );
    }

    postForm.reset();
    clearGeneratedImage();
    videoName.textContent = 'Файл не выбран';
    statusText.textContent = result.publishingResult?.message || 'Публикация успешно завершена';
    await loadDashboard();
  } catch (error) {
    statusText.textContent = error.message || 'Публикация не удалась';
  }
});

const youtubeReturn = new URLSearchParams(window.location.search).get('youtube');
if (youtubeReturn) {
  showSection('youtube-publish');
  checkYoutubeConnection();
  window.history.replaceState({}, '', window.location.pathname);
}

const facebookParams=new URLSearchParams(window.location.search);
const facebookReturn=facebookParams.get('facebook');
if(facebookReturn){
  showSection('settings');
  const message=facebookParams.get('message');
  document.getElementById('facebookOauthStatus').textContent=facebookReturn==='connected'?'Facebook подключён. Долгоживущий токен страницы сохранён, автоматическое обновление включено.':(message||'Не удалось подключить Facebook.');
  if(facebookReturn==='connected'){checkFacebookConnection();refreshConnectionSettings();}
  window.history.replaceState({},'',window.location.pathname);
}

loadDashboard();
loadSettings().catch(() => {});
checkAiConnection();
checkFacebookConnection();

const ytForm = document.getElementById('youtubeUploadForm');
const ytFile = document.getElementById('ytUploadFile');
const ytPreview = document.getElementById('ytUploadPreview');
const ytStatus = document.getElementById('ytUploadStatus');
const ytSubmit = document.getElementById('ytUploadSubmit');
let ytPreviewUrl;
async function refreshUploadConnection() {
  try {
    const response = await fetch('/api/youtube/status');
    const data = await response.json();
    if (!response.ok || !data.connected) throw new Error(data.error || 'Подключите канал');
    document.getElementById('ytUploadConnection').textContent = data.channel.title + (data.canUpload ? ' · готов к загрузке' : ' · обновите доступ для загрузки');
    ytSubmit.disabled = !data.canUpload;
  } catch (error) { document.getElementById('ytUploadConnection').textContent = error.message; ytSubmit.disabled = true; }
}
ytFile.addEventListener('change', () => {
  if (ytPreviewUrl) URL.revokeObjectURL(ytPreviewUrl);
  ytPreview.removeAttribute('src'); ytPreview.hidden = true;
  const file = ytFile.files[0];
  ytFile.setCustomValidity(file && file.size > 200 * 1024 * 1024 ? 'Максимальный размер — 200 МБ' : '');
  if (file && ytFile.validity.valid) {
    ytPreviewUrl = URL.createObjectURL(file); ytPreview.src = ytPreviewUrl; ytPreview.hidden = false;
    if (!ytForm.elements.title.value) ytForm.elements.title.value = file.name.replace(/\.[^.]+$/, '').slice(0,100);
  }
});
ytForm.addEventListener('submit', async event => {
  event.preventDefault();
  const body = new FormData(ytForm);
  if (new TextEncoder().encode(body.get('description')).length > 5000) { ytStatus.textContent = 'Описание превышает 5000 байт. Сократите текст.'; return; }
  const fields = document.getElementById('ytUploadFields');
  const link = document.getElementById('ytUploadedLink');
  fields.disabled = true; link.hidden = true;
  ytStatus.textContent = 'Загружаю видео. Не закрывайте страницу…';
  try {
    const response = await fetch('/api/youtube/videos', { method:'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Загрузка не удалась');
    const visibility = { public:'для всех', private:'только я', unlisted:'по ссылке' };
    ytStatus.textContent = 'Видео загружено! Видимость: ' + (visibility[data.video.privacyStatus] || 'проверьте в YouTube Studio') + '. YouTube может ещё обрабатывать ролик.';
    link.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(data.video.id); link.hidden = false;
    ytForm.reset(); ytPreview.removeAttribute('src'); ytPreview.hidden = true;
    if (ytPreviewUrl) URL.revokeObjectURL(ytPreviewUrl);
  } catch (error) { ytStatus.textContent = error.message + ' При обрыве связи проверьте YouTube Studio перед повторной загрузкой.'; }
  finally { fields.disabled = false; }
});
refreshUploadConnection();

async function refreshTelegramSupport() {
  const response = await fetch('/api/telegram/status');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  document.getElementById('tgConnection').textContent = !data.configured ? 'Добавьте токены двух ботов в .env и перезапустите сервер' : data.error ? 'Требует внимания: ' + data.error : 'Боты запущены · в очереди: ' + data.queued;
  document.getElementById('tgClientMigration').textContent = data.botUsernames?.client === 'bereg_support_bot' ? 'Подключён к панели' : 'Создан · ожидает переключения';
  document.getElementById('tgTeamMigration').textContent = data.botUsernames?.operator === 'bereg_team_bot' ? 'Подключён к панели' : 'Создан · ожидает переключения';
  const list = document.getElementById('tgOperators'); list.replaceChildren();
  for (const operator of data.operators) {
    const row = document.createElement('div'); row.className='tg-operator-row';
    const text = document.createElement('span');
    text.textContent = operator.name + ' · ' + (!operator.enabled ? 'Отключён' : !operator.chatId ? 'Ожидает входа' : operator.available ? 'На смене' : 'Пауза') + ' · клиентов: ' + operator.clients;
    row.append(text);
    const actions = document.createElement('div'); actions.className='tg-operator-actions';
    if (document.body.dataset.role === 'superadmin') {
      const showPassword = document.createElement('button'); showPassword.className='ghost-btn'; showPassword.textContent='Пароль';
      showPassword.onclick=()=>openTelegramPassword(operator);
      actions.append(showPassword);
    }
    if (operator.enabled) {
      const button = document.createElement('button'); button.className='ghost-btn'; button.textContent='Отключить';
      button.onclick=async()=>{ button.disabled=true; try { const r=await fetch('/api/telegram/operators/'+encodeURIComponent(operator.id),{method:'DELETE'}); const d=await r.json();if(!r.ok)throw new Error(d.error); await refreshTelegramSupport(); }catch(e){document.getElementById('tgOperatorResult').textContent=e.message;button.disabled=false;} };
      actions.append(button);
    }
    row.append(actions);
    list.append(row);
  }
  if (!data.operators.length) list.textContent='Добавьте первого оператора.';
}
document.getElementById('tgOperatorForm').addEventListener('submit', async event=>{
  event.preventDefault(); const form=event.currentTarget; const button=form.querySelector('button'); button.disabled=true;
  try {
    const response=await fetch('/api/telegram/operators',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:form.elements.name.value})});
    const data=await response.json(); if(!response.ok)throw new Error(data.error);
    document.getElementById('tgOperatorResult').textContent=data.name + ' — личный вход: /login ' + data.password + '. Пароль можно посмотреть и изменить в карточке оператора.';
    document.getElementById('tgHidePassword').hidden=false;form.reset(); await refreshTelegramSupport();
  }catch(e){document.getElementById('tgOperatorResult').textContent=e.message;}finally{button.disabled=false;}
});
document.getElementById('tgHidePassword').onclick=()=>{document.getElementById('tgOperatorResult').textContent='';document.getElementById('tgHidePassword').hidden=true;};
document.getElementById('tgRefresh').onclick=()=>refreshTelegramSupport().catch(e=>document.getElementById('tgConnection').textContent=e.message);
const tgPasswordDialog=document.getElementById('tgPasswordDialog');
async function openTelegramPassword(operator){
  document.getElementById('tgPasswordOperatorId').value=operator.id;
  document.getElementById('tgPasswordOperatorName').textContent=operator.name;
  document.getElementById('tgCurrentPassword').textContent='Загрузка…';
  document.getElementById('tgNewPassword').value='';
  document.getElementById('tgPasswordStatus').textContent='';
  tgPasswordDialog.showModal();
  try{
    const response=await fetch('/api/telegram/operators/'+encodeURIComponent(operator.id)+'/password');
    const data=await response.json();if(!response.ok)throw new Error(data.error);
    document.getElementById('tgCurrentPassword').textContent=data.password;
  }catch(e){document.getElementById('tgCurrentPassword').textContent='Недоступен';document.getElementById('tgPasswordStatus').textContent=e.message;}
}
document.getElementById('tgPasswordClose').onclick=()=>tgPasswordDialog.close();
tgPasswordDialog.addEventListener('click',event=>{if(event.target===tgPasswordDialog)tgPasswordDialog.close();});
document.getElementById('tgCopyPassword').onclick=async()=>{
  const password=document.getElementById('tgCurrentPassword').textContent;
  if(password==='Загрузка…'||password==='Недоступен')return;
  try{await navigator.clipboard.writeText(password);document.getElementById('tgPasswordStatus').textContent='Пароль скопирован.';}catch{document.getElementById('tgPasswordStatus').textContent='Выделите пароль и скопируйте вручную.';}
};
document.getElementById('tgGeneratePassword').onclick=()=>{
  const bytes=window.crypto.getRandomValues(new Uint8Array(18));
  document.getElementById('tgNewPassword').value=Array.from(bytes,b=>b.toString(36).padStart(2,'0')).join('').slice(0,24);
};
document.getElementById('tgPasswordForm').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');button.disabled=true;
  const id=document.getElementById('tgPasswordOperatorId').value,password=document.getElementById('tgNewPassword').value;
  try{
    const response=await fetch('/api/telegram/operators/'+encodeURIComponent(id)+'/password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
    const data=await response.json();if(!response.ok)throw new Error(data.error);
    document.getElementById('tgCurrentPassword').textContent=data.password;
    document.getElementById('tgNewPassword').value='';
    document.getElementById('tgPasswordStatus').textContent='Пароль изменён. Оператору нужно войти в бот заново.';
    await refreshTelegramSupport();
  }catch(e){document.getElementById('tgPasswordStatus').textContent=e.message;}finally{button.disabled=false;}
});
refreshTelegramSupport().catch(e=>document.getElementById('tgConnection').textContent=e.message);

async function loadMetaInbox(){
  if(document.body.dataset.role!=='superadmin')return;
  const response=await fetch('/api/meta-inbox/status');const data=await response.json();if(!response.ok)throw new Error(data.error);
  document.getElementById('metaWebhookUrl').value=data.webhookUrl||'';document.getElementById('metaVerifyToken').value=data.verifyToken||'';
  const form=document.getElementById('whatsappConnectForm');form.elements.phoneNumberId.value=data.whatsapp.phoneNumberId||'';form.elements.businessAccountId.value=data.whatsapp.businessAccountId||'';form.elements.displayPhoneNumber.value=data.whatsapp.displayPhoneNumber||'';
  const publicBox=document.getElementById('whatsappPublicLink'),publicOpen=document.getElementById('whatsappPublicOpen');publicBox.hidden=!data.whatsapp.publicUrl;publicOpen.href=data.whatsapp.publicUrl||'#';document.getElementById('whatsappPublicNumber').textContent=data.whatsapp.displayPhoneNumber||'';publicBox.dataset.url=data.whatsapp.publicUrl||'';
  const connected = channel => metaLabel(channel.connected ? 'Подключён' : 'Не подключён');
  document.getElementById('metaInboxState').replaceChildren('Messenger: ', connected(data.facebook), ' · WhatsApp: ', connected(data.whatsapp));
}
function metaLabel(text){
  const label=document.createElement('span');
  label.textContent=text;
  return label;
}
function metaTime(value){return value?formatDate(value):metaLabel('Ещё не было');}
function metaDiagnostic(channel, state, activity, detail){
  const line=document.createElement('span');
  line.append(channel+': ', metaLabel(state));
  if(detail)line.append(' ', detail);
  line.append(' · ', metaLabel('Последнее входящее'), ': ', metaTime(activity?.lastInboundAt));
  return line;
}
async function checkMetaChannels(){
  const response=await fetch('/api/meta-inbox/diagnostics');const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось проверить каналы.');
  const wa=data.whatsapp||{},fb=data.facebook||{};
  const waState=!wa.configured?'Не настроен. Заполните данные WhatsApp в настройках канала.':!wa.api?'Ошибка API WhatsApp.':wa.webhookSubscribed?'API и webhook подключены.':'API работает. Подключите webhook WhatsApp.';
  const missingPagePermission=fb.error?.includes('pages_manage_metadata');
  const fbState=!fb.configured?'Не подключён.':missingPagePermission?'Meta не предоставила разрешение pages_manage_metadata. Переподключите страницу Facebook через настройки и подтвердите разрешения.':!fb.api?'Ошибка API Messenger.':fb.subscribedFields?.includes('messages')?'Подписка Messenger на входящие сообщения активна.':'Подключите Messenger, чтобы получать входящие сообщения.';
  document.getElementById('metaDiagnostics').replaceChildren(
    metaDiagnostic('WhatsApp', waState, wa.activity, wa.configured&&!wa.api?wa.error:''),
    document.createElement('br'),
    metaDiagnostic('Messenger', fbState, fb.activity, !missingPagePermission&&fb.configured&&!fb.api?fb.error:'')
  );
  return data;
}
async function loadChatwoot(){
  const response=await fetch('/api/chatwoot/status');const data=await response.json();if(!response.ok)throw new Error(data.error);
  document.getElementById('chatwootWebhookUrl').value=data.webhookUrl||'';
  const form=document.getElementById('chatwootConnectForm');form.elements.accountId.value=data.accountId||'';form.elements.inboxId.value=data.inboxId||'';form.elements.apiToken.value='';form.elements.webhookSecret.value='';
  form.elements.apiToken.placeholder=data.apiTokenConfigured?'Токен сохранён · оставьте пустым, чтобы не менять':'API token из профиля Chatwoot';
  form.elements.webhookSecret.placeholder=data.webhookSecretConfigured?'Секрет сохранён · оставьте пустым, чтобы не менять':'Секрет подписи webhook';
  const status=document.getElementById('chatwootStatus');
  if(data.configured)status.replaceChildren(metaLabel('Chatwoot подключён.'), ' ', metaLabel('Последнее сообщение'), ': ', metaTime(data.activity?.lastInboundAt));
  else status.textContent='Підключіть потрібні канали в Chatwoot і збережіть налаштування.';
}
async function checkChatwoot(){
  const response=await fetch('/api/chatwoot/diagnostics');const data=await response.json();if(!response.ok)throw new Error(data.error);
  const inboxId=document.getElementById('chatwootConnectForm').elements.inboxId.value;
  const selected=data.inboxes?.find(item=>item.id===inboxId);
  const status=document.getElementById('chatwootStatus');
  if(!data.configured)status.textContent='Chatwoot настроен не полностью.';
  else if(data.api && inboxId && !selected)status.textContent='Вказаний Inbox ID відсутній серед доступних каналів Chatwoot.';
  else if(data.api){
    const names=(selected?[selected]:data.inboxes||[]).map(item=>item.name||item.channelType).filter(Boolean);
    status.replaceChildren(metaLabel('Chatwoot API работает'), names.length?` · ${names.join(', ')}`:' · Немає доступних каналів', ' · ', metaLabel('Последнее входящее'), ': ', metaTime(data.activity?.lastInboundAt));
  }
  else status.replaceChildren(metaLabel('Ошибка Chatwoot API'), ': ', data.error||metaLabel('Проверьте токен'));
}
document.querySelectorAll('[data-copy-field]').forEach(button=>button.onclick=async()=>{const field=document.getElementById(button.dataset.copyField);try{await navigator.clipboard.writeText(field.value);button.textContent='Скопировано';setTimeout(()=>button.textContent='Копировать',1200);}catch{field.select();}});
document.getElementById('whatsappPublicCopy').onclick=async event=>{const button=event.currentTarget,url=document.getElementById('whatsappPublicLink').dataset.url;if(!url)return;try{await navigator.clipboard.writeText(url);button.textContent='Ссылка скопирована';setTimeout(()=>button.textContent='Копировать ссылку',1400);}catch{document.getElementById('metaInboxMessage').textContent=url;}};
document.querySelectorAll('[data-copy-link]').forEach(button=>button.onclick=async()=>{const label=button.textContent;try{await navigator.clipboard.writeText(button.dataset.copyLink);button.textContent='Ссылка скопирована ✓';setTimeout(()=>button.textContent=label,1400);}catch{button.textContent='Скопируйте ссылку вручную';}});
document.getElementById('whatsappConnectForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{const response=await fetch('/api/meta-inbox/whatsapp',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});const data=await response.json();if(!response.ok)throw new Error(data.error);form.elements.accessToken.value='';document.getElementById('metaInboxMessage').textContent='WhatsApp сохранён. Теперь подтвердите webhook в Meta и подпишите поле messages.';await loadMetaInbox();}catch(error){document.getElementById('metaInboxMessage').textContent=error.message;}finally{button.disabled=false;}});
const reconnectMessenger=document.getElementById('reconnectMessenger');if(reconnectMessenger)reconnectMessenger.onclick=()=>{location.href='/api/facebook/connect';};
document.getElementById('checkMetaChannels').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await checkMetaChannels();}catch(error){document.getElementById('metaDiagnostics').textContent=error.message;}finally{button.disabled=false;}};
document.getElementById('repairFacebook').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{const response=await fetch('/api/meta-inbox/facebook/subscribe',{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.error);document.getElementById('metaInboxMessage').textContent='Страница Facebook подписана на входящие Messenger-сообщения.';await checkMetaChannels();}catch(error){document.getElementById('metaInboxMessage').textContent=error.message;}finally{button.disabled=false;}};
document.getElementById('repairWhatsApp').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{const response=await fetch('/api/meta-inbox/whatsapp/subscribe',{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.error);document.getElementById('metaInboxMessage').textContent='Webhook WhatsApp подписан на приложение Meta.';await checkMetaChannels();}catch(error){document.getElementById('metaInboxMessage').textContent=error.message;}finally{button.disabled=false;}};
document.getElementById('chatwootConnectForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');button.disabled=true;try{const response=await fetch('/api/chatwoot/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});const data=await response.json();if(!response.ok)throw new Error(data.error);document.getElementById('chatwootStatus').textContent='Настройки Chatwoot сохранены.';await loadChatwoot();await checkChatwoot();}catch(error){document.getElementById('chatwootStatus').textContent=error.message;}finally{button.disabled=false;}});
document.getElementById('checkChatwoot').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await checkChatwoot();}catch(error){document.getElementById('chatwootStatus').textContent=error.message;}finally{button.disabled=false;}};
document.querySelectorAll('[data-meta-test]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const response=await fetch('/api/meta-inbox/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:button.dataset.metaTest})});const data=await response.json();if(!response.ok)throw new Error(data.error);document.getElementById('metaInboxMessage').textContent=`Тест ${button.dataset.metaTest==='whatsapp'?'WhatsApp':'Facebook'} добавлен в обращения.`;}catch(error){document.getElementById('metaInboxMessage').textContent=error.message;}finally{button.disabled=false;}});
Promise.all([loadMetaInbox().then(()=>checkMetaChannels()),loadChatwoot()]).catch(error=>{if(document.getElementById('metaInboxMessage'))document.getElementById('metaInboxMessage').textContent=error.message;});

let growthState=null;
const growthStatusLabels={planned:'Нужно подключить',checking:'Проверяем',eligible:'Доступно',connected:'Подключено',blocked:'Пока недоступно'};
function renderGrowthLeads(leads){
  const root=document.getElementById('growthLeads');
  if(!leads.length){root.innerHTML='<div class="workspace-empty">Обращений пока нет<small>Добавьте первую публикацию для проверки.</small></div>';return;}
  root.innerHTML=leads.map(lead=>`<article class="growth-lead ${lead.score>=55?'hot':''}"><div class="growth-lead-head"><span class="growth-platform">${escapeHtml(lead.platform)}</span><span class="growth-score">${lead.score}% совпадение</span><span class="growth-lead-status">${({new:'Новое',reviewed:'Просмотрено',replied:'Ответили',ignored:'Не подходит'})[lead.status]||lead.status}</span></div><h4>${escapeHtml(lead.author||'Автор не указан')}</h4><p>${escapeHtml(lead.text)}</p>${lead.matched?.length?`<div class="growth-tags">${lead.matched.map(x=>`<span>${escapeHtml(x)}</span>`).join('')}</div>`:''}${lead.suggestedReply?`<label>Предлагаемый ответ<textarea data-lead-reply="${lead.id}" rows="4">${escapeHtml(lead.suggestedReply)}</textarea></label>`:'<div class="growth-no-match">Ключевые фразы не найдены. Можно оставить для ручной проверки.</div>'}<div class="growth-lead-actions">${safeExternalUrl(lead.url)?`<a class="ghost-btn" href="${escapeHtml(safeExternalUrl(lead.url))}" target="_blank" rel="noopener">Открыть источник ↗</a>`:''}<button class="ghost-btn" data-lead-status="reviewed" data-lead-id="${lead.id}">Просмотрено</button><button class="primary-btn" data-lead-status="replied" data-lead-id="${lead.id}">Отметить ответ</button><button class="growth-ignore" data-lead-status="ignored" data-lead-id="${lead.id}">Скрыть</button></div></article>`).join('');
  root.querySelectorAll('[data-lead-status]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const reply=root.querySelector(`[data-lead-reply="${button.dataset.leadId}"]`)?.value;const response=await fetch('/api/growth/leads/'+encodeURIComponent(button.dataset.leadId),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:button.dataset.leadStatus,suggestedReply:reply})});const data=await response.json();if(!response.ok)throw new Error(data.error);await loadGrowth();}catch(error){document.getElementById('leadFormStatus').textContent=error.message;button.disabled=false;}});
}
function renderMonetization(items){
  const root=document.getElementById('monetizationList');
  root.innerHTML=items.map(item=>`<article class="money-row"><div class="money-brand ${item.id}">${item.name.slice(0,1)}</div><div class="money-copy"><h4>${escapeHtml(item.name)}</h4><p>${escapeHtml(item.programs)}</p><textarea data-money-notes="${item.id}" rows="2" placeholder="Следующий шаг или заметка">${escapeHtml(item.notes||'')}</textarea></div><div class="money-actions"><select data-money-status="${item.id}">${Object.entries(growthStatusLabels).map(([value,label])=>`<option value="${value}" ${item.status===value?'selected':''}>${label}</option>`).join('')}</select><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Открыть ↗</a><button class="ghost-btn" data-money-save="${item.id}">Сохранить</button></div></article>`).join('');
  root.querySelectorAll('[data-money-save]').forEach(button=>button.onclick=async()=>{const id=button.dataset.moneySave;button.disabled=true;try{const response=await fetch('/api/growth/monetization/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:root.querySelector(`[data-money-status="${id}"]`).value,notes:root.querySelector(`[data-money-notes="${id}"]`).value})});const data=await response.json();if(!response.ok)throw new Error(data.error);button.textContent='Сохранено';setTimeout(()=>button.textContent='Сохранить',1400);}catch(error){button.textContent=error.message;}finally{button.disabled=false;}});
}
async function loadGrowth(){
  const response=await fetch('/api/growth');const data=await response.json();if(!response.ok)throw new Error(data.error);growthState=data;
  if(document.body.dataset.role==='operator'){
    const channel=data.channel||{};
    document.getElementById('channelConnection').textContent=channel.username?`Канал @${channel.username}${channel.connected?' · публикация подключена':' · добавьте @bereg_support_bot администратором'}`:'Сначала создайте публичный канал и укажите его имя.';
    return;
  }
  document.getElementById('growthNewCount').textContent=data.stats.new;document.getElementById('growthHotCount').textContent=data.stats.hot;document.getElementById('growthTotalCount').textContent=data.stats.total;
  document.getElementById('growthKeywords').value=data.keywords.join('\n');renderGrowthLeads(data.leads);renderMonetization(data.monetization);
  const cf=document.getElementById('channelSettingsForm');cf.elements.name.value=data.channel.name||'';cf.elements.username.value=data.channel.username||'';cf.elements.description.value=data.channel.description||'';
  document.getElementById('channelConnection').textContent=data.channel.username?`Канал @${data.channel.username}${data.channel.connected?' · публикация подключена':' · добавьте @bereg_support_bot администратором'}`:'Сначала создайте публичный канал и укажите его имя.';
}
document.querySelectorAll('[data-growth-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-growth-tab]').forEach(x=>x.classList.toggle('active',x===button));document.querySelectorAll('[data-growth-pane]').forEach(x=>x.classList.toggle('active',x.dataset.growthPane===button.dataset.growthTab));});
document.getElementById('leadForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{const response=await fetch('/api/growth/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});const data=await response.json();if(!response.ok)throw new Error(data.error);document.getElementById('leadFormStatus').textContent=data.lead.matched.length?`Найдено совпадений: ${data.lead.matched.join(', ')}.`:'Совпадений нет — публикация сохранена для ручной проверки.';form.reset();await loadGrowth();}catch(error){document.getElementById('leadFormStatus').textContent=error.message;}finally{button.disabled=false;}});
document.getElementById('saveGrowthKeywords').onclick=async()=>{const button=document.getElementById('saveGrowthKeywords');button.disabled=true;try{const keywords=document.getElementById('growthKeywords').value.split('\n');const response=await fetch('/api/growth/keywords',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({keywords})});const data=await response.json();if(!response.ok)throw new Error(data.error);document.getElementById('growthKeywordsStatus').textContent=`Сохранено фраз: ${data.keywords.length}.`;}catch(error){document.getElementById('growthKeywordsStatus').textContent=error.message;}finally{button.disabled=false;}};
document.getElementById('channelSettingsForm').addEventListener('submit',async event=>{event.preventDefault();const response=await fetch('/api/growth/channel',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});const data=await response.json();document.getElementById('channelSettingsStatus').textContent=response.ok?'Настройки канала сохранены.':data.error;await loadGrowth();});
document.getElementById('channelPostForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;document.getElementById('channelPostStatus').textContent='Публикую…';try{const response=await fetch('/api/growth/channel/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:form.elements.text.value})});const data=await response.json();if(!response.ok)throw new Error(data.error);document.getElementById('channelPostStatus').innerHTML=`Опубликовано. <a href="${data.url}" target="_blank" rel="noopener">Открыть пост ↗</a>`;form.reset();await loadGrowth();}catch(error){document.getElementById('channelPostStatus').textContent=error.message;}finally{button.disabled=false;}});
const languageForTikTokPrivacy={PUBLIC_TO_EVERYONE:'Все',MUTUAL_FOLLOW_FRIENDS:'Друзья',FOLLOWER_OF_CREATOR:'Подписчики',SELF_ONLY:'Только я'};
const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let tiktokJobs=[];
async function loadTikTok(){
  const statusNode=document.getElementById('tiktokConnection'),accountNode=document.getElementById('tiktokAccount');
  try{
    const response=await fetch('/api/tiktok/status'),data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось загрузить TikTok.');
    document.getElementById('tiktokRedirectUri').value=data.redirectUri||'';
    document.getElementById('tiktokAppConfigForm').elements.clientKey.value=data.clientKey||'';
    statusNode.textContent=data.connected?'Аккаунт TikTok подключён.':data.appConfigured?'Приложение готово. Подключите аккаунт владельца.':'Добавьте ключи приложения TikTok.';
    accountNode.textContent=data.connected?`${data.nickname||data.username||'TikTok'}${data.username?' · @'+data.username:''} · Права: ${data.scope||'—'}`:'';
    document.getElementById('tiktokConnect').hidden=!data.appConfigured||data.connected||document.body.dataset.role!=='superadmin';
    document.getElementById('tiktokDisconnect').hidden=!data.connected||document.body.dataset.role!=='superadmin';
    document.getElementById('tiktokPublishForm').querySelector('button[type="submit"]').disabled=!data.connected;
    tiktokJobs=data.jobs||[];renderTikTokJobs();
    if(data.connected){
      const creatorResponse=await fetch('/api/tiktok/creator'),creatorData=await creatorResponse.json();
      if(!creatorResponse.ok)throw new Error(creatorData.error||'Не удалось получить настройки TikTok.');
      const options=creatorData.creator?.privacy_level_options||[];const privacy=document.querySelector('#tiktokPublishForm [name="privacy"]');
      privacy.innerHTML=options.map(value=>`<option value="${htmlEscape(value)}">${htmlEscape(languageForTikTokPrivacy[value]||value)}</option>`).join('')||'<option value="">Недоступно</option>';
      for(const [field,locked] of [['disableComment',creatorData.creator?.comment_disabled],['disableDuet',creatorData.creator?.duet_disabled],['disableStitch',creatorData.creator?.stitch_disabled]]){const checkbox=document.querySelector(`#tiktokPublishForm [name="${field}"]`);if(locked){checkbox.checked=true;checkbox.disabled=true;}else checkbox.disabled=false;}
      document.getElementById('tiktokPublishForm').querySelector('button[type="submit"]').disabled=false;
    }
  }catch(error){statusNode.textContent=error.message;}
}
function renderTikTokJobs(){const root=document.getElementById('tiktokJobs');root.innerHTML=tiktokJobs.map(job=>`<article class="mini-card"><span>${htmlEscape(job.mode==='inbox'?'Черновик в TikTok':'Прямая публикация')} · ${htmlEscape(job.createdAt?new Date(job.createdAt).toLocaleString('ru-RU'):'')}</span><strong>${htmlEscape(job.status||'Отправлено')}</strong>${job.title?`<small>${htmlEscape(job.title)}</small>`:''}${job.failReason?`<small>${htmlEscape(job.failReason)}</small>`:''}<button class="ghost-btn" type="button" data-tiktok-refresh="${htmlEscape(job.publishId)}">Обновить статус</button></article>`).join('');root.querySelectorAll('[data-tiktok-refresh]').forEach(button=>button.onclick=()=>refreshTikTokJob(button.dataset.tiktokRefresh));}
document.getElementById('tiktokConnect').onclick=()=>{location.href='/api/tiktok/connect';};
document.getElementById('tiktokAppConfigForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{const response=await fetch('/api/tiktok/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientKey:form.elements.clientKey.value,clientSecret:form.elements.clientSecret.value})});const data=await response.json();if(!response.ok)throw new Error(data.error);form.elements.clientSecret.value='';document.getElementById('tiktokConnectionStatus').textContent='Ключи TikTok сохранены. Добавьте показанный Callback URL в настройках Login Kit.';await loadTikTok();}catch(error){document.getElementById('tiktokConnectionStatus').textContent=error.message;}finally{button.disabled=false;}});
document.getElementById('tiktokDisconnect').onclick=async()=>{if(!confirm('Отключить TikTok аккаунт от CRM?'))return;try{const response=await fetch('/api/tiktok/disconnect',{method:'DELETE'}),data=await response.json();if(!response.ok)throw new Error(data.error);await loadTikTok();}catch(error){document.getElementById('tiktokConnectionStatus').textContent=error.message;}};
document.getElementById('tiktokPublishForm').elements.mode.addEventListener('change',event=>{const direct=event.currentTarget.value==='direct';document.getElementById('tiktokPrivacyLabel').hidden=!direct;for(const field of ['ownBusiness','disableComment','disableDuet','disableStitch','isAigc'])document.querySelector(`#tiktokPublishForm [name="${field}"]`).closest('label').hidden=!direct;});
async function refreshTikTokJob(publishId){try{const response=await fetch('/api/tiktok/publish/'+encodeURIComponent(publishId)),data=await response.json();if(!response.ok)throw new Error(data.error);const job=data.job,index=tiktokJobs.findIndex(item=>item.publishId===publishId);if(index>=0)tiktokJobs[index]={...tiktokJobs[index],...job};renderTikTokJobs();return job;}catch(error){document.getElementById('tiktokPublishStatus').textContent=error.message;return null;}}
document.getElementById('tiktokPublishForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;document.getElementById('tiktokPublishStatus').textContent='Загружаю видео в TikTok…';try{const response=await fetch('/api/tiktok/publish',{method:'POST',body:new FormData(form)}),data=await response.json();if(!response.ok)throw new Error(data.error);document.getElementById('tiktokPublishStatus').textContent=data.message;form.reset();form.elements.mode.value='direct';form.elements.mode.dispatchEvent(new Event('change'));await loadTikTok();for(let i=0;i<18;i++){await new Promise(resolve=>setTimeout(resolve,5000));const job=await refreshTikTokJob(data.job.publishId);if(!job||['PUBLISH_COMPLETE','FAILED','SEND_TO_USER_INBOX'].includes(job.status))break;}}catch(error){document.getElementById('tiktokPublishStatus').textContent=error.message;}finally{button.disabled=false;}});
loadTikTok();
document.getElementById('refreshGrowth').onclick=()=>loadGrowth().catch(error=>document.getElementById('leadFormStatus').textContent=error.message);
loadGrowth().catch(error=>document.getElementById('leadFormStatus').textContent=error.message);

if(document.body.dataset.role==='superadmin'){const accountScript=document.createElement('script');accountScript.src='/telegram-account.js?v=1';document.body.append(accountScript);}
