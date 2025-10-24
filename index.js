import dotenv from 'dotenv';
import fs from 'fs';
import { Telegraf, Markup } from 'telegraf';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash', generationConfig: {temperature: 0.9} });

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

bot.start(async ctx => {
    const keyboard = Markup.keyboard([
        ['🧠 Сгенерувати блог'],
        ['🧩 Сгенерувати опитування'],
        ['🎭 Сгенерувати цитату'],
        ['🧮 Зробити задачу']
    ]).resize();

    await ctx.reply('Привіт! 👋 Обери, що хочеш згенерувати:', keyboard);
});

// 🧠 блог
bot.hears('🧠 Сгенерувати блог', ctx => {
    protectedGeneration(ctx, 'blog', async (ctx) => {
        await ctx.reply('🌀 Генерую унікальну ідею для блогу...');

        let blogIdea = '';
        for (let i = 0; i < 10; i++) {
            const ideaPrompt = `
      Придумай одну коротку, креативну ідею українською для телеграм-блогу про:
      - роботу розробника, життя у сфері IT, мотивацію, технології, AI або Node.js.
      Формат:
      - лише 1 ідея (жодних списків)
      - до 70 символів
      - обов'язково почни з емодзі
      - не додавай лапки
      `;
            const res = await model.generateContent([ideaPrompt]);
            const idea = getText(res);
            if (idea && !isDuplicateIdea(idea)) {
                blogIdea = idea;
                saveUsedTopic(idea);
                break;
            }
        }

        if (!blogIdea) {
            await ctx.reply('⚠️ Не вдалося знайти нову тему 😅');
            return;
        }

        await ctx.reply(`✨ <b>Ідея для блогу:</b>\n\n${blogIdea}`, { parse_mode: 'HTML' });
        await ctx.reply('✍️ Генерую повний блог-пост...');

        const postPrompt = `
    Створи великий телеграм-пост українською (1500–2200 символів)
    у стилі сучасного IT-блогу.
    Тема: "${blogIdea}"
    `;
        const postRes = await model.generateContent([postPrompt]);
        const postText = getText(postRes);
        if (!postText) {
            await ctx.reply('⚠️ Не вдалося створити пост. Спробуй ще раз пізніше 😔');
            return;
        }
        const styledPost = cleanPostText(postText);
        await ctx.reply(styledPost);
    });
});

bot.hears('🧩 Сгенерувати опитування', ctx => {
    protectedGeneration(ctx, 'quiz', async (ctx) => {
        await ctx.reply('🔄 Генерую унікальну фронтенд-вікторину...');

        let question = '';
        let options = [];
        let correct = 0;
        let explanation = '';
        let attempts = 0;

        while (!question && attempts < 10) {
            attempts++;
            const prompt = `
      Створи одне складне запитання з фронтенду (HTML, CSS, JavaScript або Vue.js).(не більше 300 символів)
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
            const text = getText(res);

            const qMatch = text.match(/^QUESTION:\s*(.+?)\n/ms);
            if (!qMatch) continue;

            const qCandidate = qMatch[1]?.trim();
            if (!qCandidate || isDuplicateIdea(qCandidate)) continue;

            const optionsBlock = text.match(/OPTIONS:([\s\S]*?)\nCORRECT:/ms)?.[1] || '';
            const optionsCandidate = optionsBlock.split(/\d\)\s*/).filter(Boolean).map(o => o.trim().slice(0, 70)).filter(o => o.length > 0);

            if (optionsCandidate.length < 4) continue;

            const correctCandidate = Number(text.match(/CORRECT:\s*(\d)/)?.[1]) - 1;
            if (correctCandidate < 0 || correctCandidate >= optionsCandidate.length) continue;

            question = qCandidate;
            options = optionsCandidate;
            correct = correctCandidate;
            explanation = text.match(/EXPLANATION:\s*(.+)/is)?.[1]?.trim()?.slice(0, 200) || '';

            saveUsedTopic(question);
            break;
        }

        if (!question) {
            await ctx.reply('⚠️ Не вдалося знайти нове запитання 😅');
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
    для теми "${question}" у стилі короткого навчального поста.
    `;
        const postRes = await model.generateContent([postPrompt]);
        const postText = getText(postRes);
        if (postText) await ctx.telegram.sendMessage(ctx.chat.id, cleanPostText(postText));
    });
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
                await ctx.reply(`💬 <b>Цитата розробника:</b>\n\n${quote}`, { parse_mode: 'HTML' });
                return;
            }
        }
        await ctx.reply('⚠️ Усі цитати вже використовувались 😅');
    });
});

bot.hears('🧮 Зробити задачу', ctx => {
    protectedGeneration(ctx, 'task', async (ctx) => {
        await ctx.reply('⚙️ Генерую цікаву JS-задачу...');

        const prompt = `
    Створи коротку практичну задачу з JavaScript українською.
    Формат:
    🧩 Задача (масиви, логіка, дати): ...
    📦 Приклад:
    \`\`\`js
    const arr = [...]
    // приклад виклику
    \`\`\`
    🔍 Уточнення: ...
    Має бути унікальна задача без повторів, до 1000 символів.
    `;
        for (let i = 0; i < 10; i++) {
            const res = await model.generateContent([prompt]);
            const task = cleanPostText(getText(res));
            if (task && !isDuplicateIdea(task)) {
                saveUsedTopic(task);
                await ctx.reply(task);
                return;
            }
        }
        await ctx.reply('⚠️ Не вдалося створити унікальну задачу 😅');
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
