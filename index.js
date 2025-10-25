import dotenv from 'dotenv';
import fs from 'fs';
import { Telegraf, Markup } from 'telegraf';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
        temperature: 0.95,
        maxOutputTokens: 2048,
        topP: 0.9,
        topK: 40
    }
});

const ALLOWED_USERNAMES_STRING = process.env.ALLOWED_USERNAMES || '';
const ALLOWED_USERNAMES = ALLOWED_USERNAMES_STRING.split(',').map(name => name.trim().toLowerCase()).filter(name => name.length > 0);

const USED_TOPICS_FILE = './used_topics.json';
let usedTopics = loadUsedTopics();

const MODE_CONFIG = {
    blog: {
        topicsPrompt: (num) => `Придумай ${num} коротких, креативних ідей українською для телеграм-блогу про роботу розробника, життя у сфері IT, VUE, JS, верстку, TS, мотивацію, технології, AI або Node.js. Кожна ідея: до 50 символів, почни з емодзі, без лапок. Формат: 1) емодзі + назва ...`,
        postPrompt: (text) => `Створи великий телеграм-пост українською (1500 символів) у стилі сучасного IT-блогу. Тема: "${text}"`,
        topicMessage: '🌀 Генерую унікальних ідей для блогу...',
        selectMessage: 'Обери тему для блогу:',
        regenerateText: '🔄 Перегенерувати теми',
        generatingPostMessage: '✍️ Генерую повний блог-пост...',
        postStartMessage: (text) => `✨ **Ідея для блогу:**\n\n${text}`
    },
    blog_figma: {
        topicsPrompt: (num) => `Придумай ${num} коротких, креативних ідей українською для телеграм-блогу про UI/UX дизайн, Figma, дизайн-системи, кар'єру дизайнера, тренди та інструменти. Кожна ідея: до 50 символів, почни з емодзі, без лапок. Формат: 1) емодзі + назва ...`,
        postPrompt: (text) => `Створи великий телеграм-пост українською (1500 символів) у стилі сучасного UI/UX блогу. Тема: "${text}"`,
        topicMessage: '🎨 Генерую унікальних ідей для дизайн-блогу...',
        selectMessage: 'Обери тему для дизайн-блогу:',
        regenerateText: '🔄 Перегенерувати теми',
        generatingPostMessage: '✍️ Генерую повний дизайн-пост...',
        postStartMessage: (text) => `✨ **Ідея для дизайн-блогу:**\n\n${text}`
    },
    task: {
        topicsPrompt: (num) => `Створи ${num} коротких назв (до 50 символів, з емодзі, без лапок) для практичних задач з JavaScript (масиви, логіка, дати). Формат нумерований: 1) емодзі + назва ...`,
        postPrompt: (text) => `Створи коротку практичну задачу з JavaScript українською. Тема: "${text}". Формат: 🧩 Задача: опис, 📦 Приклад: код JS, 🔍 Уточнення: умови. До 1000 символів.`,
        topicMessage: '⚙️ Генерую унікальних JS-задач...',
        selectMessage: 'Обери задачу:',
        regenerateText: '🔄 Перегенерувати задачі',
        generatingPostMessage: '🔧 Генерую деталі задачі...',
        postStartMessage: (text) => `🎯 **Вибрана задача:** ${text}`
    },
    quiz: {
        topicsPrompt: (num) => `Створи ${num} коротких назв (до 50 символів, з емодзі, без лапок) для вікторин з фронтенду (HTML, CSS, JavaScript або Vue.js). Формат нумерований: 1) емодзі + назва ...`,
        topicMessage: '🔄 Генерую унікальних тем для вікторин...',
        selectMessage: 'Обери тему вікторини:',
        regenerateText: '🔄 Перегенерувати вікторини',
        placeholders: [
            '❓ JavaScript Замикання', '❓ CSS Grid vs Flexbox', '❓ Проміси та Async/Await',
            '❓ Що таке Virtual DOM', '❓ Область видимості в JS'
        ]
    },
    quiz_figma: {
        topicsPrompt: (num) => `Створи ${num} коротких назв (до 50 символів, з емодзі, без лапок) для вікторин з UI/UX дизайну, Figma, типографіки або дизайн-систем. Формат нумерований: 1) емодзі + назва ...`,
        topicMessage: '📐 Генерую унікальних тем для дизайн-вікторин...',
        selectMessage: 'Обери тему дизайн-вікторини:',
        regenerateText: '🔄 Перегенерувати вікторини',
        placeholders: [
            '❓ Кольорова модель CMYK', '❓ Принципи Гештальту', '❓ Автолейаут у Figma',
            '❓ Х-висота шрифту', '❓ Прототипування в UI/UX'
        ]
    },
    quote: {
        topicsPrompt: (num) => `Придумай ${num} коротких, дотепних цитат українською про життя або філософію розробника/айтішника. Кожна цитата: до 100 символів, без лапок, почни з емодзі. Формат: 1) емодзі + цитата ...`,
        topicMessage: '😎 Генерую цитат розробника...',
        selectMessage: 'Обери цитату:',
        regenerateText: '🔄 Перегенерувати цитати',
        postStartMessage: (text) => `💬 **Вибрана цитата розробника:**\n\n${cleanPostText(text)}`,
        skipPostGeneration: true
    },
    story: {
        topicsPrompt: (num) => `Придумай ${num} коротких, дуже клікбейтних, шокуючих ідей українською для телеграм-історій про IT, програмування, гроші, невдачі, кар'єру, фріланс. Кожна ідея: до 70 символів, почни з емодзі (🤯, 💰, 🚨, 😱, 😈), без лапок. Формат: 1) емодзі + назва ...`,
        topicMessage: '📖 Генерую клікбейтних ідей для історій...',
        selectMessage: 'Обери тему для клікбейт історії:',
        regenerateText: '🔄 Перегенерувати теми'
    }
};

const activeGenerations = new Map();
const userTopics = new Map();
const userCurrentMode = new Map();

function loadUsedTopics() {
    if (fs.existsSync(USED_TOPICS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(USED_TOPICS_FILE, 'utf-8'));
        } catch {
            return [];
        }
    }
    return [];
}

function saveUsedTopic(topic) {
    usedTopics.push(topic);
    if (usedTopics.length > 500) {
        usedTopics = usedTopics.slice(-500);
    }
    fs.writeFileSync(USED_TOPICS_FILE, JSON.stringify(usedTopics, null, 2));
}

function getText(result) {
    return (
        result?.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
        result?.response?.text?.trim() ||
        ''
    );
}

function similarityRatio(a, b) {
    a = a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    b = b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (!a.length || !b.length) return 0;
    let same = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] === b[i]) same++;
    }
    return same / Math.max(a.length, b.length);
}

function isDuplicateIdea(newText) {
    return usedTopics.some(oldText => similarityRatio(oldText, newText) > 0.8);
}

function cleanPostText(text) {
    return text.replace(/[*_`<>]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function checkAccess(ctx) {
    if (ALLOWED_USERNAMES.length === 0) return true;
    const userUsername = ctx.from?.username?.toLowerCase();

    if (userUsername && ALLOWED_USERNAMES.includes(userUsername)) {
        return true;
    }
    ctx.reply('❌ Зайнятий. Іди нахуй.', getMainKeyboard());
    return false;
}

function getMainKeyboard() {
    return Markup.keyboard([
        ['🤖 FrontEnd - JavaScript | TypeScript', '🎨 FrontEnd UI - Figma макети']
    ]).resize();
}

function getSubMenuKeyboard() {
    return Markup.keyboard([
        ['🧠 Згенерувати блог', '🧩 Згенерувати опитування'],
        ['🎭 Згенерувати цитату', '🧮 Зробити задачу'],
        ['📖 Згенерувати історію'],
        ['⬅️ Головне меню']
    ]).resize();
}

function getFigmaSubMenuKeyboard() {
    return Markup.keyboard([
        ['🧠 Згенерувати блог (Figma)', '🧩 Згенерувати опитування (Figma)'],
        ['⬅️ Головне меню']
    ]).resize();
}

function getTopicsKeyboard(topics, regenerateText, backText = '⬅️ Назад в меню') {
    const keyboard = [];
    for (let i = 0; i < topics.length; i += 2) {
        keyboard.push(topics.slice(i, i + 2));
    }
    keyboard.push([regenerateText]);
    keyboard.push([backText]);
    return Markup.keyboard(keyboard).resize();
}

function protectedGeneration(ctx, type, generator) {
    const chatId = ctx.chat.id;
    if (activeGenerations.has(chatId)) {
        ctx.reply('⏳ **УВАГА!** Попередня генерація ще не завершена. Зачекай ✋', { parse_mode: 'Markdown' });
        return;
    }

    activeGenerations.set(chatId, { type, startTime: Date.now() });
    (async () => {
        try {
            await generator(ctx);
        } catch (error) {
            console.error(`❌ Generation error (${type}):`, error);
            ctx.reply('⚠️ Критична помилка. Спробуй ще раз.');
        } finally {
            activeGenerations.delete(chatId);
        }
    })();
}

async function generateTopics(ctx, mode) {
    const chatId = ctx.chat.id;
    const config = MODE_CONFIG[mode];
    const numTopics = (mode === 'quote') ? 10 : 5;

    await ctx.reply(config.topicMessage.replace('унікальних', `${numTopics} унікальних`));

    const prompt = config.topicsPrompt(numTopics);
    const result = await model.generateContent([prompt]);
    const text = getText(result);

    const lines = text.split('\n').filter(l => l.trim());
    const newTopics = [];

    for (const line of lines) {
        const match = line.match(/^\d+\)\s*(.+)$/);
        if (match && newTopics.length < numTopics) {
            const idea = match[1].trim();
            if (!isDuplicateIdea(idea)) {
                newTopics.push(idea);
            }
        }
    }

    if ((mode === 'quiz' || mode === 'quiz_figma') && newTopics.length < numTopics && config.placeholders) {
        while (newTopics.length < numTopics && config.placeholders.length > 0) {
            newTopics.push(config.placeholders.shift());
        }
    }

    if (newTopics.length === 0) {
        const backKeyboard = (mode === 'blog_figma' || mode === 'quiz_figma') ? getFigmaSubMenuKeyboard() : getSubMenuKeyboard();
        await ctx.reply(`⚠️ Не вдалося знайти нових тем для ${mode} 😅`, backKeyboard);
        return;
    }

    userTopics.set(chatId, { mode, topics: newTopics });
    userCurrentMode.set(chatId, mode);

    await ctx.reply(config.selectMessage, getTopicsKeyboard(newTopics, config.regenerateText));
}

async function generateContentPost(ctx, mode, text) {
    const chatId = ctx.chat.id;
    const config = MODE_CONFIG[mode];

    await ctx.reply(config.postStartMessage(text), { parse_mode: 'Markdown' });

    if (config.skipPostGeneration) {
        saveUsedTopic(text);
        userTopics.delete(chatId);
        const newMode = mode === 'blog_figma' ? 'sub_menu_figma' : 'sub_menu_js';
        const backKeyboard = mode === 'blog_figma' ? getFigmaSubMenuKeyboard() : getSubMenuKeyboard();

        userCurrentMode.set(chatId, newMode);
        await ctx.reply('Обери, що хочеш згенерувати далі:', backKeyboard);
        return;
    }

    await ctx.reply(config.generatingPostMessage);

    const postRes = await model.generateContent([config.postPrompt(text)]);
    const postText = getText(postRes);

    const newMode = mode === 'blog_figma' ? 'sub_menu_figma' : 'sub_menu_js';
    const backKeyboard = mode === 'blog_figma' ? getFigmaSubMenuKeyboard() : getSubMenuKeyboard();

    if (!postText) {
        userCurrentMode.set(chatId, newMode);
        await ctx.reply('⚠️ Не вдалося створити пост. Спробуй ще раз пізніше 😔', backKeyboard);
        return;
    }

    const styledPost = cleanPostText(postText);

    saveUsedTopic(text);
    userTopics.delete(chatId);
    userCurrentMode.set(chatId, newMode);

    await ctx.reply(styledPost, backKeyboard);
}

async function generateQuizPost(ctx, text, mode) {
    const chatId = ctx.chat.id;

    await ctx.reply(`🎯 **Вибрана тема вікторини:** ${text}`, { parse_mode: 'Markdown' });
    await ctx.reply('📝 Генерую питання та пост...');

    const promptBase = mode === 'quiz_figma'
        ? 'Створи одне складне запитання з UI/UX дизайну українською на тему'
        : 'Створи одне складне запитання з фронтенду українською на тему';

    const prompt = `${promptBase} "${text}" (до 300 символів). Формат: QUESTION: текст\nOPTIONS:\n1) варіант\n2) варіант\n3) варіант\n4) варіант\nCORRECT: номер\nEXPLANATION: пояснення`;
    const res = await model.generateContent([prompt]);
    const responseText = getText(res);

    const qMatch = responseText.match(/^QUESTION:\s*(.+?)\n/ms);
    const question = qMatch?.[1]?.trim();
    const optionsBlock = responseText.match(/OPTIONS:([\s\S]*?)\nCORRECT:/ms)?.[1] || '';
    const options = optionsBlock.split(/\d\)\s*/).filter(Boolean).map(o => o.trim().slice(0, 70)).filter(o => o.length > 0);
    const correct = Number(responseText.match(/CORRECT:\s*(\d)/)?.[1]) - 1;
    const explanation = responseText.match(/EXPLANATION:\s*(.+)/is)?.[1]?.trim()?.slice(0, 200) || 'Відповідь пояснюється у наступному пості!';

    const isFigmaQuiz = mode === 'quiz_figma';
    const backKeyboard = isFigmaQuiz ? getFigmaSubMenuKeyboard() : getSubMenuKeyboard();
    const newMode = isFigmaQuiz ? 'sub_menu_figma' : 'sub_menu_js';

    if (!question || options.length < 4 || correct < 0 || correct >= options.length) {
        await ctx.reply('⚠️ Не вдалося створити нове запитання для цієї теми 😔', backKeyboard);
        userTopics.delete(chatId);
        userCurrentMode.set(chatId, newMode);
        return;
    }

    await ctx.telegram.sendPoll(ctx.chat.id, question, options, {
        type: 'quiz',
        correct_option_id: correct,
        explanation: explanation,
        is_anonymous: true
    });

    const postPrompt = `Створи український телеграм-пост (700–1200 символів) для теми "${question}" у стилі короткого навчального поста.`;
    const postRes = await model.generateContent([postPrompt]);
    const postText = getText(postRes);

    saveUsedTopic(text);
    userTopics.delete(chatId);
    userCurrentMode.set(chatId, newMode);

    if (postText) {
        await ctx.telegram.sendMessage(ctx.chat.id, cleanPostText(postText), backKeyboard);
    } else {
        await ctx.reply('✅ Вікторина створена!', backKeyboard);
    }
}

async function generateStoryParts(ctx, text) {
    const chatId = ctx.chat.id;
    await ctx.reply(`🚨 Вибрана клікбейт тема:\n\n${text}`);

    const waitMessage = await ctx.reply('📚 Генерую повну історію...');

    try {
        const prompt = `Створи українську клікбейт-історію приблизно на 3300 символів на тему "${text}". Розкажи її від першої особи (Я) у стилі телеграм-блогу. Структура: початок (інтрига), середина (проблема/драма), кінець (розв'язка, мораль). Не пиши "Частина 1" або подібне — просто звичайна історія.`;

        const res = await model.generateContent([prompt]);
        let fullText = getText(res) || '';

        fullText = fullText
            .replace(/[*_`~>#+=|{}[\]]/g, '')
            .replace(/<\/?[^>]+(>|$)/g, '')
            .replace(/\s{2,}/g, ' ')
            .replace(/&[^;\s]+;/g, '')
            .trim();

        if (fullText.length < 500) {
            await ctx.telegram.deleteMessage(chatId, waitMessage.message_id).catch(() => {});
            await ctx.reply('⚠️ Не вдалося створити історію. Спробуй ще раз 😔', getSubMenuKeyboard());
            return;
        }

        const sentences = fullText.split(/(?<=[.!?])\s+/);
        const targetLen = Math.ceil(sentences.length / 3);
        const parts = [
            sentences.slice(0, targetLen).join(' '),
            sentences.slice(targetLen, targetLen * 2).join(' '),
            sentences.slice(targetLen * 2).join(' ')
        ].map(p => p.trim());

        await ctx.telegram.deleteMessage(chatId, waitMessage.message_id).catch(() => {});

        await ctx.reply(`🤯 Історія: ${text} – Частина 1/3\n\n${parts[0]}\n\nПродовження буде завтра!`);
        await ctx.reply(`💰 Історія: ${text} – Частина 2/3\n\n${parts[1]}\n\nКінець уже близько...`);
        await ctx.reply(`✅ Історія: ${text} – Частина 3/3 (Розв'язка)\n\n${parts[2]}\n\nКінець історії. Поділися думками!`);

        saveUsedTopic(text);
        await ctx.reply('✅ Усі 3 частини історії згенеровано!', getSubMenuKeyboard());
    } catch (error) {
        console.error('❌ Story generation error:', error);
        await ctx.telegram.deleteMessage(chatId, waitMessage.message_id).catch(() => {});
        await ctx.reply('⚠️ Помилка під час створення історії. Спробуй ще раз 😔', getSubMenuKeyboard());
    } finally {
        userTopics.delete(chatId);
        userCurrentMode.set(chatId, 'sub_menu_js');
    }
}

bot.start(async ctx => {
    if (!checkAccess(ctx)) return;

    const chatId = ctx.chat.id;
    userCurrentMode.delete(chatId);
    userTopics.delete(chatId);
    await ctx.reply('Привіт! 👋 Обери, що хочеш згенерувати:', getMainKeyboard());
});

bot.hears('🤖 FrontEnd - JavaScript | TypeScript', async ctx => {
    if (!checkAccess(ctx)) return;
    const chatId = ctx.chat.id;
    userCurrentMode.set(chatId, 'sub_menu_js');
    userTopics.delete(chatId);
    await ctx.reply('Обери тип контенту для JavaScript | TypeScript:', getSubMenuKeyboard());
});

bot.hears('🎨 FrontEnd UI - Figma макети', async ctx => {
    if (!checkAccess(ctx)) return;
    const chatId = ctx.chat.id;
    userCurrentMode.set(chatId, 'sub_menu_figma');
    userTopics.delete(chatId);
    await ctx.reply('Обери тип контенту для Figma макетів:', getFigmaSubMenuKeyboard());
});

bot.hears('⬅️ Головне меню', async ctx => {
    if (!checkAccess(ctx)) return;
    const chatId = ctx.chat.id;
    userCurrentMode.delete(chatId);
    userTopics.delete(chatId);
    await ctx.reply('Повертаємося до головного меню:', getMainKeyboard());
});

bot.hears('🧠 Згенерувати блог', ctx => {
    if (!checkAccess(ctx)) return;
    protectedGeneration(ctx, 'blog_topics', (ctx) => generateTopics(ctx, 'blog'));
});

bot.hears('🧮 Зробити задачу', ctx => {
    if (!checkAccess(ctx)) return;
    protectedGeneration(ctx, 'task_topics', (ctx) => generateTopics(ctx, 'task'));
});

bot.hears('🧩 Згенерувати опитування', ctx => {
    if (!checkAccess(ctx)) return;
    const mode = userCurrentMode.get(ctx.chat.id);
    const targetMode = mode === 'sub_menu_figma' ? 'quiz_figma' : 'quiz';
    protectedGeneration(ctx, `${targetMode}_topics`, (ctx) => generateTopics(ctx, targetMode));
});

bot.hears('🎭 Згенерувати цитату', ctx => {
    if (!checkAccess(ctx)) return;
    protectedGeneration(ctx, 'quote_topics', (ctx) => generateTopics(ctx, 'quote'));
});

bot.hears('📖 Згенерувати історію', ctx => {
    if (!checkAccess(ctx)) return;
    protectedGeneration(ctx, 'story_topics', (ctx) => generateTopics(ctx, 'story'));
});

bot.hears('🧠 Згенерувати блог (Figma)', ctx => {
    if (!checkAccess(ctx)) return;
    protectedGeneration(ctx, 'blog_figma_topics', (ctx) => generateTopics(ctx, 'blog_figma'));
});

bot.hears('🧩 Згенерувати опитування (Figma)', ctx => {
    if (!checkAccess(ctx)) return;
    protectedGeneration(ctx, 'quiz_figma_topics', (ctx) => generateTopics(ctx, 'quiz_figma'));
});


bot.hears([
    '🔄 Перегенерувати теми',
    '🔄 Перегенерувати задачі',
    '🔄 Перегенерувати вікторини',
    '🔄 Перегенерувати цитати'
], ctx => {
    if (!checkAccess(ctx)) return;
    const chatId = ctx.chat.id;
    const mode = userCurrentMode.get(chatId);
    const text = ctx.message.text;

    let topicMode = null;
    if (mode && MODE_CONFIG[mode]) {
        topicMode = mode;
    } else if (mode === 'sub_menu_js') {
        if (text === '🔄 Перегенерувати теми') topicMode = 'blog';
        if (text === '🔄 Перегенерувати задачі') topicMode = 'task';
        if (text === '🔄 Перегенерувати вікторини') topicMode = 'quiz';
        if (text === '🔄 Перегенерувати цитати') topicMode = 'quote';
    } else if (mode === 'sub_menu_figma') {
        if (text === '🔄 Перегенерувати теми') topicMode = 'blog_figma';
        if (text === '🔄 Перегенерувати вікторини') topicMode = 'quiz_figma';
    }


    if (topicMode && MODE_CONFIG[topicMode]) {
        protectedGeneration(ctx, `${topicMode}_topics`, (ctx) => generateTopics(ctx, topicMode));
    }
});

bot.on('text', async ctx => {
    if (!checkAccess(ctx)) return;

    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const mode = userCurrentMode.get(chatId);
    const topicData = userTopics.get(chatId);

    if (text === '⬅️ Назад в меню') {
        const previousMode = userCurrentMode.get(chatId);
        if (topicData) {
            userTopics.delete(chatId);
        }

        if (previousMode === 'sub_menu_figma' || previousMode === 'blog_figma' || previousMode === 'quiz_figma') {
            userCurrentMode.set(chatId, 'sub_menu_figma');
            await ctx.reply('Повертаємося до меню Figma:', getFigmaSubMenuKeyboard());
        } else {
            userCurrentMode.set(chatId, 'sub_menu_js');
            await ctx.reply('Повертаємося до меню JavaScript:', getSubMenuKeyboard());
        }
        return;
    }

    if (text === '⬅️ Головне меню' || Object.values(MODE_CONFIG).some(c => c.regenerateText === text)) {
        return;
    }

    if (topicData && topicData.mode === mode && topicData.topics.includes(text)) {
        switch (mode) {
            case 'blog':
            case 'blog_figma':
            case 'task':
            case 'quote':
                protectedGeneration(ctx, `${mode}_post`, (ctx) => generateContentPost(ctx, mode, text));
                break;
            case 'quiz':
            case 'quiz_figma':
                protectedGeneration(ctx, `${mode}_post`, (ctx) => generateQuizPost(ctx, text, mode));
                break;
            case 'story':
                protectedGeneration(ctx, 'story_parts', (ctx) => generateStoryParts(ctx, text));
                break;
        }
        return;
    }

    if (mode === 'sub_menu_js') {
        await ctx.reply('Будь ласка, обери дію з меню.', getSubMenuKeyboard());
    } else if (mode === 'sub_menu_figma') {
        await ctx.reply('Будь ласка, обери дію з меню.', getFigmaSubMenuKeyboard());
    } else if (mode && MODE_CONFIG[mode]) {
        await ctx.reply('Будь ласка, обери одну з запропонованих тем або перегенеруй їх.', getTopicsKeyboard(topicData.topics, MODE_CONFIG[mode].regenerateText));
    } else {
        await ctx.reply('Будь ласка, обери розділ з головного меню.', getMainKeyboard());
    }
});

setInterval(() => {
    const now = Date.now();
    for (const [chatId, data] of activeGenerations.entries()) {
        if (now - data.startTime > 5 * 60 * 1000) {
            console.warn(`🗑️ Cleaning up stuck generation for chat ${chatId} (${data.type})`);
            activeGenerations.delete(chatId);
        }
    }
}, 60000);

bot.launch();