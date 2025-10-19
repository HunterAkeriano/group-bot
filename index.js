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

bot.hears('🧠 Сгенерувати блог', async (ctx) => {
    // Негайно повертаємо Promise, щоб уникнути дублювання
    Promise.resolve().then(async () => {
        try {
            await ctx.reply('🌀 Генерую унікальну ідею для блогу...');

            let blogIdea = '';
            let attempts = 0;

            try {
                while (attempts < 10) {
                    const ideaPrompt = `
                    Придумай одну коротку, креативну ідею українською для телеграм-блогу про:
                    - роботу розробника, життя у сфері IT, мотивацію, технології, AI або Node.js.
                    Формат:
                    - лише 1 ідея (жодних списків)
                    - до 70 символів
                    - обов'язково почни з емодзі
                    - не додавай лапки
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
            } catch (error) {
                console.error('Помилка генерації ідеї:', error);
                await ctx.reply('⚠️ Помилка [1/2] при генерації ідеї. Спробуй ще раз.');
                return;
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
            `;

            try {
                const postResult = await model.generateContent(postPrompt);
                const styledPost = cleanPostText(postResult.response.text());
                await ctx.reply(styledPost);
            } catch (error) {
                console.error('Помилка генерації блог-поста:', error);
                await ctx.reply('⚠️ Помилка [2/2] при генерації самого блог-поста. Спробуй ще раз.');
            }
        } catch (globalError) {
            console.error('Глобальна помилка в блоці Блог:', globalError);
            // Це обробник на випадок, якщо щось пішло не так між етапами
            if (globalError.message.includes('message is not modified')) {
                return;
            }
            await ctx.reply('⚠️ Критична помилка у процесі. Спробуй ще раз.');
        }
    });
});

bot.hears('🧩 Сгенерувати опитування', async (ctx) => {
    Promise.resolve().then(async () => {
        try {
            await ctx.reply('🔄 Генерую унікальну фронтенд-вікторину...');

            let question = '';
            let options = [];
            let correct = 0;
            let explanation = '';
            let postText = '';
            let attempts = 0;

            try {
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

                    const questionMatch = text.match(/^QUESTION:\s*(.+?)\n/ms);
                    const optionsMatch = text.match(/OPTIONS:([\s\S]*?)\nCORRECT:/ms);
                    const correctMatch = text.match(/CORRECT:\s*(\d)/i);
                    const explanationMatch = text.match(/EXPLANATION:\s*(.+)/is);

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
            } catch (error) {
                console.error('Помилка генерації запитання:', error);
                await ctx.reply('⚠️ Помилка [1/3] при генерації запитання для опитування. Спробуй ще раз.');
                return;
            }

            if (!question) {
                await ctx.reply('⚠️ Не вдалося знайти нове запитання 😅');
                return;
            }

            await ctx.reply('✅ Питання готове. Надсилаю опитування...');

            try {
                await ctx.telegram.sendPoll(ctx.chat.id, question, options, {
                    type: 'quiz',
                    correct_option_id: correct,
                    explanation: explanation || 'Відповідь пояснюється у наступному пості!',
                    is_anonymous: true
                });
            } catch (error) {
                console.error('Помилка надсилання опитування:', error);
                await ctx.reply('⚠️ Помилка [2/3] при надсиланні опитування Telegram. Спробуй ще раз.');
                return;
            }

            await ctx.reply('✍️ Генерую пояснювальний пост...');

            const postPrompt = `
            Створи український телеграм-пост (700–1200 символів)
            для теми "${question}" у стилі короткого навчального поста.
            `;

            try {
                const postResult = await model.generateContent(postPrompt);
                postText = cleanPostText(postResult.response.text());
                await ctx.telegram.sendMessage(ctx.chat.id, postText);
            } catch (error) {
                console.error('Помилка генерації пояснювального поста:', error);
                await ctx.reply('⚠️ Помилка [3/3] при генерації пояснювального поста для опитування. Спробуй ще раз.');
            }
        } catch (globalError) {
            console.error('Глобальна помилка в блоці Опитування:', globalError);
            await ctx.reply('⚠️ Критична помилка у процесі. Спробуй ще раз.');
        }
    });
});

bot.hears('🎭 Сгенерувати цитату', async (ctx) => {
    Promise.resolve().then(async () => {
        try {
            await ctx.reply('😎 Генерую настрій розробника...');

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
                        await ctx.reply(`💬 <b>Цитата розробника:</b>\n\n${quote}`, { parse_mode: 'HTML' });
                        return;
                    }
                    attempts++;
                }
            } catch (error) {
                console.error('Помилка генерації цитати:', error);
                await ctx.reply('⚠️ Помилка при генерації цитати. Спробуй ще раз.');
                return;
            }

            await ctx.reply('⚠️ Усі цитати вже використовувались 😅');
        } catch (globalError) {
            console.error('Глобальна помилка в блоці Цитата:', globalError);
            await ctx.reply('⚠️ Критична помилка у процесі. Спробуй ще раз.');
        }
    });
});

bot.hears('🧮 Зробити задачу', async (ctx) => {
    Promise.resolve().then(async () => {
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

            try {
                let attempts = 0;
                while (attempts < 10) {
                    const result = await model.generateContent(taskPrompt);
                    task = cleanPostText(result.response.text());

                    if (!isDuplicateIdea(task)) {
                        saveUsedTopic(task);
                        break;
                    }
                    attempts++;
                }
            } catch (error) {
                console.error('Помилка генерації задачі:', error);
                await ctx.reply('⚠️ Помилка [1/2] при генерації задачі. Спробуй ще раз.');
                return;
            }

            if (!task) {
                await ctx.reply('⚠️ Не вдалося створити унікальну задачу 😅');
                return;
            }

            await ctx.reply('✅ Задача згенерована. Надсилаю...');

            try {
                await ctx.reply(task);
            } catch (error) {
                console.error('Помилка надсилання задачі:', error);
                await ctx.reply('⚠️ Помилка [2/2] при надсиланні задачі. Спробуй ще раз.');
            }
        } catch (globalError) {
            console.error('Глобальна помилка в блоці Задача:', globalError);
            await ctx.reply('⚠️ Критична помилка у процесі. Спробуй ще раз.');
        }
    });
});

bot.launch();
console.log('✅ Бот запущений!');