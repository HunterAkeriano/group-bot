import dotenv from 'dotenv';
import fs from 'fs';
import { Telegraf, Markup } from 'telegraf';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: {temperature: 0.9} });

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
        ['🧠 Сгенерувати блог'],
        ['🧩 Сгенерувати опитування'],
        ['🎭 Сгенерувати цитату'],
        ['🧮 Зробити задачу']
    ]).resize();
}

function getTopicsKeyboard(topics, regenerateText = '🔄 Перегенерувати') {
    const buttons = topics.map(topic => [topic]);
    buttons.push([regenerateText]);
    buttons.push(['⬅️ Назад в меню']);
    return Markup.keyboard(buttons).resize();
}

bot.start(async ctx => {
    const chatId = ctx.chat.id;
    userCurrentMode.delete(chatId);
    await ctx.reply('Привіт! 👋 Обери, що хочеш згенерувати:', getMainMenuKeyboard());
});

async function generateBlogTopics(ctx, numTopics = 5) {
    const chatId = ctx.chat.id;
    await ctx.reply(`🌀 Генерую ${numTopics} унікальних ідей для блогу...`);

    const newTopics = [];
    const maxRounds = 3;

    for (let round = 0; round < maxRounds && newTopics.length < numTopics; round++) {
        const needed = numTopics - newTopics.length;
        const toGenerate = Math.min(needed * 2, 10);

        const promises = Array.from({ length: toGenerate }, () => {
            const ideaPrompt = `
Придумай одну коротку, креативну ідею українською для телеграм-блогу про:
- роботу розробника, життя у сфері IT, VUE, JS, верстку, TS, мотивацію, технології, AI або Node.js.
Формат:
- лише 1 ідея (жодних списків)
- до 50 символів
- обов'язково почни з емодзі
- не додавай лапки
            `;
            return model.generateContent([ideaPrompt])
                .then(res => getText(res))
                .catch(() => null);
        });

        const results = await Promise.all(promises);

        for (const idea of results) {
            if (idea &&
                !isDuplicateIdea(idea) &&
                !newTopics.includes(idea) &&
                newTopics.length < numTopics) {
                newTopics.push(idea);
            }
        }

        if (newTopics.length >= numTopics) break;
    }

    if (newTopics.length === 0) {
        await ctx.reply('⚠️ Не вдалося знайти нових тем 😅', getMainMenuKeyboard());
        return;
    }

    userBlogTopics.set(chatId, newTopics);
    userCurrentMode.set(chatId, 'blog');

    await ctx.reply('Обери тему для блогу:', getTopicsKeyboard(newTopics, '🔄 Перегенерувати теми'));
}

bot.hears('🧠 Сгенерувати блог', ctx => {
    protectedGeneration(ctx, 'blog_topics', generateBlogTopics);
});

bot.hears('🔄 Перегенерувати теми', ctx => {
    const chatId = ctx.chat.id;
    const mode = userCurrentMode.get(chatId);

    if (mode === 'blog') {
        protectedGeneration(ctx, 'blog_topics', generateBlogTopics);
    }
});

async function generateTaskTopics(ctx, numTopics = 5) {
    const chatId = ctx.chat.id;
    await ctx.reply(`⚙️ Генерую ${numTopics} унікальних JS-задач...`);

    const newTopics = [];
    const maxRounds = 3;

    for (let round = 0; round < maxRounds && newTopics.length < numTopics; round++) {
        const needed = numTopics - newTopics.length;
        const toGenerate = Math.min(needed * 2, 10);

        const promises = Array.from({ length: toGenerate }, () => {
            const ideaPrompt = `
Створи коротку назву (до 50 символів, з емодзі, без лапок) для практичної задачі з JavaScript (масиви, логіка, дати).
Формат:
- лише 1 назва
- має бути унікальною
            `;
            return model.generateContent([ideaPrompt])
                .then(res => getText(res))
                .catch(() => null);
        });

        const results = await Promise.all(promises);

        for (const idea of results) {
            if (idea &&
                !isDuplicateIdea(idea) &&
                !newTopics.includes(idea) &&
                newTopics.length < numTopics) {
                newTopics.push(idea);
            }
        }

        if (newTopics.length >= numTopics) break;
    }

    if (newTopics.length === 0) {
        await ctx.reply('⚠️ Не вдалося знайти нових задач 😅', getMainMenuKeyboard());
        return;
    }

    userTaskTopics.set(chatId, newTopics);
    userCurrentMode.set(chatId, 'task');

    await ctx.reply('Обери задачу:', getTopicsKeyboard(newTopics, '🔄 Перегенерувати задачі'));
}

bot.hears('🧮 Зробити задачу', ctx => {
    protectedGeneration(ctx, 'task_topics', generateTaskTopics);
});

bot.hears('🔄 Перегенерувати задачі', ctx => {
    const chatId = ctx.chat.id;
    const mode = userCurrentMode.get(chatId);

    if (mode === 'task') {
        protectedGeneration(ctx, 'task_topics', generateTaskTopics);
    }
});

async function generateQuizTopics(ctx, numTopics = 5) {
    const chatId = ctx.chat.id;
    await ctx.reply(`🔄 Генерую ${numTopics} унікальних тем для вікторин...`);

    const newTopics = [];
    const maxRounds = 3;

    for (let round = 0; round < maxRounds && newTopics.length < numTopics; round++) {
        const needed = numTopics - newTopics.length;
        const toGenerate = Math.min(needed * 2, 10);

        const promises = Array.from({ length: toGenerate }, () => {
            const ideaPrompt = `
Створи коротку назву (до 50 символів, з емодзі, без лапок) для вікторини з фронтенду (HTML, CSS, JavaScript або Vue.js).
Формат:
- лише 1 назва
- має бути унікальною
            `;
            return model.generateContent([ideaPrompt])
                .then(res => getText(res))
                .catch(() => null);
        });

        const results = await Promise.all(promises);

        for (const idea of results) {
            if (idea && newTopics.length < numTopics) {
                newTopics.push(idea);
            }
        }

        if (newTopics.length >= numTopics) break;
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

bot.hears('🧩 Сгенерувати опитування', ctx => {
    protectedGeneration(ctx, 'quiz_topics', generateQuizTopics);
});

bot.hears('🔄 Перегенерувати вікторини', ctx => {
    const chatId = ctx.chat.id;
    const mode = userCurrentMode.get(chatId);

    if (mode === 'quiz') {
        protectedGeneration(ctx, 'quiz_topics', generateQuizTopics);
    }
});

bot.on('text', async ctx => {
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
            userCurrentMode.delete(chatId);

            protectedGeneration(ctx, 'blog_post', async (ctx) => {
                await ctx.reply(`✨ **Ідея для блогу:**\n\n${text}`, { parse_mode: 'Markdown' });
                await ctx.reply('✍️ Генерую повний блог-пост...');

                saveUsedTopic(text);
                userBlogTopics.delete(chatId);

                const postPrompt = `
Створи великий телеграм-пост українською (1500 символів)
у стилі сучасного IT-блогу.
Тема: "${text}"
                `;
                const postRes = await model.generateContent([postPrompt]);
                const postText = getText(postRes);

                if (!postText) {
                    await ctx.reply('⚠️ Не вдалося створити пост. Спробуй ще раз пізніше 😔', getMainMenuKeyboard());
                    return;
                }

                const styledPost = cleanPostText(postText);
                await ctx.reply(styledPost, getMainMenuKeyboard());
            });
            return;
        }
    }

    if (mode === 'task') {
        const topics = userTaskTopics.get(chatId);
        if (topics && topics.includes(text)) {
            userCurrentMode.delete(chatId);

            protectedGeneration(ctx, 'task_post', async (ctx) => {
                await ctx.reply(`🎯 **Вибрана задача:** ${text}`, { parse_mode: 'Markdown' });
                await ctx.reply('🔧 Генерую деталі задачі...');

                saveUsedTopic(text);
                userTaskTopics.delete(chatId);

                const taskPrompt = `
Створи коротку практичну задачу з JavaScript українською.
Тема: "${text}"
Формат:
🧩 Задача: ... (короткий опис)
📦 Приклад:
\`\`\`js
// приклад вхідних даних
// приклад виклику
\`\`\`
🔍 Уточнення: ... (додаткові умови)
Має бути унікальна задача без повторів, до 1000 символів.
                `;
                const taskRes = await model.generateContent([taskPrompt]);
                const taskText = getText(taskRes);

                if (!taskText) {
                    await ctx.reply('⚠️ Не вдалося створити задачу. Спробуй ще раз пізніше 😔', getMainMenuKeyboard());
                    return;
                }

                const styledTask = cleanPostText(taskText);
                await ctx.reply(styledTask, getMainMenuKeyboard());
            });
            return;
        }
    }

    if (mode === 'quiz') {
        const topics = userQuizTopics.get(chatId);
        if (topics && topics.includes(text)) {
            userCurrentMode.delete(chatId);

            protectedGeneration(ctx, 'quiz_post', async (ctx) => {
                await ctx.reply(`🎯 **Вибрана тема вікторини:** ${text}`, { parse_mode: 'Markdown' });
                await ctx.reply('📝 Генерую питання та пост...');

                saveUsedTopic(text);
                userQuizTopics.delete(chatId);

                let question = '';
                let options = [];
                let correct = 0;
                let explanation = '';
                let attempts = 0;

                while (!question && attempts < 5) {
                    attempts++;
                    const prompt = `
Створи одне складне запитання з фронтенду українською на тему "${text}".(не більше 300 символів)
Формат:
QUESTION: ...
OPTIONS:
1) ...
2) ...
3) ...
4) ...
CORRECT: X
EXPLANATION: ...
                    `;
                    const res = await model.generateContent([prompt]);
                    const responseText = getText(res);

                    const qMatch = responseText.match(/^QUESTION:\s*(.+?)\n/ms);
                    if (!qMatch) continue;

                    const qCandidate = qMatch[1]?.trim();
                    if (!qCandidate) continue;

                    const optionsBlock = responseText.match(/OPTIONS:([\s\S]*?)\nCORRECT:/ms)?.[1] || '';
                    const optionsCandidate = optionsBlock.split(/\d\)\s*/).filter(Boolean).map(o => o.trim().slice(0, 70)).filter(o => o.length > 0);

                    if (optionsCandidate.length < 4) continue;

                    const correctCandidate = Number(responseText.match(/CORRECT:\s*(\d)/)?.[1]) - 1;
                    if (correctCandidate < 0 || correctCandidate >= optionsCandidate.length) continue;

                    question = qCandidate;
                    options = optionsCandidate;
                    correct = correctCandidate;
                    explanation = responseText.match(/EXPLANATION:\s*(.+)/is)?.[1]?.trim()?.slice(0, 200) || '';

                    break;
                }

                if (!question) {
                    await ctx.reply('⚠️ Не вдалося створити нове запитання для цієї теми 😔', getMainMenuKeyboard());
                    return;
                }

                const finalExplanation = explanation || 'Відповідь пояснюється у наступному пості!';

                await ctx.telegram.sendPoll(ctx.chat.id, question, options, {
                    type: 'quiz',
                    correct_option_id: correct,
                    explanation: finalExplanation,
                    is_anonymous: true
                });

                const postPrompt = `
Створи український телеграм-пост (700–1200 символів)
для теми "${question}" у стилі короткого навчального поста, щоб пояснити концепцію, про яку було запитання.
                `;
                const postRes = await model.generateContent([postPrompt]);
                const postText = getText(postRes);

                if (postText) {
                    await ctx.telegram.sendMessage(ctx.chat.id, cleanPostText(postText), getMainMenuKeyboard());
                } else {
                    await ctx.reply('✅ Вікторина створена!', getMainMenuKeyboard());
                }
            });
            return;
        }
    }
});

bot.hears('🎭 Сгенерувати цитату', ctx => {
    protectedGeneration(ctx, 'quote', async (ctx) => {
        await ctx.reply('😎 Генерую настрій розробника...');

        const prompt = `
Придумай 10 коротких дотепних цитат українською (до 200 символів)
про життя або філософію розробника та різними за сенсом.
Без лапок, лише текст у стилі Telegram, з емодзі.
        `;
        for (let i = 0; i < 10; i++) {
            const res = await model.generateContent([prompt]);
            const quote = cleanPostText(getText(res));
            if (quote && !isDuplicateIdea(quote)) {
                saveUsedTopic(quote);
                await ctx.reply(`💬 **Цитата розробника:**\n\n${quote}`, { parse_mode: 'Markdown' });
                return;
            }
        }
        await ctx.reply('⚠️ Усі цитати вже використовувались 😅');
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