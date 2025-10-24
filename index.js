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
let usedTopics = [];

if (fs.existsSync(USED_TOPICS_FILE)) {
    try {
        usedTopics = JSON.parse(fs.readFileSync(USED_TOPICS_FILE, 'utf-8'));
    } catch {
        usedTopics = [];
    }
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

function saveUsedTopic(topic) {
    usedTopics.push(topic);
    if (usedTopics.length > 500) {
        usedTopics = usedTopics.slice(-500);
    }
    fs.writeFileSync(USED_TOPICS_FILE, JSON.stringify(usedTopics, null, 2));
}

const activeGenerations = new Map();
const userBlogTopics = new Map();
const userTaskTopics = new Map();
const userQuizTopics = new Map();
const userCurrentMode = new Map();

function protectedGeneration(ctx, type, generator) {
    const chatId = ctx.chat.id;
    const messageId = ctx.message?.message_id;

    if (activeGenerations.has(chatId)) {
        ctx.reply('⏳ **УВАГА!** Попередня генерація ще не завершена. Зачекай ✋', { parse_mode: 'Markdown' });
        return;
    }

    activeGenerations.set(chatId, { type, messageId, startTime: Date.now() });

    (async () => {
        try {
            await generator(ctx);
        } catch (error) {
            console.error('❌ Generation error:', error);
            ctx.reply('⚠️ Критична помилка. Спробуй ще раз.');
        } finally {
            activeGenerations.delete(chatId);
        }
    })();
}

function cleanPostText(text) {
    return text.replace(/[*_`<>]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function getMainMenuKeyboard() {
    return Markup.keyboard([
        ['🧠 Згенерувати блог', '🧩 Згенерувати опитування'],
        ['🎭 Згенерувати цитату', '🧮 Зробити задачу']
    ]).resize();
}

function getTopicsKeyboard(topics, regenerateText = '🔄 Перегенерувати') {
    const keyboard = [];
    for (let i = 0; i < topics.length; i += 2) {
        if (i + 1 < topics.length) {
            keyboard.push([topics[i], topics[i + 1]]);
        } else {
            keyboard.push([topics[i]]);
        }
    }
    keyboard.push([regenerateText]);
    keyboard.push(['⬅️ Назад в меню']);
    return Markup.keyboard(keyboard).resize();
}

function checkAccess(ctx) {
    if (ALLOWED_USERNAMES.length === 0) return true;
    const userUsername = ctx.from?.username?.toLowerCase();

    if (userUsername && ALLOWED_USERNAMES.includes(userUsername)) {
        return true;
    }
    ctx.reply('❌ Зайнятий. Іди нахуй.', getMainMenuKeyboard());
    return false;
}

bot.start(async ctx => {
    if (!checkAccess(ctx)) return;

    const chatId = ctx.chat.id;
    userCurrentMode.delete(chatId);
    await ctx.reply('Привіт! 👋 Обери, що хочеш згенерувати:', getMainMenuKeyboard());
});

async function generateBlogTopics(ctx, numTopics = 5) {
    const chatId = ctx.chat.id;
    await ctx.reply(`🌀 Генерую ${numTopics} унікальних ідей для блогу...`);

    const ideaPrompt = `
Придумай ${numTopics} коротких, креативних ідей українською для телеграм-блогу про роботу розробника, життя у сфері IT, VUE, JS, верстку, TS, мотивацію, технології, AI або Node.js.
Кожна ідея:
- до 50 символів
- почни з емодзі
- без лапок
- нумерована з 1 до ${numTopics}
Формат:
1) емодзі + назва
2) емодзі + назва
...
`;

    const result = await model.generateContent([ideaPrompt]);
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

    if (newTopics.length === 0) {
        await ctx.reply('⚠️ Не вдалося знайти нових тем 😅', getMainMenuKeyboard());
        return;
    }

    userBlogTopics.set(chatId, newTopics);
    userCurrentMode.set(chatId, 'blog');

    await ctx.reply('Обери тему для блогу:', getTopicsKeyboard(newTopics, '🔄 Перегенерувати теми'));
}

async function generateBlogPost(ctx, text) {
    const chatId = ctx.chat.id;

    await ctx.reply(`✨ **Ідея для блогу:**\n\n${text}`, { parse_mode: 'Markdown' });
    await ctx.reply('✍️ Генерую повний блог-пост...');

    const postPrompt = `Створи великий телеграм-пост українською (1500 символів) у стилі сучасного IT-блогу. Тема: "${text}"`;
    const postRes = await model.generateContent([postPrompt]);
    const postText = getText(postRes);

    if (!postText) {
        await ctx.reply('⚠️ Не вдалося створити пост. Спробуй ще раз пізніше 😔', getMainMenuKeyboard());
        return;
    }

    const styledPost = cleanPostText(postText);

    saveUsedTopic(text);
    userBlogTopics.delete(chatId);
    userCurrentMode.delete(chatId);

    await ctx.reply(styledPost, getMainMenuKeyboard());
}

bot.hears('🧠 Згенерувати блог', ctx => {
    if (!checkAccess(ctx)) return;
    protectedGeneration(ctx, 'blog_topics', generateBlogTopics);
});

bot.hears('🔄 Перегенерувати теми', ctx => {
    if (!checkAccess(ctx)) return;
    const chatId = ctx.chat.id;
    const mode = userCurrentMode.get(chatId);

    if (mode === 'blog') {
        protectedGeneration(ctx, 'blog_topics', generateBlogTopics);
    }
});

async function generateTaskTopics(ctx, numTopics = 5) {
    const chatId = ctx.chat.id;
    await ctx.reply(`⚙️ Генерую ${numTopics} унікальних JS-задач...`);

    const ideaPrompt = `
Створи ${numTopics} коротких назв (до 50 символів, з емодзі, без лапок) для практичних задач з JavaScript (масиви, логіка, дати).
Формат нумерований:
1) емодзі + назва
2) емодзі + назва
...
`;

    const result = await model.generateContent([ideaPrompt]);
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

    if (newTopics.length === 0) {
        await ctx.reply('⚠️ Не вдалося знайти нових задач 😅', getMainMenuKeyboard());
        return;
    }

    userTaskTopics.set(chatId, newTopics);
    userCurrentMode.set(chatId, 'task');

    await ctx.reply('Обери задачу:', getTopicsKeyboard(newTopics, '🔄 Перегенерувати задачі'));
}

async function generateTaskPost(ctx, text) {
    const chatId = ctx.chat.id;

    await ctx.reply(`🎯 **Вибрана задача:** ${text}`, { parse_mode: 'Markdown' });
    await ctx.reply('🔧 Генерую деталі задачі...');

    const taskPrompt = `Створи коротку практичну задачу з JavaScript українською. Тема: "${text}". Формат: 🧩 Задача: опис, 📦 Приклад: код JS, 🔍 Уточнення: умови. До 1000 символів.`;
    const taskRes = await model.generateContent([taskPrompt]);
    const taskText = getText(taskRes);

    if (!taskText) {
        await ctx.reply('⚠️ Не вдалося створити задачу. Спробуй ще раз пізніше 😔', getMainMenuKeyboard());
        return;
    }

    const styledTask = cleanPostText(taskText);

    saveUsedTopic(text);
    userTaskTopics.delete(chatId);
    userCurrentMode.delete(chatId);

    await ctx.reply(styledTask, getMainMenuKeyboard());
}

bot.hears('🧮 Зробити задачу', ctx => {
    if (!checkAccess(ctx)) return;
    protectedGeneration(ctx, 'task_topics', generateTaskTopics);
});

bot.hears('🔄 Перегенерувати задачі', ctx => {
    if (!checkAccess(ctx)) return;
    const chatId = ctx.chat.id;
    const mode = userCurrentMode.get(chatId);

    if (mode === 'task') {
        protectedGeneration(ctx, 'task_topics', generateTaskTopics);
    }
});

async function generateQuizTopics(ctx, numTopics = 5) {
    const chatId = ctx.chat.id;
    await ctx.reply(`🔄 Генерую ${numTopics} унікальних тем для вікторин...`);

    const ideaPrompt = `
Створи ${numTopics} коротких назв (до 50 символів, з емодзі, без лапок) для вікторин з фронтенду (HTML, CSS, JavaScript або Vue.js).
Формат нумерований:
1) емодзі + назва
2) емодзі + назва
...
`;

    const result = await model.generateContent([ideaPrompt]);
    const text = getText(result);

    const lines = text.split('\n').filter(l => l.trim());
    const newTopics = [];

    for (const line of lines) {
        const match = line.match(/^\d+\)\s*(.+)$/);
        if (match && newTopics.length < numTopics) {
            newTopics.push(match[1].trim());
        }
    }

    if (newTopics.length < numTopics) {
        let placeholders = [
            '❓ JavaScript Замикання',
            '❓ CSS Grid vs Flexbox',
            '❓ Проміси та Async/Await',
            '❓ Що таке Virtual DOM',
            '❓ Область видимості в JS'
        ];

        while (newTopics.length < numTopics && placeholders.length > 0) {
            newTopics.push(placeholders.shift());
        }
    }

    userQuizTopics.set(chatId, newTopics);
    userCurrentMode.set(chatId, 'quiz');

    await ctx.reply('Обери тему вікторини:', getTopicsKeyboard(newTopics, '🔄 Перегенерувати вікторини'));
}

async function generateQuizPost(ctx, text) {
    const chatId = ctx.chat.id;

    await ctx.reply(`🎯 **Вибрана тема вікторини:** ${text}`, { parse_mode: 'Markdown' });
    await ctx.reply('📝 Генерую питання та пост...');

    const prompt = `Створи одне складне запитання з фронтенду українською на тему "${text}" (до 300 символів). Формат: QUESTION: текст\nOPTIONS:\n1) варіант\n2) варіант\n3) варіант\n4) варіант\nCORRECT: номер\nEXPLANATION: пояснення`;
    const res = await model.generateContent([prompt]);
    const responseText = getText(res);

    const qMatch = responseText.match(/^QUESTION:\s*(.+?)\n/ms);
    if (!qMatch) {
        await ctx.reply('⚠️ Не вдалося створити нове запитання для цієї теми 😔', getMainMenuKeyboard());
        return;
    }

    const question = qMatch[1]?.trim();
    const optionsBlock = responseText.match(/OPTIONS:([\s\S]*?)\nCORRECT:/ms)?.[1] || '';
    const options = optionsBlock.split(/\d\)\s*/).filter(Boolean).map(o => o.trim().slice(0, 70)).filter(o => o.length > 0);
    const correct = Number(responseText.match(/CORRECT:\s*(\d)/)?.[1]) - 1;
    const explanation = responseText.match(/EXPLANATION:\s*(.+)/is)?.[1]?.trim()?.slice(0, 200) || 'Відповідь пояснюється у наступному пості!';

    if (!question || options.length < 4 || correct < 0 || correct >= options.length) {
        await ctx.reply('⚠️ Не вдалося створити нове запитання для цієї теми 😔', getMainMenuKeyboard());
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
    userQuizTopics.delete(chatId);
    userCurrentMode.delete(chatId);

    if (postText) {
        await ctx.telegram.sendMessage(ctx.chat.id, cleanPostText(postText), getMainMenuKeyboard());
    } else {
        await ctx.reply('✅ Вікторина створена!', getMainMenuKeyboard());
    }
}

bot.hears('🧩 Згенерувати опитування', ctx => {
    if (!checkAccess(ctx)) return;
    protectedGeneration(ctx, 'quiz_topics', generateQuizTopics);
});

bot.hears('🔄 Перегенерувати вікторини', ctx => {
    if (!checkAccess(ctx)) return;
    const chatId = ctx.chat.id;
    const mode = userCurrentMode.get(chatId);

    if (mode === 'quiz') {
        protectedGeneration(ctx, 'quiz_topics', generateQuizTopics);
    }
});

bot.on('text', async ctx => {
    if (!checkAccess(ctx)) return;

    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const mode = userCurrentMode.get(chatId);

    if (text === '⬅️ Назад в меню') {
        userCurrentMode.delete(chatId);
        await ctx.reply('Обери, що хочеш згенерувати:', getMainMenuKeyboard());
        return;
    }

    if (mode === 'blog') {
        const topics = userBlogTopics.get(chatId);
        if (topics && topics.includes(text)) {
            protectedGeneration(ctx, 'blog_post', (ctx) => generateBlogPost(ctx, text));
            return;
        }
    }

    if (mode === 'task') {
        const topics = userTaskTopics.get(chatId);
        if (topics && topics.includes(text)) {
            protectedGeneration(ctx, 'task_post', (ctx) => generateTaskPost(ctx, text));
            return;
        }
    }

    if (mode === 'quiz') {
        const topics = userQuizTopics.get(chatId);
        if (topics && topics.includes(text)) {
            protectedGeneration(ctx, 'quiz_post', (ctx) => generateQuizPost(ctx, text));
        }
    }
});

bot.hears(/🎭\s*Згенерувати цитату/i, ctx => {
    if (!checkAccess(ctx)) return;
    protectedGeneration(ctx, 'quote', async (ctx) => {
        await ctx.reply('😎 Генерую настрій розробника...');

        const prompt = `Придумай одну коротку дотепну цитату українською (до 200 символів) про життя або філософію розробника. Без лапок, лише текст у стилі Telegram, з емодзі.`;
        const res = await model.generateContent([prompt]);
        const quote = cleanPostText(getText(res));

        if (quote && !isDuplicateIdea(quote)) {
            saveUsedTopic(quote);
            await ctx.reply(`💬 **Цитата розробника:**\n\n${quote}`, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply('⚠️ Усі цитати вже використовувались 😅');
        }
    });
});

setInterval(() => {
    const now = Date.now();
    for (const [chatId, data] of activeGenerations.entries()) {
        if (now - data.startTime > 5 * 60 * 1000) activeGenerations.delete(chatId);
    }
}, 60000);

bot.launch();
console.log('✅ Бот запущений!');