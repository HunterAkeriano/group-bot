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
    fs.writeFileSync(USED_TOPICS_FILE, JSON.stringify(usedTopics, null, 2));
}

const activeGenerations = new Map(); // Змінено на Map для кращого відстеження

bot.start(async ctx => {
    const keyboard = Markup.keyboard([
        ['🧠 Сгенерувати блог'],
        ['🧩 Сгенерувати опитування'],
        ['🎭 Сгенерувати цитату'],
        ['🧮 Зробити задачу']
    ]).resize();

    await ctx.reply('Привіт! 👋 Обери, що хочеш згенерувати:', keyboard);
});

bot.hears('🧠 Сгенерувати блог', async ctx => {
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    // КРИТИЧНО: Перевіряємо чи вже є активна генерація
    if (activeGenerations.has(chatId)) {
        await ctx.reply('⏳ Зачекай, попередня генерація ще не завершилася!');
        return; // ВАЖЛИВО: зупиняємо виконання
    }

    // Додаємо з унікальним ідентифікатором
    activeGenerations.set(chatId, { type: 'blog', messageId, startTime: Date.now() });

    try {
        await ctx.reply('🌀 Генерую унікальну ідею для блогу...');

        let blogIdea = '';
        let attempts = 0;

        while (attempts < 10) {
            const ideaPrompt = `
            Придумай одну коротку, креативну ідею українською для телеграм-блогу про:
            - роботу розробника, життя у сфері IT, мотивацію, технології, AI або Node.js.
            Формат:
            - лише 1 ідея (жодних списків)
            - до 70 символів
            - обов'язково почни з емодзі
            - не додавай лапки, не пиши слово "Ідея"
            `;
            const ideaResult = await model.generateContent(ideaPrompt);
            const idea = ideaResult.response.text().trim();

            if (!isDuplicateIdea(idea)) {
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
        Створи великий телеграм-пост українською (1500–2200 символів)
        у стилі сучасного IT-блогу.
        Тема: "${blogIdea}"
        Формат як приклад 👇
        💡 Баг — то квест. Розв'яжи та прокачай скіл!
        🐞 Знайшов баг? Не панікуй! ...
        `;

        const postResult = await model.generateContent(postPrompt);
        let styledPost = postResult.response.text();
        styledPost = styledPost.replace(/[*_`<>]/g, '').replace(/\n{3,}/g, '\n\n').trim();
        await ctx.reply(styledPost);

    } catch (error) {
        console.error('Критична помилка генерації блогу:', error);
        await ctx.reply('⚠️ Критична помилка. Спробуй ще раз.');
    } finally {
        // КРИТИЧНО: завжди видаляємо після завершення
        activeGenerations.delete(chatId);
        console.log(`✅ Генерація блогу завершена для чату ${chatId}`);
    }
});

bot.hears('🧩 Сгенерувати опитування', async ctx => {
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    if (activeGenerations.has(chatId)) {
        await ctx.reply('⏳ Зачекай, попередня генерація ще не завершилася!');
        return;
    }

    activeGenerations.set(chatId, { type: 'quiz', messageId, startTime: Date.now() });

    try {
        await ctx.reply('🔄 Генерую унікальну фронтенд-вікторину...');

        let question = '';
        let options = [];
        let correct = 0;
        let explanation = '';
        let attempts = 0;

        while (attempts < 10) {
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

            const quizResult = await model.generateContent(quizPrompt);
            const text = quizResult.response.text();
            const questionMatch = text.match(/QUESTION:\s*(.+)/i);
            const optionsMatch = text.match(/OPTIONS:[\s\S]*?(?=CORRECT:)/i);
            const correctMatch = text.match(/CORRECT:\s*(\d)/i);
            const explanationMatch = text.match(/EXPLANATION:\s*(.+)/i);

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
            options = optionsMatch[0]
                .replace('OPTIONS:', '')
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

        await ctx.telegram.sendPoll(ctx.chat.id, question, options, {
            type: 'quiz',
            correct_option_id: correct,
            explanation,
            is_anonymous: true
        });

        const postPrompt = `
        Створи український телеграм-пост (700–1200 символів)
        для теми "${question}" у стилі короткого навчального поста.
        `;
        const postResult = await model.generateContent(postPrompt);
        let styledPost = postResult.response.text();
        styledPost = styledPost.replace(/[*_`<>]/g, '').replace(/\n{3,}/g, '\n\n').trim();
        await ctx.telegram.sendMessage(ctx.chat.id, styledPost);

    } catch (error) {
        console.error('Критична помилка генерації опитування:', error);
        await ctx.reply('⚠️ Критична помилка. Спробуй ще раз.');
    } finally {
        activeGenerations.delete(chatId);
        console.log(`✅ Генерація опитування завершена для чату ${chatId}`);
    }
});

bot.hears('🎭 Сгенерувати цитату', async ctx => {
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    if (activeGenerations.has(chatId)) {
        await ctx.reply('⏳ Зачекай, попередня генерація ще не завершилася!');
        return;
    }

    activeGenerations.set(chatId, { type: 'quote', messageId, startTime: Date.now() });

    try {
        await ctx.reply('😎 Генерую настрій розробника...');

        const quotePrompt = `
        Придумай коротку дотепну цитату українською (до 200 символів)
        про життя або філософію розробника.
        Без лапок, лише текст у стилі Telegram, з емодзі.
        `;

        let attempts = 0;
        while (attempts < 10) {
            const quoteResult = await model.generateContent(quotePrompt);
            let quote = quoteResult.response.text().trim();
            quote = quote.replace(/[*_`<>]/g, '').replace(/\n{2,}/g, '\n').trim();

            if (!isDuplicateIdea(quote)) {
                saveUsedTopic(quote);
                await ctx.reply(`💬 <b>Цитата розробника:</b>\n\n${quote}`, { parse_mode: 'HTML' });
                return;
            }
            attempts++;
        }

        await ctx.reply('⚠️ Усі цитати вже використовувались 😅');

    } catch (error) {
        console.error('Критична помилка генерації цитати:', error);
        await ctx.reply('⚠️ Критична помилка. Спробуй ще раз.');
    } finally {
        activeGenerations.delete(chatId);
        console.log(`✅ Генерація цитати завершена для чату ${chatId}`);
    }
});

bot.hears('🧮 Зробити задачу', async ctx => {
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    if (activeGenerations.has(chatId)) {
        await ctx.reply('⏳ Зачекай, попередня генерація ще не завершилася!');
        return;
    }

    activeGenerations.set(chatId, { type: 'task', messageId, startTime: Date.now() });

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

        let attempts = 0;
        while (attempts < 10) {
            const result = await model.generateContent(taskPrompt);
            let task = result.response.text().trim();
            task = task.replace(/[*_`<>]/g, '').replace(/\n{3,}/g, '\n\n').trim();

            if (!isDuplicateIdea(task)) {
                saveUsedTopic(task);
                await ctx.reply(task);
                return;
            }
            attempts++;
        }

        await ctx.reply('⚠️ Не вдалося створити унікальну задачу 😅');
    } catch (error) {
        console.error('Критична помилка генерації задачі:', error);
        await ctx.reply('⚠️ Критична помилка. Спробуй ще раз.');
    } finally {
        activeGenerations.delete(chatId);
        console.log(`✅ Генерація задачі завершена для чату ${chatId}`);
    }
});

// Таймаут для "застряглих" генерацій (якщо щось пішло не так)
setInterval(() => {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 хвилин

    for (const [chatId, data] of activeGenerations.entries()) {
        if (now - data.startTime > timeout) {
            console.log(`⚠️ Видалення застряглої генерації для чату ${chatId}`);
            activeGenerations.delete(chatId);
        }
    }
}, 60000); // Перевірка кожну хвилину

bot.launch();
console.log('✅ Бот запущений з виправленим антицикл-захистом!');