import dotenv from 'dotenv';
import fs from 'fs';
import { Telegraf, Markup } from 'telegraf';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

const USED_TOPICS_FILE = './used_topics.json';
let usedTopics = [];

if (fs.existsSync(USED_TOPICS_FILE)) {
    try {
        usedTopics = JSON.parse(fs.readFileSync(USED_TOPICS_FILE, 'utf-8'));
    } catch {
        usedTopics = [];
    }
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
    if (usedTopics.length > 500) usedTopics = usedTopics.slice(-500);
    fs.writeFileSync(USED_TOPICS_FILE, JSON.stringify(usedTopics, null, 2));
}

function cleanPostText(text) {
    return text.replace(/[*_`<>]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ==== Команда /start ====
bot.start(async ctx => {
    const keyboard = Markup.keyboard([
        ['🧠 Сгенерувати блог'],
        ['🧩 Сгенерувати опитування'],
        ['🎭 Сгенерувати цитату'],
        ['🧮 Зробити задачу']
    ]).resize();

    await ctx.reply('Привіт! 👋 Обери, що хочеш згенерувати:', keyboard);
});

// ==== 🧠 БЛОГ ====
bot.hears('🧠 Сгенерувати блог', async ctx => {
    try {
        await ctx.reply('🌀 Генерую унікальну ідею для блогу...');

        let blogIdea = '';
        let attempts = 0;

        while (attempts < 8) {
            const ideaPrompt = `
      Придумай одну коротку, креативну ідею українською для телеграм-блогу про:
      - роботу розробника, життя у сфері IT, мотивацію, технології, AI або Node.js.
      Формат:
      - лише 1 ідея (жодних списків)
      - до 70 символів
      - обов'язково почни з емодзі
      - не додавай лапки
      `;
            const ideaResult = await model.generateContent([{ role: 'user', parts: [{ text: ideaPrompt }] }]);
            const idea = ideaResult.response?.text?.().trim();

            if (idea && !isDuplicateIdea(idea)) {
                blogIdea = idea;
                saveUsedTopic(idea);
                break;
            }
            attempts++;
        }

        if (!blogIdea) {
            await ctx.reply('⚠️ Не вдалося знайти нову тему, усі ідеї вже були 😅');
            return;
        }

        await ctx.reply(`✨ <b>Ідея для блогу:</b>\n\n${blogIdea}`, { parse_mode: 'HTML' });
        await ctx.reply('✍️ Генерую повний блог-пост...');

        const postPrompt = `
    Створи телеграм-пост українською (1500–2000 символів)
    у стилі сучасного IT-блогу. Тема: "${blogIdea}".
    Пиши цікаво, з емоціями, без води, у форматі кількох абзаців.
    Не використовуй лапки, не додавай маркери чи заголовки.
    `;

        const postResult = await model.generateContent([{ role: 'user', parts: [{ text: postPrompt }] }]);
        const rawText = postResult.response?.text?.();

        if (!rawText) {
            await ctx.reply('⚠️ Модель не повернула текст. Спробуй ще раз.');
            return;
        }

        const finalText = cleanPostText(rawText);
        await ctx.reply(finalText);
    } catch (err) {
        console.error('❌ Помилка в генерації блогу:', err);
        await ctx.reply('⚠️ Помилка при генерації блогу. Спробуй ще раз.');
    }
});

// ==== 🧩 ОПИТУВАННЯ ====
bot.hears('🧩 Сгенерувати опитування', async ctx => {
    try {
        await ctx.reply('🔄 Генерую унікальну фронтенд-вікторину...');

        let question = '';
        let options = [];
        let correct = 0;
        let explanation = '';
        let attempts = 0;

        while (attempts < 8) {
            const quizPrompt = `
      Створи одне складне запитання з фронтенду (HTML, CSS, JavaScript або Vue.js).
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

            const quizResult = await model.generateContent([{ role: 'user', parts: [{ text: quizPrompt }] }]);
            const text = quizResult.response?.text?.();

            const questionMatch = text?.match(/^QUESTION:\s*(.+?)\n/ms);
            const optionsMatch = text?.match(/OPTIONS:([\s\S]*?)\nCORRECT:/ms);
            const correctMatch = text?.match(/CORRECT:\s*(\d)/i);
            const explanationMatch = text?.match(/EXPLANATION:\s*(.+)/is);

            if (!questionMatch || !optionsMatch || !correctMatch) {
                attempts++;
                continue;
            }

            const q = questionMatch[1].trim();
            if (isDuplicateIdea(q)) {
                attempts++;
                continue;
            }

            question = q;
            saveUsedTopic(q);
            options = optionsMatch[1]
                .trim()
                .split(/\d\)\s*/)
                .filter(Boolean)
                .map(o => o.trim().slice(0, 70));

            correct = Number(correctMatch[1]) - 1;
            explanation = explanationMatch ? explanationMatch[1].trim().slice(0, 200) : '';
            break;
        }

        if (!question) {
            await ctx.reply('⚠️ Не вдалося знайти нове запитання 😅');
            return;
        }

        await ctx.reply('✅ Питання готове. Надсилаю опитування...');

        await ctx.telegram.sendPoll(ctx.chat.id, question, options, {
            type: 'quiz',
            correct_option_id: correct,
            explanation: explanation || 'Відповідь пояснюється у наступному пості!',
            is_anonymous: true
        });

        await ctx.reply('✍️ Генерую пояснювальний пост...');

        const postPrompt = `
    Створи український телеграм-пост (700–1200 символів)
    для теми "${question}" у стилі короткого навчального поста.
    `;

        const postResult = await model.generateContent([{ role: 'user', parts: [{ text: postPrompt }] }]);
        const postText = cleanPostText(postResult.response?.text?.() || '');
        if (postText) await ctx.reply(postText);
    } catch (err) {
        console.error('❌ Помилка в опитуванні:', err);
        await ctx.reply('⚠️ Помилка при генерації опитування. Спробуй ще раз.');
    }
});

// ==== 🎭 ЦИТАТА ====
bot.hears('🎭 Сгенерувати цитату', async ctx => {
    try {
        await ctx.reply('😎 Генерую настрій розробника...');

        const quotePrompt = `
    Придумай коротку дотепну цитату українською (до 200 символів)
    про життя або філософію розробника.
    Без лапок, лише текст у стилі Telegram, з емодзі.
    `;

        let quote = '';
        let attempts = 0;

        while (attempts < 8) {
            const quoteResult = await model.generateContent([{ role: 'user', parts: [{ text: quotePrompt }] }]);
            const raw = quoteResult.response?.text?.()?.trim();
            if (raw && !isDuplicateIdea(raw)) {
                quote = cleanPostText(raw);
                saveUsedTopic(quote);
                break;
            }
            attempts++;
        }

        if (!quote) {
            await ctx.reply('⚠️ Усі цитати вже використовувались 😅');
            return;
        }

        await ctx.reply(`💬 <b>Цитата розробника:</b>\n\n${quote}`, { parse_mode: 'HTML' });
    } catch (err) {
        console.error('❌ Помилка в цитаті:', err);
        await ctx.reply('⚠️ Помилка при генерації цитати. Спробуй ще раз.');
    }
});

// ==== 🧮 ЗАДАЧА ====
bot.hears('🧮 Зробити задачу', async ctx => {
    try {
        await ctx.reply('⚙️ Генерую цікаву JS-задачу...');

        const taskPrompt = `
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

        let task = '';
        let attempts = 0;

        while (attempts < 8) {
            const result = await model.generateContent([{ role: 'user', parts: [{ text: taskPrompt }] }]);
            const raw = result.response?.text?.();
            if (raw && !isDuplicateIdea(raw)) {
                task = cleanPostText(raw);
                saveUsedTopic(task);
                break;
            }
            attempts++;
        }

        if (!task) {
            await ctx.reply('⚠️ Не вдалося створити унікальну задачу 😅');
            return;
        }

        await ctx.reply(task);
    } catch (err) {
        console.error('❌ Помилка в задачі:', err);
        await ctx.reply('⚠️ Помилка при генерації задачі. Спробуй ще раз.');
    }
});

// ==== Запуск бота ====
bot.launch();
console.log('✅ Бот запущений і працює стабільно!');
