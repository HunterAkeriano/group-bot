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
    if (usedTopics.length > 500) {
        usedTopics = usedTopics.slice(-500);
    }
    fs.writeFileSync(USED_TOPICS_FILE, JSON.stringify(usedTopics, null, 2));
}

const activeGenerations = new Map();

function protectedGeneration(ctx, type, generator) {
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    if (activeGenerations.has(chatId)) {
        if (activeGenerations.get(chatId).messageId === messageId) {
            return;
        }
        ctx.reply('⏳ **УВАГА!** Попередня генерація ще не завершена. Зачекай ✋', { parse_mode: 'Markdown' });
        return;
    }

    activeGenerations.set(chatId, { type, messageId, startTime: Date.now() });

    setTimeout(async () => {
        try {
            await generator(ctx);
        } catch (error) {
            ctx.reply('⚠️ Критична помишка. Спробуй ще раз.');
        } finally {
            const currentData = activeGenerations.get(chatId);
            if (currentData && currentData.messageId === messageId) {
                activeGenerations.delete(chatId);
            }
        }
    }, 1);
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

bot.hears('🧠 Сгенерувати блог', ctx => {
    protectedGeneration(ctx, 'blog', async (ctx) => {
        const loadingMessage = await ctx.reply('🌀 Генерую ідею та повний блог-пост...');

        let fullResult = '';
        let attempts = 0;

        try {
            while (attempts < 10) {
                const combinedPrompt = `
                Створи одразу ідею і повний блог-пост українською (1500–2200 символів)
                у стилі сучасного IT-блогу про: роботу розробника, життя у сфері IT, мотивацію, технології, AI або Node.js.

                Формат відповіді:
                Ідея: ... (коротка ідея, 1 рядок, почни з емодзі)
                Пост: ... (весь блог-пост)
                `;

                const result = await model.generateContent(combinedPrompt);
                fullResult = result.response.text();

                const ideaMatch = fullResult.match(/Ідея:\s*(.+?)\n/i);
                if (ideaMatch) {
                    const idea = ideaMatch[1].trim();
                    if (!isDuplicateIdea(idea)) {
                        saveUsedTopic(idea);
                        break;
                    }
                }
                attempts++;
            }
        } catch (error) {
            await ctx.telegram.editMessageText(ctx.chat.id, loadingMessage.message_id, undefined, `⚠️ Помилка генерації [1/1]. Спробуй ще раз. Деталі: ${error.message}`);
            return;
        }

        if (!fullResult) {
            await ctx.telegram.editMessageText(ctx.chat.id, loadingMessage.message_id, undefined, '⚠️ Не вдалося згенерувати новий пост, усі ідеї вже були 😅');
            return;
        }

        const ideaMatch = fullResult.match(/Ідея:\s*(.+?)\n/i);
        const postMatch = fullResult.match(/Пост:\s*([\s\S]+)/i);

        if (ideaMatch && postMatch) {
            const blogIdea = ideaMatch[1].trim();
            const rawPost = postMatch[1].trim();
            const styledPost = cleanPostText(rawPost);

            await ctx.telegram.editMessageText(ctx.chat.id, loadingMessage.message_id, undefined, `✨ <b>Ідея для блогу:</b>\n\n${blogIdea}`, { parse_mode: 'HTML' });
            await ctx.reply(styledPost);
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, loadingMessage.message_id, undefined, '⚠️ Помилка форматування відповіді від AI. Спробуй ще раз.');
        }
    });
});

bot.hears('🧩 Сгенерувати опитування', ctx => {
    protectedGeneration(ctx, 'quiz', async (ctx) => {
        const loadingMessage = await ctx.reply('🔄 Генерую унікальну фронтенд-вікторину та пояснення...');

        let question = '';
        let options = [];
        let correct = 0;
        let explanation = '';
        let postText = '';
        let attempts = 0;

        try {
            while (attempts < 10) {
                const combinedQuizPrompt = `
                Створи одне складне запитання з фронтенду (HTML, CSS, JavaScript або Vue.js), а також повний пояснювальний пост для Telegram (700-1200 символів).

                Формат відповіді:
                QUESTION: ...
                OPTIONS:
                1) ...
                2) ...
                3) ...
                4) ...
                CORRECT: X
                EXPLANATION: ...
                POST: ...
                `;

                const quizResult = await model.generateContent(combinedQuizPrompt);
                const text = quizResult.response.text();

                const questionMatch = text.match(/^QUESTION:\s*(.+?)\n/ms);
                const optionsMatch = text.match(/OPTIONS:([\s\S]*?)\nCORRECT:/ms);
                const correctMatch = text.match(/CORRECT:\s*(\d)/i);
                const explanationMatch = text.match(/EXPLANATION:\s*(.+)/is);
                const postMatch = text.match(/POST:\s*([\s\S]+)/i);

                if (!questionMatch || !optionsMatch || !correctMatch || !postMatch) {
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
                postText = cleanPostText(postMatch[1].trim());
                break;
            }
        } catch (error) {
            await ctx.telegram.editMessageText(ctx.chat.id, loadingMessage.message_id, undefined, `⚠️ Помилка генерації [1/1]. Спробуй ще раз. Деталі: ${error.message}`);
            return;
        }


        if (!question) {
            await ctx.telegram.editMessageText(ctx.chat.id, loadingMessage.message_id, undefined, '⚠️ Не вдалося знайти нове запитання 😅');
            return;
        }

        await ctx.telegram.editMessageText(ctx.chat.id, loadingMessage.message_id, undefined, `✅ Питання готове. Надсилаю опитування та пояснення...`);

        try {
            await ctx.telegram.sendPoll(ctx.chat.id, question, options, {
                type: 'quiz',
                correct_option_id: correct,
                explanation: explanation || 'Відповідь пояснюється у наступному пості!',
                is_anonymous: true
            });
        } catch (error) {
            await ctx.reply('⚠️ Помилка при надсиланні опитування Telegram. Спробуй ще раз.');
            return;
        }

        try {
            await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
            await ctx.telegram.sendMessage(ctx.chat.id, postText);
        } catch (error) {
            await ctx.reply(`⚠️ Помилка при надсиланні пояснювального поста: ${error.message}. Спробуй ще раз.`);
        }
    });
});

bot.hears('🎭 Сгенерувати цитату', ctx => {
    protectedGeneration(ctx, 'quote', async (ctx) => {
        const loadingMessage = await ctx.reply('😎 Генерую настрій розробника...');

        const quotePrompt = `
        Придумай коротку дотепну цитату українською (до 200 символів)
        про життя або філософію розробника.
        Без лапок, лише текст у стилі Telegram, з емодзі.
        `;

        try {
            let attempts = 0;
            while (attempts < 10) {
                const quoteResult = await model.generateContent(quotePrompt);
                let quote = quoteResult.response.text().trim();
                quote = cleanPostText(quote).replace(/\n{2,}/g, '\n');

                if (!isDuplicateIdea(quote)) {
                    saveUsedTopic(quote);
                    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
                    await ctx.reply(`💬 <b>Цитата розробника:</b>\n\n${quote}`, { parse_mode: 'HTML' });
                    return;
                }
                attempts++;
            }
        } catch (error) {
            await ctx.telegram.editMessageText(ctx.chat.id, loadingMessage.message_id, undefined, `⚠️ Помилка при генерації цитати: ${error.message}. Спробуй ще раз.`);
            return;
        }

        await ctx.telegram.editMessageText(ctx.chat.id, loadingMessage.message_id, undefined, '⚠️ Усі цитати вже використовувались 😅');
    });
});

bot.hears('🧮 Зробити задачу', ctx => {
    protectedGeneration(ctx, 'task', async (ctx) => {
        const loadingMessage = await ctx.reply('⚙️ Генерую цікаву JS-задачу...');

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

        try {
            let attempts = 0;
            while (attempts < 10) {
                const result = await model.generateContent(taskPrompt);
                const task = cleanPostText(result.response.text());

                if (!isDuplicateIdea(task)) {
                    saveUsedTopic(task);
                    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
                    await ctx.reply(task);
                    return;
                }
                attempts++;
            }
        } catch (error) {
            await ctx.telegram.editMessageText(ctx.chat.id, loadingMessage.message_id, undefined, `⚠️ Помилка при генерації задачі: ${error.message}. Спробуй ще раз.`);
            return;
        }

        await ctx.telegram.editMessageText(ctx.chat.id, loadingMessage.message_id, undefined, '⚠️ Не вдалося створити унікальну задачу 😅');
    });
});

setInterval(() => {
    const now = Date.now();
    const timeout = 5 * 60 * 1000;

    for (const [chatId, data] of activeGenerations.entries()) {
        if (now - data.startTime > timeout) {
            activeGenerations.delete(chatId);
        }
    }
}, 60000);

bot.launch();
console.log('✅ Бот запущений!');