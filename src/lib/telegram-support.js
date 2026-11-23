const fs = require('./runtime-fs');
const path = require('path');
const crypto = require('crypto');
const { translateMessage, detectMessageLanguage } = require('./message-translation');
const { languages, languageCodes } = require('./languages');

function createSupport({ directory, tokens = {}, api: customApi, externalSender, externalFileSender, autoReply, workerMode = false, webhookSecret = '', webhookBaseUrl = '' }) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const files=require('./dialog-files').createDialogFiles(directory,tokens.client);
  const file = path.join(directory, 'support.json');
  const passwordKeyFile = path.join(directory, 'operator-password.key');
  let passwordKey;
  if (fs.existsSync(passwordKeyFile)) passwordKey = fs.readFileSync(passwordKeyFile);
  else {
    passwordKey = crypto.randomBytes(32);
    fs.writeFileSync(passwordKeyFile, passwordKey, { mode: 0o600, flag: 'wx' });
  }
  if (passwordKey.length !== 32) throw new Error('Повреждён ключ хранилища паролей операторов.');
  const encryptPassword = password => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', passwordKey, iv);
    const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
  };
  const decryptPassword = vault => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', passwordKey, Buffer.from(vault.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(vault.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(vault.data, 'base64')), decipher.final()]).toString('utf8');
  };
  let state = { operators: [], clients: {}, replies: {}, queue: [], offsets: { client: 0, operator: 0 } };
  if (fs.existsSync(file)) state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const savedLanguages=state.languages||{};
  if(savedLanguages.client||savedLanguages.operator){state.languages={client:savedLanguages.client||{},operator:savedLanguages.operator||{}};}
  else state.languages={client:{...savedLanguages},operator:{...savedLanguages}};
  state.clientChoices ||= {};
  state.webhookUpdates ||= { client: [], operator: [] };
  for(const operator of state.operators)operator.language||=null;
  const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(state), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); };
  const status = { configured: Boolean(tokens.client && tokens.operator && tokens.client !== tokens.operator), running: false, error: null };
  const attempts = new Map();
  let flushing=false,flushAgain=false;
  const api = customApi || (async (bot, method, body) => {
    const response = await fetch(`https://api.telegram.org/bot${tokens[bot]}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000)
    });
    const data = await response.json();
    if (!data.ok) throw new Error(`Telegram ${data.error_code}: ${data.description}`);
    return data.result;
  });
  const send = (bot, chat_id, text, extra = {}) => api(bot, 'sendMessage', { chat_id, text, ...extra });
  const words={
    en:{clientWrite:'💬 Message support',servicesButton:'📋 Services',contactsButton:'📍 Contacts',languageButton:'🌐 Language',servicesTitle:'How we can help',services:'Translation services\nImmigration procedures\nLegal and appointment assistance',servicesPrompt:'Tell us what help you need and in which city. A support agent will follow up.',contacts:'Contact BEREG OUTSOURCE GROUP\n\n☎ +36 70 743 9706\nViber · Telegram · WhatsApp\n\n✉ ugyintezesmagyarorszagon@gmail.com\n📍 1117 Budapest, Budafoki út 60.\n\nSend us a message here and we will pass it to our team.',help:'Tell us what you need help with. Include your city, request and preferred timing. Your next text message will be sent to a support agent. This chat currently accepts text only.',hello:'BEREG OUTSOURCE GROUP\nYour support team in Hungary 🇭🇺\n\nWe help with translation, immigration procedures and personal assistance.\n\nDescribe what you need in one message and a support agent will reply here. Choose an option below or change language with /language.',sent:'✓ Your message has been sent to your support agent. Their reply will arrive in this chat.',queued:'Your message is in the queue. A support agent will reply as soon as possible.',tooLong:'Please send a text message of up to 3,500 characters.',chooseLanguage:'Choose a language:',languageSaved:'Language set to English.',clientMenuLanguage:'Change language',teamClients:'👥 My customers',online:'🟢 Available',pause:'⏸ Pause',how:'❔ How to reply',loginPrompt:'BEREG · Support team\n\nTo sign in, send:\n/login your_personal_password\n\nYour superadministrator creates your account in the CRM and gives you a personal password.',attempts:'Too many attempts. Try again in 15 minutes.',invalidLogin:'Incorrect password or this account is already linked.',loginSuccess:'You are signed in as {name}. Reply to a customer using Reply on their message. Commands: /clients, /pause, /online, /close.',teamStart:'BEREG · Team workspace\n\nUse the menu below. Reply to a customer by replying to their message. Send /close as a reply to close a conversation. Pause stops new assignments; your current customers remain assigned.',available:'You are available for new customers.',paused:'New customers will not be assigned to you. Your current customers remain assigned.',noClients:'No active customers.',statusNew:'New',statusInProgress:'In progress',statusClosed:'Closed',sendText:'Send a text message of up to 3,500 characters.',closed:'Conversation closed.',delivered:'Your reply has been sent to the customer.',source:'Source',customer:'Customer',contact:'Contact',link:'Link',replyHint:'↩ Reply to this message to respond to the customer.',newApplication:'New application from BEREG. The application PDF is saved in the CRM.',reassigned:'Customer reassigned. Last message: '},
    ru:{clientWrite:'💬 Написать оператору',servicesButton:'📋 Услуги',contactsButton:'📍 Контакты',languageButton:'🌐 Язык',servicesTitle:'Чем мы можем помочь',services:'Устный и письменный перевод\nМиграционные процедуры\nЮридические вопросы и сопровождение',servicesPrompt:'Расскажите, какая помощь нужна и в каком городе. Оператор свяжется с вами.',contacts:'Контакты BEREG OUTSOURCE GROUP\n\n☎ +36 70 743 9706\nViber · Telegram · WhatsApp\n\n✉ ugyintezesmagyarorszagon@gmail.com\n📍 1117 Budapest, Budafoki út 60.\n\nНапишите нам здесь, и мы передадим сообщение команде.',help:'Напишите, с чем нужна помощь. Укажите город, задачу и удобный срок. Следующее текстовое сообщение получит оператор. Сейчас чат принимает только текст.',hello:'BEREG OUTSOURCE GROUP\nВаша команда поддержки в Венгрии 🇭🇺\n\nПомогаем с переводом, миграционными процедурами и сопровождением.\n\nОпишите задачу одним сообщением, и оператор ответит здесь. Выберите пункт меню или смените язык командой /language.',sent:'✓ Сообщение передано оператору. Ответ придёт в этот чат.',queued:'Сообщение принято в очередь. Оператор ответит, как только освободится.',tooLong:'Отправьте текстовое сообщение до 3500 символов.',chooseLanguage:'Выберите язык:',languageSaved:'Язык изменён на русский.',teamClients:'👥 Мои клиенты',online:'🟢 На смене',pause:'⏸ Пауза',how:'❔ Как отвечать',loginPrompt:'BEREG · Команда поддержки\n\nДля входа отправьте:\n/login ваш_личный_пароль\n\nСуперадминистратор создаёт вашу учётную запись в CRM и выдаёт личный пароль.',attempts:'Слишком много попыток. Попробуйте через 15 минут.',invalidLogin:'Неверный пароль или учётная запись уже привязана.',loginSuccess:'Вы вошли как {name}. Ответьте на сообщение клиента, чтобы написать ему. Команды: /clients, /pause, /online, /close.',teamStart:'BEREG · Рабочее пространство\n\nИспользуйте меню ниже. Чтобы ответить клиенту, ответьте на его сообщение. Отправьте /close ответом на сообщение, чтобы закрыть диалог. Пауза останавливает новые назначения, закреплённые клиенты остаются у вас.',available:'Вы принимаете новых клиентов.',paused:'Новые клиенты не назначаются. Закреплённые клиенты остаются у вас.',noClients:'Активных клиентов пока нет.',statusNew:'Новое',statusInProgress:'В работе',statusClosed:'Закрыто',sendText:'Отправьте текст до 3500 символов.',closed:'Обращение закрыто.',delivered:'Ответ отправлен клиенту.',source:'Источник',customer:'Клиент',contact:'Контакт',link:'Ссылка',replyHint:'↩ Ответьте на это сообщение, чтобы написать клиенту.',newApplication:'Новая заявка BEREG. PDF анкеты сохранён в CRM.',reassigned:'Клиент переназначен. Последнее сообщение: '},
    vi:{clientWrite:'💬 Nhắn cho hỗ trợ',servicesButton:'📋 Dịch vụ',contactsButton:'📍 Liên hệ',languageButton:'🌐 Ngôn ngữ',servicesTitle:'Chúng tôi có thể giúp gì',services:'Phiên dịch và dịch thuật\nThủ tục nhập cư\nHỗ trợ pháp lý và lịch hẹn',servicesPrompt:'Hãy cho biết bạn cần hỗ trợ gì và ở thành phố nào. Nhân viên hỗ trợ sẽ liên hệ.',contacts:'Liên hệ BEREG OUTSOURCE GROUP\n\n☎ +36 70 743 9706\nViber · Telegram · WhatsApp\n\n✉ ugyintezesmagyarorszagon@gmail.com\n📍 1117 Budapest, Budafoki út 60.\n\nNhắn tin tại đây, chúng tôi sẽ chuyển cho nhóm hỗ trợ.',help:'Hãy mô tả vấn đề cần hỗ trợ, thành phố và thời gian phù hợp. Tin nhắn văn bản tiếp theo sẽ được gửi cho nhân viên hỗ trợ. Chat hiện chỉ nhận văn bản.',hello:'BEREG OUTSOURCE GROUP\nĐội ngũ hỗ trợ tại Hungary 🇭🇺\n\nChúng tôi hỗ trợ phiên dịch, thủ tục nhập cư và đồng hành trực tiếp.\n\nHãy mô tả yêu cầu trong một tin nhắn, nhân viên hỗ trợ sẽ trả lời tại đây. Chọn mục bên dưới hoặc đổi ngôn ngữ bằng /language.',sent:'✓ Tin nhắn đã được gửi cho nhân viên hỗ trợ. Câu trả lời sẽ đến trong chat này.',queued:'Tin nhắn đang chờ. Nhân viên hỗ trợ sẽ trả lời sớm nhất có thể.',tooLong:'Vui lòng gửi tin nhắn văn bản tối đa 3.500 ký tự.',chooseLanguage:'Chọn ngôn ngữ:',languageSaved:'Đã chuyển sang tiếng Việt.',teamClients:'👥 Khách hàng của tôi',online:'🟢 Sẵn sàng',pause:'⏸ Tạm dừng',how:'❔ Cách trả lời',loginPrompt:'BEREG · Nhóm hỗ trợ\n\nĐể đăng nhập, hãy gửi:\n/login mật_khẩu_cá_nhân\n\nQuản trị viên sẽ cung cấp mật khẩu riêng.',attempts:'Bạn đã thử quá nhiều lần. Hãy thử lại sau 15 phút.',invalidLogin:'Mật khẩu không đúng hoặc tài khoản đã được liên kết.',loginSuccess:'Bạn đã đăng nhập với tên {name}. Trả lời tin nhắn của khách hàng để phản hồi. Lệnh: /clients, /pause, /online, /close.',teamStart:'BEREG · Không gian làm việc\n\nSử dụng menu bên dưới. Trả lời tin nhắn của khách để phản hồi. Gửi /close dưới dạng trả lời để đóng cuộc trò chuyện. Tạm dừng sẽ ngừng phân khách mới; khách hiện tại vẫn được giữ.',available:'Bạn đang nhận khách hàng mới.',paused:'Bạn sẽ không nhận khách mới. Khách hiện tại vẫn được giữ.',noClients:'Chưa có khách hàng đang hoạt động.',statusNew:'Mới',statusInProgress:'Đang xử lý',statusClosed:'Đã đóng',sendText:'Gửi tin nhắn văn bản tối đa 3.500 ký tự.',closed:'Đã đóng cuộc trò chuyện.',delivered:'Đã gửi phản hồi cho khách hàng.',source:'Kênh',customer:'Khách hàng',contact:'Liên hệ',link:'Liên kết',replyHint:'↩ Trả lời tin nhắn này để phản hồi khách hàng.',newApplication:'Có đơn đăng ký mới từ BEREG. Tệp PDF đã được lưu trong CRM.',reassigned:'Khách hàng được chuyển lại. Tin nhắn gần nhất: '},
    uk:{clientWrite:'💬 Написати оператору',servicesButton:'📋 Послуги',contactsButton:'📍 Контакти',languageButton:'🌐 Мова',servicesTitle:'Чим ми можемо допомогти',services:'Усний і письмовий переклад\nМіграційні процедури\nЮридичні питання та супровід',servicesPrompt:'Розкажіть, яка допомога потрібна та в якому місті. Оператор зв’яжеться з вами.',contacts:'Контакти BEREG OUTSOURCE GROUP\n\n☎ +36 70 743 9706\nViber · Telegram · WhatsApp\n\n✉ ugyintezesmagyarorszagon@gmail.com\n📍 1117 Budapest, Budafoki út 60.\n\nНапишіть нам тут, і ми передамо повідомлення команді.',help:'Напишіть, яка допомога вам потрібна. Вкажіть місто, запит і зручний час. Наступне текстове повідомлення отримає оператор. Чат наразі приймає лише текст.',hello:'BEREG OUTSOURCE GROUP\nВаша команда підтримки в Угорщині 🇭🇺\n\nДопомагаємо з перекладом, міграційними процедурами та супроводом.\n\nОпишіть запит одним повідомленням, і оператор відповість тут. Оберіть пункт меню або змініть мову командою /language.',sent:'✓ Повідомлення передано оператору. Відповідь надійде в цей чат.',queued:'Повідомлення в черзі. Оператор відповість, щойно звільниться.',tooLong:'Надішліть текстове повідомлення до 3500 символів.',chooseLanguage:'Оберіть мову:',languageSaved:'Мову змінено на українську.',teamClients:'👥 Мої клієнти',online:'🟢 На зміні',pause:'⏸ Пауза',how:'❔ Як відповідати',loginPrompt:'BEREG · Команда підтримки\n\nДля входу надішліть:\n/login ваш_особистий_пароль\n\nСуперадміністратор створює ваш обліковий запис у CRM і надає особистий пароль.',attempts:'Забагато спроб. Спробуйте ще раз через 15 хвилин.',invalidLogin:'Неправильний пароль або обліковий запис уже прив’язаний.',loginSuccess:'Ви увійшли як {name}. Щоб відповісти клієнту, натисніть «Відповісти» на його повідомленні. Команди: /clients, /pause, /online, /close.',teamStart:'BEREG · Робочий простір\n\nВикористовуйте меню нижче. Щоб відповісти клієнту, дайте відповідь на його повідомлення. Надішліть /close у відповіді, щоб закрити звернення. Пауза зупиняє нові призначення, поточні клієнти залишаються за вами.',available:'Ви приймаєте нових клієнтів.',paused:'Нових клієнтів вам не призначатимуть. Поточні клієнти залишаються за вами.',noClients:'Активних клієнтів немає.',statusNew:'Нове',statusInProgress:'У роботі',statusClosed:'Закрито',sendText:'Надішліть текстове повідомлення до 3500 символів.',closed:'Звернення закрито.',delivered:'Відповідь надіслана клієнту.',source:'Канал',customer:'Клієнт',contact:'Контакт',link:'Посилання',replyHint:'↩ Дайте відповідь на це повідомлення, щоб написати клієнту.',newApplication:'Нова заявка BEREG. PDF анкети збережено в CRM.',reassigned:'Клієнта переназначено. Останнє повідомлення: '},
    hu:{clientWrite:'💬 Írok az ügyfélszolgálatnak',servicesButton:'📋 Szolgáltatások',contactsButton:'📍 Kapcsolat',languageButton:'🌐 Nyelv',servicesTitle:'Miben segíthetünk',services:'Szóbeli és írásbeli fordítás\nBevándorlási ügyintézés\nJogi ügyintézés és kísérés',servicesPrompt:'Írja meg, milyen segítségre van szüksége és melyik városban. Munkatársunk felveszi Önnel a kapcsolatot.',contacts:'BEREG OUTSOURCE GROUP elérhetőségei\n\n☎ +36 70 743 9706\nViber · Telegram · WhatsApp\n\n✉ ugyintezesmagyarorszagon@gmail.com\n📍 1117 Budapest, Budafoki út 60.\n\nÍrjon nekünk itt, és továbbítjuk üzenetét a csapatnak.',help:'Írja meg, miben segíthetünk. Adja meg a várost, a kérést és az Önnek megfelelő időpontot. A következő szöveges üzenetét munkatársunk kapja meg. A chat jelenleg csak szöveget fogad.',hello:'BEREG OUTSOURCE GROUP\nAz Ön magyarországi ügyfélszolgálata 🇭🇺\n\nFordításban, bevándorlási ügyintézésben és személyes kísérésben segítünk.\n\nÍrja le kérését egy üzenetben, és munkatársunk itt válaszol. Válasszon az alábbi menüből, vagy a /language paranccsal módosítsa a nyelvet.',sent:'✓ Üzenetét továbbítottuk munkatársunknak. A válasz ebben a chatben érkezik.',queued:'Üzenete várólistára került. Munkatársunk hamarosan válaszol.',tooLong:'Legfeljebb 3500 karakteres szöveges üzenetet küldjön.',chooseLanguage:'Válasszon nyelvet:',languageSaved:'A nyelv magyarra van állítva.',teamClients:'👥 Ügyfeleim',online:'🟢 Elérhető',pause:'⏸ Szünet',how:'❔ Válaszadás',loginPrompt:'BEREG · Ügyfélszolgálati csapat\n\nBejelentkezéshez küldje el:\n/login saját_jelszó\n\nA CRM-ben a főadminisztrátor hozza létre a fiókját, és ő adja meg a személyes jelszavát.',attempts:'Túl sok próbálkozás. Próbálja újra 15 perc múlva.',invalidLogin:'Hibás jelszó, vagy a fiók már hozzá van rendelve.',loginSuccess:'Bejelentkezett: {name}. Válaszoláshoz használja az ügyfél üzeneténél a Válasz funkciót. Parancsok: /clients, /pause, /online, /close.',teamStart:'BEREG · Csapatmunkatér\n\nHasználja az alábbi menüt. Ügyfélnek az üzenetére válaszolva írhat. A beszélgetés lezárásához válaszként küldje el a /close parancsot. A szüneteltetés leállítja az új ügyfelek kiosztását; meglévő ügyfelei Önnél maradnak.',available:'Új ügyfeleket fogad.',paused:'Nem kap új ügyfeleket. A meglévő ügyfelei Önnél maradnak.',noClients:'Nincs aktív ügyfél.',statusNew:'Új',statusInProgress:'Folyamatban',statusClosed:'Lezárva',sendText:'Legfeljebb 3500 karakteres szöveges üzenetet küldjön.',closed:'Beszélgetés lezárva.',delivered:'Válaszát elküldtük az ügyfélnek.',source:'Forrás',customer:'Ügyfél',contact:'Kapcsolat',link:'Hivatkozás',replyHint:'↩ Az ügyfélnek az erre az üzenetre adott válasszal írhat.',newApplication:'Új BEREG jelentkezés érkezett. Az űrlap PDF-fájlja a CRM-ben van.',reassigned:'Az ügyfél új operátort kapott. Utolsó üzenet: '}
  };
  const supportedLanguages=Object.fromEntries(Object.entries(languages).map(([code,language])=>[code,language.label]));
  const tr=(language,key,values={})=>{const fallback=key==='languageSaved'&&languages[language]?`Language set to ${languages[language].name}.`:words.en[key]||key;return Object.entries(values).reduce((text,[name,value])=>text.replaceAll('{'+name+'}',String(value)),(words[language]||words.en)[key]||fallback);};
  const languagePicker=(language,bot)=>{const available=Object.values(supportedLanguages).map(text=>({text}));const keyboard=[];for(let i=0;i<available.length;i+=2)keyboard.push(available.slice(i,i+2));return {keyboard,resize_keyboard:true,one_time_keyboard:true};};
  const languageCode=text=>Object.entries(supportedLanguages).find(([,label])=>label===text)?.[0]||null;
  const clientMenuFor=language=>{const w=words[language]||words.en;return {keyboard:[[{text:w.clientWrite}],[{text:w.servicesButton},{text:w.contactsButton}],[{text:w.languageButton}]],resize_keyboard:true};};
  const teamMenuFor=language=>{const w=words[language]||words.en;return {keyboard:[[{text:w.teamClients}],[{text:w.online},{text:w.pause}],[{text:w.how}],[{text:w.languageButton}]],resize_keyboard:true};};
  const operatorFor = id => state.operators.find(o => o.enabled && o.chatId === id);
  function addOperator(name) {
    name = String(name || '').trim();
    if (!name || name.length > 60) throw new Error('Введите имя оператора до 60 символов.');
    const password = crypto.randomBytes(12).toString('base64url');
    const salt = crypto.randomBytes(16).toString('hex');
    const operator = { id: crypto.randomUUID(), name, salt, hash: crypto.scryptSync(password, salt, 32).toString('hex'), passwordVault: encryptPassword(password), enabled: true, available: false, chatId: null, language:null };
    state.operators.push(operator); save(); return { id: operator.id, name, password };
  }
  function getOperatorPassword(id) {
    const operator = state.operators.find(o => o.id === id);
    if (!operator) throw new Error('Оператор не найден.');
    if (!operator.passwordVault) throw new Error('Для старой записи пароль нельзя показать. Задайте новый пароль.');
    return decryptPassword(operator.passwordVault);
  }
  function setOperatorPassword(id, value, { keepBinding = false } = {}) {
    const operator = state.operators.find(o => o.id === id);
    if (!operator) throw new Error('Оператор не найден.');
    const password = String(value || '').trim();
    if (password.length < 10 || password.length > 100) throw new Error('Пароль должен содержать от 10 до 100 символов.');
    const oldChatId = operator.chatId;
    operator.salt = crypto.randomBytes(16).toString('hex');
    operator.hash = crypto.scryptSync(password, operator.salt, 32).toString('hex');
    operator.passwordVault = encryptPassword(password);
    if (!keepBinding) {
      operator.chatId = null;
      operator.available = false;
      if (oldChatId) for (const key of Object.keys(state.replies)) if (key.startsWith(`${oldChatId}:`)) delete state.replies[key];
    }
    save();
    return password;
  }
  function assign(client) {
    if (client.operatorId && state.operators.some(o => o.id === client.operatorId && o.enabled)) return;
    const eligible = state.operators.filter(o => o.enabled && o.available && o.chatId);
    eligible.sort((a,b) => Object.values(state.clients).filter(c => c.operatorId === a.id && c.status !== 'closed').length - Object.values(state.clients).filter(c => c.operatorId === b.id && c.status !== 'closed').length);
    client.operatorId = eligible[0]?.id || null;
  }
  async function handle(bot, update) {
    const m = update.message;
    if (!m || m.chat.type !== 'private' || m.from?.is_bot) return;
    const id = String(m.chat.id);
    const operator=bot==='operator'?operatorFor(id):null;
    let language=bot==='operator'?(operator?.language||state.languages.operator[id]||null):(state.languages.client[id]||null);
    if(m.text==='/start'||m.text?.startsWith('/start ')||m.text==='/language'||m.text==='/lang'||Object.values(words).some(w=>w.languageButton===m.text)){
      const current=language||'en';await send(bot,id,tr(current,'chooseLanguage'),{reply_markup:languagePicker(current,bot)});return;
    }
    const selectedLanguage=languageCode(m.text);
    if(selectedLanguage){
      language=selectedLanguage;state.languages[bot][id]=language;if(operator)operator.language=language;save();
      const message=bot==='client'?tr(language,'hello'):operator?tr(language,'teamStart'):tr(language,'loginPrompt');
      await send(bot,id,`${tr(language,'languageSaved')}\n\n${message}`,{reply_markup:bot==='client'?clientMenuFor(language):teamMenuFor(language)});return;
    }
    if(bot==='client'&&['/subscribe','/unsubscribe'].includes(m.text)){
      state.subscriptions||={};
      const consent=m.text==='/subscribe';
      state.subscriptions[id]={consent,at:new Date().toISOString()};
      if(!consent)state.queue=state.queue.filter(item=>!(item.campaignId&&item.clientId===id));
      save();await send(bot,id,consent?'Information updates enabled. /unsubscribe to stop.':'Information updates disabled.');return;
    }
    if(!language){await send(bot,id,tr('en','chooseLanguage'),{reply_markup:languagePicker('en',bot)});return;}
    const command={};for(const w of Object.values(words)){command[w.clientWrite]='/help';command[w.servicesButton]='/services';command[w.contactsButton]='/contacts';command[w.teamClients]='/clients';command[w.online]='/online';command[w.pause]='/pause';command[w.how]='/help';}
    const media=bot==='client'&&(m.document||m.photo?.at(-1)||m.voice||m.audio||m.video);
    const mediaName=media&&(media.file_name||(m.photo?'photo.jpg':m.voice?'voice.ogg':m.video?'video.mp4':'audio'));
    const text=media?(m.caption||mediaName):m.reply_to_message?(m.text||''):(command[m.text]||m.text||'');
    if (bot === 'client') {
      state.languages.client[id] ||= language;language=state.languages.client[id];
      if(text.startsWith('/start')){await send(bot,id,tr(language,'hello'),{reply_markup:clientMenuFor(language)});return;}
      if(text==='/services'){await send(bot,id,`${tr(language,'servicesTitle')}\n\n▫️ ${tr(language,'services').replaceAll('\n','\n▫️ ')}\n\n${tr(language,'servicesPrompt')}`,{reply_markup:clientMenuFor(language)});return;}
      if(text==='/contacts'){await send(bot,id,tr(language,'contacts'),{reply_markup:clientMenuFor(language)});return;}
      if(text==='/help'){await send(bot,id,tr(language,'help'),{reply_markup:clientMenuFor(language)});return;}
      if(!text||text.length>3500){await send(bot,id,tr(language,'tooLong'));return;}
      const client=state.clients[id]||={id,name:m.from.first_name||'Customer',provider:'telegram',contact:m.from.username?`@${m.from.username}`:`Telegram ID ${id}`,sourceUrl:m.from.username?`https://t.me/${m.from.username}`:'',status:'new',operatorId:null,language,history:[]};
      client.language=language;
      if (client.history.some(h => h.sourceId === m.message_id)) return;
      if (client.status === 'closed') client.status = 'new';
      assign(client);
      const historyItem={ direction: 'in', sourceId: m.message_id, text, sourceLanguage:null, translations:{}, at: new Date().toISOString() };
      if(media){
        const attachment=await files.receive(media,mediaName,api);
        if(attachment)historyItem.attachment=attachment;
        else historyItem.text+=' (файл превышает лимит 5 МБ)';
      }
      client.history.push(historyItem);
      state.queue.push({ bot:'operator', clientId:id, text, incomingId:m.message_id });
      if(client.history.filter(h=>h.direction==='in').length===1)autoReply?.(client,'first','',state.queue);
      autoReply?.(client,'phrase',text,state.queue);
      save();
      await send(bot,id,client.operatorId?tr(language,'sent'):tr(language,'queued'),{reply_markup:clientMenuFor(language)});
      return;
    }
    if (text.startsWith('/login ')) {
      const now = Date.now();
      const limit = attempts.get(id) || { count: 0, until: now + 900000 };
      if (limit.until < now) { limit.count = 0; limit.until = now + 900000; }
      attempts.set(id, limit);
      if (limit.count >= 5) { await send(bot,id,tr(language,'attempts')); return; }
      const password = text.slice(7).trim();
      const found = password.length <= 100 && state.operators.find(o => o.enabled && crypto.timingSafeEqual(Buffer.from(o.hash,'hex'), crypto.scryptSync(password,o.salt,32)));
      limit.count++;
      await api(bot,'deleteMessage',{ chat_id:id,message_id:m.message_id }).catch(() => {});
      if (!found || (found.chatId && found.chatId !== id) || (operatorFor(id) && operatorFor(id).id !== found.id)) { await send(bot,id,tr(language,'invalidLogin')); return; }
      found.chatId=id;found.available=true;found.language=found.language||state.languages.operator[id]||'en';state.languages.operator[id]=found.language;language=found.language;attempts.delete(id);save();
      await send(bot,id,tr(language,'loginSuccess',{name:found.name}),{reply_markup:teamMenuFor(language)}); return;
    }
    if (!operator) { await send(bot,id,tr(language,'loginPrompt')); return; }
    operator.language=language;state.languages.operator[id]=language;
    if (text === '/start' || text === '/help') { await send(bot,id,tr(language,'teamStart'),{reply_markup:teamMenuFor(language)});return; }
    if (text === '/pause' || text === '/online') { operator.available = text === '/online'; save(); await send(bot,id,operator.available ? tr(language,'available') : tr(language,'paused')); return; }
    if (text === '/clients') {
      const clients = Object.values(state.clients).filter(c => c.operatorId === operator.id && c.status !== 'closed');
      if(!clients.length){state.clientChoices[id]={};save();await send(bot,id,tr(language,'noClients'),{reply_markup:teamMenuFor(language)});return;}
      const choices={};
      const rows=clients.slice(0,40).map((client,index)=>{
        const label=`${String(client.name||tr(language,'customer')).replace(/[\r\n]/g,' ').slice(0,28)} · #${index+1}`;
        choices[label]=client.id;return [{text:label}];
      });
      state.clientChoices[id]=choices;save();
      await send(bot,id,clients.length>40?`${tr(language,'customer')}: ${clients.length} · показаны первые 40`:`${tr(language,'customer')}: ${clients.length}`,{reply_markup:{keyboard:[...rows,[{text:words[language]?.teamClients||words.en.teamClients}],[{text:words[language]?.online||words.en.online},{text:words[language]?.pause||words.en.pause}],[{text:words[language]?.languageButton||words.en.languageButton}]],resize_keyboard:true}});return;
    }
    const chosenClientId=!m.reply_to_message?state.clientChoices[id]?.[text]:null;
    if(chosenClientId){
      const client=state.clients[chosenClientId];
      if(!client||client.operatorId!==operator.id||client.status==='closed'){delete state.clientChoices[id][text];save();await send(bot,id,tr(language,'noClients'));return;}
      const latest=[...client.history].reverse().find(item=>item.direction==='in');
      if(latest&&!client.language){client.language=await detectMessageLanguage(latest.text);if(client.language)save();}
      const translated=latest?await translateMessage(latest.text,language,client.language):'—';
      const contact=client.contact?`\n${tr(language,'contact')}: ${client.contact}`:'';
      const link=client.sourceUrl?`\n${tr(language,'link')}: ${client.sourceUrl}`:'';
      const result=await send(bot,id,`${tr(language,'customer')}: ${client.name}\n${tr(language,'source')}: ${client.provider||'Telegram'}${contact}${link}\n\n${translated}\n\n${tr(language,'replyHint')}`,{reply_markup:teamMenuFor(language)});
      state.replies[`${id}:${result.message_id}`]=client.id;save();return;
    }
    const clientId = state.replies[`${id}:${m.reply_to_message?.message_id}`];
    const client = state.clients[clientId];
    if (!client || client.operatorId !== operator.id) { await send(bot,id,tr(language,'replyHint')); return; }
    if (text === '/close') { client.status = 'closed'; save(); await send(bot,id,tr(language,'closed')); return; }
    if (!text || text.length > 3500) { await send(bot,id,tr(language,'sendText')); return; }
    client.status = 'in_progress';
    client.history.push({ direction:'out', text, operatorId:operator.id, at:new Date().toISOString() });
    state.queue.push({ bot:client.transport==='chatwoot'||client.provider&&client.provider!=='telegram'?'external':'client',clientId,text,operatorChatId:id,sourceLanguage:language }); save();
  }
  function ingestExternal({provider,attachments=[],attachment,transport,externalId,name,contact,sourceUrl,text,sourceId,demo=false,language}) {
    if(!(transport==='chatwoot'?['facebook','whatsapp','instagram','email','viber','chatwoot','telegram']:transport==='viber'?['viber']:['facebook','whatsapp']).includes(provider))throw new Error('Неизвестный канал обращения.');
    const legacyId=`ext:${provider}:${externalId}`;
    const id=state.clients[legacyId]?.transport===transport||(!state.clients[legacyId]&&transport!=='chatwoot')?legacyId:
      transport==='chatwoot'?`cw:${provider}:${externalId}`:legacyId;
    const client=state.clients[id]||={id,externalId:String(externalId),provider,transport:transport||'meta',name:name||`Клиент ${provider}`,contact:contact||'',sourceUrl:sourceUrl||'',status:'new',operatorId:null,language:language||null,history:[]};
    client.name=name||client.name;client.contact=contact||client.contact;client.sourceUrl=sourceUrl||client.sourceUrl;client.externalId=String(externalId);client.transport=transport||client.transport||'meta';client.language=language||client.language||null;client.demo=Boolean(demo);
    if(client.history.some(item=>item.sourceId===sourceId&&sourceId))return client;
    if(client.status==='closed')client.status='new';assign(client);
    client.history.push({direction:'in',sourceId,attachments,attachment:attachment || undefined,text:String(text).slice(0,3500),translations:{},at:new Date().toISOString(),provider});
    state.queue.push({bot:'operator',clientId:id,text:String(text).slice(0,3500),incomingId:sourceId});
    if(client.history.filter(h=>h.direction==='in').length===1)autoReply?.(client,'first','',state.queue);
    autoReply?.(client,'phrase',text,state.queue);save();
    flush().catch(()=>{});return client;
  }
  function setClientLanguage(provider,externalId,language){
    if(!['facebook','whatsapp'].includes(provider)||!languageCodes.includes(language))return;
    const client=state.clients[`ext:${provider}:${externalId}`];if(!client)return;
    client.language=language;save();
  }
  function overdueReplies(now = Date.now()) {
    const minutes = Number(process.env.BEREG_REPLY_MINUTES || 60);
    const threshold = (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60000;
    const overdue = [];
    for (const client of Object.values(state.clients)) {
      if (client.demo || client.status === 'closed') continue;
      let waiting;
      for (const message of client.history) {
        if (message.direction === 'in') waiting ||= message.at;
        else if (message.direction === 'out' && !message.eventId && !message.campaignId) waiting = null;
      }
      if (waiting && now - Date.parse(waiting) >= threshold) {
        overdue.push({id:client.id, name:client.name, since:waiting});
      }
    }
    return overdue;
  }

  function enqueueStaffNotice(id, chatId, text) {
    state.staffEvents ||= {};
    if (state.staffEvents[id]) return;
    state.staffEvents[id] = true;
    state.queue.push({bot:'staff-notice', chatId, text});
    try { save(); }
    catch (error) {
      state.queue.pop();
      delete state.staffEvents[id];
      throw error;
    }
  }

  async function flush() {
    if(flushing){flushAgain=true;return;}
    flushing=true;
    try{do{flushAgain=false;for (const item of [...state.queue]) {
      if(item.campaignId&&!state.subscriptions?.[item.clientId]?.consent){
        state.queue.splice(state.queue.indexOf(item),1);save();continue;
      }
      if (item.retryAt > Date.now()) continue;
      if (item.bot === 'staff-notice') {
        try {
          await send('operator', item.chatId, item.text);
          state.queue.splice(state.queue.indexOf(item), 1);
        } catch {
          item.retryAt = Date.now() + 60000;
        }
        save();
        continue;
      }
      const client = state.clients[item.clientId];
      assign(client); save();
      const operator = state.operators.find(o => o.id === client.operatorId && o.enabled);
      if (item.bot === 'operator' && !operator?.chatId) continue;
      try {
        if(item.testId){
          const record=client.history.find(h=>h.testId===item.testId);
          if(!record)throw Error('Тестовое сообщение отсутствует.');
          if(item.bot==='external')await externalSender(client,item.text);
          else await send('client',client.id,item.text);
          record.delivery='accepted';state.queue.splice(state.queue.indexOf(item),1);save();continue;
        }
        if(item.attachment){
          if(client.transport==='chatwoot'||['facebook','whatsapp'].includes(client.provider))await externalFileSender(client,item.attachment,files.bytes(item.attachment.id));
          else await files.send(client.id,item.attachment);
          state.queue.splice(state.queue.indexOf(item),1);save();continue;
        }
        if(!client.language){const latestInbound=[...client.history].reverse().find(message=>message.direction==='in');client.language=await detectMessageLanguage(latestInbound?.text||item.text);if(client.language)save();}
        if (item.bot === 'operator') {
          const source={telegram:'Telegram',facebook:'Facebook',whatsapp:'WhatsApp'}[client.provider||'telegram']||client.provider;
          const language=operator.language||'en';
          const contact=client.contact?`\n${tr(language,'contact')}: ${client.contact}`:'';
          const link=client.sourceUrl?`\n${tr(language,'link')}: ${client.sourceUrl}`:'';
          const incoming=client.history.find(message=>message.direction==='in'&&message.sourceId===item.incomingId);
          const detectedLanguage=await detectMessageLanguage(item.text);
          const sourceLanguage=detectedLanguage||incoming?.sourceLanguage||client.language||'en';
          if(incoming){incoming.sourceLanguage=sourceLanguage;incoming.sourceLanguageDetected=Boolean(detectedLanguage)||Boolean(incoming.sourceLanguageDetected);save();}
          let translated;
          if(incoming){incoming.translations||={};translated=incoming.translations[language];if(!translated||(sourceLanguage!==language&&translated===item.text)){translated=await translateMessage(item.text,language,sourceLanguage);incoming.translations[language]=translated;save();}}
          else translated=await translateMessage(item.text,language,sourceLanguage);
          const result = await send('operator',operator.chatId,`${tr(language,'source')}: ${source}\n${tr(language,'customer')}: ${client.name}${contact}${link}\n\n${translated}\n\n${tr(language,'replyHint')}`);
          state.replies[`${operator.chatId}:${result.message_id}`] = client.id;
        } else if(item.bot==='external'){
          if(client.demo)throw new Error('Это тестовое обращение: внешний ответ не отправляется.');
          if(typeof externalSender!=='function')throw new Error('Внешний канал не подключён.');
          // Translate the actual text the employee wrote. The employee's UI
          // language selects the incoming-message target, but an operator may
          // write a reply in another language (for example Russian to a Hungarian client).
          // The operator's selected UI language is not necessarily the
          // language they typed. Detect the reply text; let the translator
          // auto-detect when the text is too short or ambiguous.
          const sourceLanguage=await detectMessageLanguage(item.text);
          const translated=await translateMessage(item.text,client.language||'en',sourceLanguage);
          const outgoing=[...client.history].reverse().find(message=>message.direction==='out'&&message.text===item.text&&(!message.translations?.[client.language||'en']||(sourceLanguage!==(client.language||'en')&&message.translations?.[client.language||'en']===item.text)));
          if(outgoing){outgoing.translations||={};outgoing.translations[client.language||'en']=translated;save();}
          await externalSender(client,translated);
        } else {
          // Never use the employee's locale as the source language of a
          // reply. The customer-selected locale remains the target.
          const sourceLanguage=await detectMessageLanguage(item.text);
          const translated=await translateMessage(item.text,client.language||'en',sourceLanguage);
          const outgoing=[...client.history].reverse().find(message=>message.direction==='out'&&message.text===item.text&&(!message.translations?.[client.language||'en']||(sourceLanguage!==(client.language||'en')&&message.translations?.[client.language||'en']===item.text)));
          if(outgoing){outgoing.translations||={};outgoing.translations[client.language||'en']=translated;save();}
          await send('client',client.id,translated);
        }
        state.queue.splice(state.queue.indexOf(item),1); save();
        if (item.operatorChatId) { const sender=operatorFor(item.operatorChatId);await send('operator',item.operatorChatId,tr(sender?.language||'en','delivered')).catch(() => {}); }
      } catch (error) {
        if(item.testId){
          const record=client.history.find(h=>h.testId===item.testId);
          if(record)record.delivery='unconfirmed';
          state.queue.splice(state.queue.indexOf(item),1);save();continue;
        }
        item.retryAt = Date.now()+60000; item.error = error.message; save(); status.error = error.message; }
    }}while(flushAgain);}finally{flushing=false;}
  }
  async function cycle() {
    for (const bot of ['client','operator']) {
      const updates = await api(bot,'getUpdates',{ offset:state.offsets[bot], timeout:0, limit:20, allowed_updates:['message'] });
      for (const update of updates) {
        if (update.update_id < state.offsets[bot]) continue;
        await handle(bot,update); state.offsets[bot] = update.update_id+1; save();
      }
    }
    status.error = null;
    await flush();
  }
  async function configureWebhooks(baseUrl) {
    const origin = new URL(baseUrl).origin;
    if (!webhookSecret) throw new Error('Telegram webhook secret is not configured.');
    for (const bot of ['client', 'operator']) {
      if (!tokens[bot]) throw new Error(`Telegram ${bot} bot token is not configured.`);
      await api(bot, 'setWebhook', {
        url: `${origin}/webhooks/telegram/${bot}`,
        secret_token: webhookSecret,
        allowed_updates: ['message'],
        drop_pending_updates: false
      });
    }
    status.webhooksConfigured = true;
    status.webhookBaseUrl = origin;
    return { ok: true, webhookBaseUrl: origin };
  }
  async function handleWebhook(bot, update) {
    if (!['client', 'operator'].includes(bot) || !tokens[bot]) throw new Error('Unknown Telegram bot.');
    const updateId = Number(update?.update_id);
    if (!Number.isSafeInteger(updateId)) throw new Error('Invalid Telegram update.');
    const processed = state.webhookUpdates[bot] || (state.webhookUpdates[bot] = []);
    if (processed.includes(updateId)) return { duplicate: true };
    await handle(bot, update);
    processed.push(updateId);
    state.webhookUpdates[bot] = processed.slice(-1000);
    save();
    await flush();
    return { ok: true };
  }
  async function diagnostics() {
    const result = {};
    for (const bot of ['client', 'operator']) {
      if (!tokens[bot]) { result[bot] = { configured: false }; continue; }
      const [me, webhook, commands] = await Promise.allSettled([
        api(bot, 'getMe', {}), api(bot, 'getWebhookInfo', {}), api(bot, 'getMyCommands', {})
      ]);
      result[bot] = {
        configured: true,
        identity: me.status === 'fulfilled' ? { username: me.value.username, firstName: me.value.first_name } : null,
        identityError: me.status === 'rejected' ? me.reason.message : null,
        webhook: webhook.status === 'fulfilled' ? {
          url: webhook.value.url || '', pendingUpdates: webhook.value.pending_update_count || 0,
          lastError: webhook.value.last_error_message || null,
          lastErrorAt: webhook.value.last_error_date || null,
          allowedUpdates: webhook.value.allowed_updates || []
        } : null,
        webhookError: webhook.status === 'rejected' ? webhook.reason.message : null,
        commands: commands.status === 'fulfilled' ? commands.value : [],
        commandsError: commands.status === 'rejected' ? commands.reason.message : null
      };
    }
    return result;
  }
  async function start() {
    if (!status.configured || status.running) return;
    status.running = true;
    if (workerMode) {
      if (webhookBaseUrl) {
        try { await configureWebhooks(webhookBaseUrl); }
        catch (error) { status.error = error.message; console.error('Telegram webhook setup:', error.message); }
      }
      return;
    }
    while (status.running) {
      try { await cycle(); } catch (error) { status.error = error.message; }
      await new Promise(resolve => setTimeout(resolve,3000));
    }
  }
  function snapshot() {
    return { ...status, botUsernames: {client:process.env.TELEGRAM_CLIENT_BOT_USERNAME || '',operator:process.env.TELEGRAM_OPERATOR_BOT_USERNAME || ''}, queued:state.queue.length, operators:state.operators.map(({hash,salt,passwordVault,...o}) => ({...o,clients:Object.values(state.clients).filter(c => c.operatorId === o.id && c.status !== 'closed').length})) };
  }
  function disable(id) {
    const o = state.operators.find(o => o.id === id); if (!o) throw new Error('Оператор не найден');
    o.enabled = false; o.available = false;
    for (const c of Object.values(state.clients)) if (c.operatorId === id) {
      c.operatorId = null;
      if(c.status !== 'closed') state.queue.push({bot:'operator',clientId:c.id,text:tr(o.language||'en','reassigned')+(c.history.filter(h=>h.direction==='in').at(-1)?.text||'—')});
    }
    save();
  }
  async function sendApplicationDocument(chatId, filePath, caption, botUrl) {
    if (!tokens.operator || !/^\d{5,24}$/.test(String(chatId))) throw new Error('Telegram destination unavailable');
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', caption);
    if (tokens.client) {
      const botInfo = await api('client', 'getMe', {});
      const username = botInfo.username;
      if (username) botUrl = `https://t.me/${username}`;
    }
    if (botUrl) form.set('reply_markup', JSON.stringify({inline_keyboard:[[ {text:'Contact',url:botUrl} ]]}));
    form.set('document', new Blob([fs.readFileSync(filePath)], {type:'application/pdf'}), 'bereg-anketa.pdf');
    const response = await fetch(`https://api.telegram.org/bot${tokens.operator}/sendDocument`, {method:'POST',body:form,signal:AbortSignal.timeout(20000)});
    const result = await response.json();
    if (!result.ok) throw new Error(`Telegram sendDocument failed: ${result.error_code}`);
    return result.result.message_id;
  }
  async function prepareHistory(client,language){
    if(!client||!Array.isArray(client.history))return client;
    if(!client.language){const firstIncoming=client.history.find(item=>item.direction==='in');if(firstIncoming){client.language=await detectMessageLanguage(firstIncoming.text);if(client.language)save();}}
    const incoming=client.history.filter(item=>item.direction==='in');
    await Promise.all(incoming.map(async item=>{if(item.sourceLanguageDetected)return;const detected=await detectMessageLanguage(item.text);if(detected){item.sourceLanguage=detected;item.sourceLanguageDetected=true;}else item.sourceLanguage||=client.language||null;}));
    const pending=incoming.filter(item=>item.sourceLanguage||client.language).filter(item=>{item.translations||={};return !item.translations[language]||(item.sourceLanguage&&item.sourceLanguage!==language&&item.translations[language]===item.text);});
    for(let index=0;index<pending.length;index+=4){await Promise.all(pending.slice(index,index+4).map(async item=>{item.translations[language]=await translateMessage(item.text,language,item.sourceLanguage||client.language);}));save();}
    return {...client,history:client.history.map(item=>({...item,originalText:item.text,text:item.direction==='in'?(item.translations?.[language]||item.text):item.text}))};
  }
  return { files, start, snapshot, diagnostics, addOperator, getOperatorPassword, setOperatorPassword, disable, handle, handleWebhook, configureWebhooks, flush, ingestExternal, setClientLanguage, sendApplicationDocument, enqueueStaffNotice, overdueReplies, prepareHistory, state, save, translate:tr };
}
function mountSupport(app, options) {
  const support = createSupport(options);
  if (options.workerMode) {
    const jsonParser = require('express').json({ limit: '1mb' });
    app.post('/webhooks/telegram/:bot', jsonParser, async (req, res) => {
      const bot = String(req.params.bot || '');
      if (!options.webhookSecret || req.get('X-Telegram-Bot-Api-Secret-Token') !== options.webhookSecret) return res.sendStatus(401);
      try { await support.handleWebhook(bot, req.body); res.sendStatus(200); }
      catch (error) { res.status(500).json({ error: error.message }); }
    });
    app.post('/api/telegram/webhooks/setup', (req, res) => {
      if (!req.panelAuthenticated || req.panelUser.role !== 'superadmin') return res.sendStatus(403);
      const baseUrl = String(req.body.baseUrl || options.webhookBaseUrl || '').trim();
      support.configureWebhooks(baseUrl).then(result => res.json(result)).catch(error => res.status(502).json({ error: error.message }));
    });
  }
  app.use('/api/telegram', (req,res,next) => {
    if (!req.panelAuthenticated) return res.status(401).json({error:'Войдите в панель.'});
    next();
  });
  const canSee=(req,c)=>req.panelUser.role!=='operator' || (req.panelUser.operatorId && c.operatorId===req.panelUser.operatorId);
  app.get('/api/telegram/notifications',(req,res)=>{
    const requestedCursor=Number(req.query.since);
    const hasCursor=Number.isFinite(requestedCursor)&&requestedCursor>=0;
    const cursor=Date.now();
    const messages=[];
    if(hasCursor)for(const client of Object.values(support.state.clients)){
      if(!canSee(req,client))continue;
      for(const message of client.history||[]){
        if(message.direction!=='in')continue;
        const at=Date.parse(message.at||'');
        if(!Number.isFinite(at)||at<requestedCursor)continue;
        messages.push({client:{id:client.id,name:client.name,provider:client.provider||'telegram'},message:{sourceId:message.sourceId||null,text:message.text,at:message.at}});
      }
    }
    messages.sort((a,b)=>Date.parse(a.message.at)-Date.parse(b.message.at));
    const overdue = req.panelUser.role === 'operator' ? [] : support.overdueReplies(cursor);
    res.json({cursor,messages,overdue});
  });
  app.get('/api/telegram/inbox',(req,res)=>{
    const clients=Object.values(support.state.clients).filter(c=>canSee(req,c)).map(client=>{
      const operator=support.state.operators.find(o=>o.id===client.operatorId);
      const latest=client.history?.at(-1);
      return {...client,history:latest?[latest]:[],operatorName:operator?.name||'Ожидает назначения'};
    });
    res.json({clients});
  });
  app.get('/api/telegram/inbox/:id',async(req,res)=>{
    try{
      const client=support.state.clients[req.params.id];
      if(!client||!canSee(req,client))return res.status(404).json({error:'Обращение не найдено.'});
      const operator=support.state.operators.find(o=>o.id===client.operatorId);
      const requestedLanguage=String(req.query.language||'');
      const language=languageCodes.includes(requestedLanguage)?requestedLanguage:operator?.language||'en';
      res.json({client:{...await support.prepareHistory(client,language),operatorName:operator?.name||'Ожидает назначения'}});
    }catch(error){res.status(502).json({error:`Не удалось перевести сообщения: ${error.message}`});}
  });
  app.get('/api/telegram/inbox/:id/files/:fileId',(req,res)=>{
    const c=support.state.clients[req.params.id];
    const file=c&&canSee(req,c)&&c.history.find(h=>h.attachment?.id===req.params.fileId)?.attachment;
    if(!file)return res.sendStatus(404);
    res.set('Cache-Control','private, no-store');res.attachment(file.name).type('application/octet-stream').send(support.files.bytes(file.id));
  });
  app.post('/api/telegram/inbox/:id/files',(req,res)=>{
    const c=support.state.clients[req.params.id];
    if(!c||!canSee(req,c))return res.sendStatus(404);
    if(c.demo||(c.transport!=='chatwoot'&&c.provider&&!['telegram','facebook','whatsapp'].includes(c.provider)))return res.status(400).json({error:'Канал не подключён для отправки файлов.'});
    const {base64,name}=req.body;
    if(typeof base64!=='string'||base64.length>6990508||typeof name!=='string'||!name.trim())return res.status(400).json({error:'Проверьте файл (до 5 МБ).'});
    if(c.transport !== 'chatwoot' && ['facebook','whatsapp'].includes(c.provider) && !options.externalFileAllowed?.(c,name)) {
      return res.status(400).json({error:'Канал не підключено або формат файлу не підтримується.'});
    }
    const bytes=Buffer.from(base64,'base64');
    if(!bytes.length||bytes.length>5242880||bytes.toString('base64')!==base64)return res.status(400).json({error:'Некорректный файл.'});
    const attachment=support.files.persist(bytes,name);
    c.history.push({direction:'out',text:attachment.name,attachment,at:new Date().toISOString(),panelUserId:req.panelUser.id});
    support.state.queue.push({bot:'client',clientId:c.id,attachment,text:attachment.name});support.save();support.flush().catch(()=>{});
    res.status(202).json({ok:true});
  });
  app.get('/api/telegram/inbox-team',(req,res)=>res.json({operators:support.state.operators.filter(o=>o.enabled).map(o=>({id:o.id,name:o.name}))}));
  app.post('/api/telegram/inbox/:id/manage',(req,res)=>{
    const client=support.state.clients[req.params.id];
    if(!client||!canSee(req,client))return res.sendStatus(404);
    const {note,operatorId}=req.body;
    if(typeof note==='string'&&note.trim()&&note.length<=2000){
      client.notes||=[];client.notes.push({text:note.trim(),by:req.panelUser.name,at:new Date().toISOString()});
    }else if(operatorId&&support.state.operators.some(o=>o.enabled&&o.id===operatorId)){
      client.operatorId=operatorId;
    }else return res.status(400).json({error:'Проверьте сотрудника или текст комментария.'});
    support.save();res.json({ok:true});
  });
  function testTarget(req,res){
    const client=support.state.clients[req.params.id];
    if(!client||!canSee(req,client)){res.sendStatus(404);return null;}
    if(client.demo){res.status(400).json({error:'У этого примера нет адреса в канале. Выберите диалог тестового клиента.'});return null;}
    return client;
  }
  app.post('/api/telegram/inbox/:id/test-send',(req,res)=>{
    const client=testTarget(req,res);if(!client)return;
    const {id,text}=req.body;
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||typeof text!=='string'||!text.trim()||text.length>1000)
      return res.status(400).json({error:'Проверьте тестовое сообщение.'});
    let record=client.history.find(h=>h.testId===id);
    if(!record){
      const body='[BEREG · Тест] '+text.trim();
      record={direction:'out',text:body,testId:id,delivery:'queued',panelUserId:req.panelUser.id,at:new Date().toISOString()};
      client.history.push(record);
      support.state.queue.push({testId:id,bot:client.transport==='chatwoot'||client.provider&&client.provider!=='telegram'?'external':'client',clientId:client.id,text:body});
      support.save();support.flush().catch(()=>{});
    }
    res.json({delivery:record.delivery});
  });
  app.get('/api/telegram/inbox/:id/test-send/:operation',(req,res)=>{
    const client=testTarget(req,res);if(!client)return;
    const record=client.history.find(h=>h.testId===req.params.operation);
    if(!record)return res.sendStatus(404);
    res.json({delivery:record.delivery});
  });
  app.post('/api/telegram/inbox/:id/reply',(req,res)=>{
    const c=support.state.clients[req.params.id];if(!c||!canSee(req,c))return res.status(404).json({error:'Обращение не найдено.'});
    if(req.panelUser.role==='operator'&&!support.state.operators.some(o=>o.id===req.panelUser.operatorId&&o.enabled))return res.status(403).json({error:'Доступ оператора отключён.'});
    const text=String(req.body.text||'').trim();if(!text||text.length>3500)return res.status(400).json({error:'Введите сообщение до 3500 символов.'});
    const requestedLanguage=String(req.body.sourceLanguage||'');
    const language=languageCodes.includes(requestedLanguage)?requestedLanguage:support.state.operators.find(item=>item.id===c.operatorId)?.language||'en';
    c.status='in_progress';c.history.push({direction:'out',text,operatorId:req.panelUser.operatorId,panelUserId:req.panelUser.id,at:new Date().toISOString()});
    support.state.queue.push({bot:c.transport==='chatwoot'||c.provider&&c.provider!=='telegram'?'external':'client',clientId:c.id,text,sourceLanguage:language});support.save();
    support.flush().catch(()=>{});res.json({ok:true,message:'Ответ поставлен в очередь отправки.'});
  });
  app.post('/api/telegram/inbox/:id/close',(req,res)=>{const c=support.state.clients[req.params.id];if(!c||!canSee(req,c))return res.status(404).json({error:'Обращение не найдено.'});c.status='closed';support.save();res.json({ok:true});});
  app.get('/api/telegram/status', (req,res)=>res.json(support.snapshot()));
  app.put('/api/telegram/operator-language',(req,res)=>{const language=String(req.body.language||'');if(!languageCodes.includes(language))return res.status(400).json({error:'Неподдерживаемый язык.'});const operator=support.state.operators.find(o=>o.id===req.panelUser.operatorId&&o.enabled&&o.chatId);if(req.panelUser.role!=='operator'||!operator)return res.status(403).json({error:'Язык Telegram можно связать только для учётной записи оператора.'});operator.language=language;support.state.languages.operator[operator.chatId]=language;support.save();res.json({ok:true,language});});
  app.get('/api/telegram/diagnostics', async (req,res)=>{
    if(req.panelUser.role!=='superadmin')return res.sendStatus(403);
    try{res.json(await support.diagnostics());}catch(error){res.status(502).json({error:error.message});}
  });
  const superadminOnly = (req,res,next) => req.panelUser.role === 'superadmin' ? next() : res.status(403).json({error:'Пароли Telegram-операторов доступны только суперадминистратору.'});
  app.post('/api/telegram/operators', superadminOnly, (req,res)=> { try { res.json(support.addOperator(req.body.name)); } catch(e) { res.status(400).json({error:e.message}); } });
  app.get('/api/telegram/operators/:id/password', superadminOnly, (req,res)=> {
    try { res.json({password:support.getOperatorPassword(req.params.id)}); } catch(e) { res.status(400).json({error:e.message}); }
  });
  app.put('/api/telegram/operators/:id/password', superadminOnly, (req,res)=> {
    try { res.json({ok:true,password:support.setOperatorPassword(req.params.id,req.body.password)}); } catch(e) { res.status(400).json({error:e.message}); }
  });
  app.delete('/api/telegram/operators/:id', (req,res)=> { try { support.disable(req.params.id); res.json({ok:true}); } catch(e) {res.status(400).json({error:e.message});} });
  support.start(); return support;
}
module.exports = { createSupport, mountSupport };
