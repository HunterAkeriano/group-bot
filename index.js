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

function saveUsedTopic(topic) {
    usedTopics.push(topic);
    fs.writeFileSync(USED_TOPICS_FILE, JSON.stringify(usedTopics, null, 2));
}

bot.start(async ctx => {
    const keyboard = Markup.keyboard([
        ['🧠 Сгенерувати блог'],
        ['🧩 Сгенерувати опитування'],
        ['🎭 Сгенерувати цитату']
    ]).resize();

    await ctx.reply('Привіт! 👋 Обери, що хочеш згенерувати:', keyboard);
});

// === Генерація блогу ===
bot.hears('🧠 Сгенерувати блог', async ctx => {
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
        - обов’язково почни з емодзі
        - не додавай лапки, не пиши слово “Ідея”
        `;

        const ideaResult = await model.generateContent(ideaPrompt);
        const idea = ideaResult.response.text().trim();

        if (!usedTopics.includes(idea)) {
            blogIdea = idea;
            saveUsedTopic(idea);
            break;
        }
        attempts++;
    }

    if (!blogIdea) {
        return ctx.reply('⚠️ Не вдалося знайти нову тему, усі ідеї вже були 😅');
    }

    await ctx.reply(`✨ <b>Ідея для блогу:</b>\n\n${blogIdea}`, { parse_mode: 'HTML' });
    await ctx.reply('✍️ Генерую повний блог-пост...');

    const postPrompt = `
    Створи великий телеграм-пост українською (обсяг 1500–2200 символів) у стилі сучасного IT-блогу.
    Тема: "${blogIdea}"
    Формат має бути схожим на цей приклад 👇
    💡 Баг — то квест. Розв’яжи та прокачай скіл!
    🐞 Знайшов баг? Не панікуй! Це не кінець світу, а початок нового квесту.
    🕵️‍♂️ Уяви себе детективом. Розслідуй. Шукай підказки.
    🧰 Розбий проблему на частини, перевір кожен елемент.
    🏆 Вирішив баг? Ти прокачав свій скіл.
    📋 Вимоги:
    - стиль Telegram-блогу: з емодзі на початку кожного абзацу;
    - 6–9 абзаців, кожен з чітким змістом;
    - українською, без англіцизмів;
    - природна мова, легке читання, трохи мотивації або гумору;
    - фінальний абзац — позитивний висновок.
    Згенеруй повноцінний пост у цьому форматі для теми: "${blogIdea}"
    `;

    try {
        const postResult = await model.generateContent(postPrompt);
        let styledPost = postResult.response.text();
        styledPost = styledPost
            .replace(/[*_`<>]/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        await ctx.reply(styledPost, { parse_mode: undefined });
    } catch (err) {
        console.error(err);
        await ctx.reply('⚠️ Помилка при генерації блогу.');
    }
});

// === Генерація вікторини ===
bot.hears('🧩 Сгенерувати опитування', async ctx => {
    await ctx.reply('🔄 Генерую унікальну фронтенд-вікторину...');

    let question = '';
    let options = [];
    let correct = 0;
    let explanation = '';
    let attempts = 0;

    while (attempts < 10) {
        const quizPrompt = `
    Створи одне складне запитання з фронтенду (HTML, CSS, JavaScript або Vue.js) українською.
    Формат:
    QUESTION: коротке запитання (до 250 символів)
    OPTIONS:
    1) коротка відповідь (до 70 символів)
    2) коротка відповідь (до 70 символів)
    3) коротка відповідь (до 70 символів)
    4) коротка відповідь (до 70 символів)
    CORRECT: X (номер правильної відповіді)
    EXPLANATION: коротке пояснення (до 200 символів).
    Без Markdown чи HTML.
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
        if (usedTopics.includes(q)) {
            attempts++;
            continue;
        }

        question = q;
        saveUsedTopic(question);

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
        return ctx.reply('⚠️ Не вдалося знайти нове запитання, всі вже використовувались 😅');
    }

    const targetChatId = ctx.chat.id;

    try {
        await ctx.telegram.sendPoll(targetChatId, question, options, {
            type: 'quiz',
            correct_option_id: correct,
            explanation,
            is_anonymous: true
        });

        const postPrompt = `
    Створи український телеграм-пост (700–1200 символів) у форматі прикладу:
    • Заголовок із темою — жирний, з емодзі.
    • Підрозділи: “🤯 Уяви”, “💡 Що це”, “🛠 Як це працює / навіщо”, “⚠️ Підводні камені”, “✨ Висновок”.
    • Живий стиль, короткі речення, без води.
    • До 2 коротких прикладів коду (js або html).
    Згенеруй пост для теми: "${question}"
    `;

        const postResult = await model.generateContent(postPrompt);
        let styledPost = postResult.response.text();
        styledPost = styledPost
            .replace(/[*_`<>]/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        await ctx.telegram.sendMessage(targetChatId, styledPost, { parse_mode: undefined });
    } catch (err) {
        console.error(err);
        await ctx.reply('⚠️ Помилка при створенні опитування.');
    }
});

// === Генерація цитати ===
bot.hears('🎭 Сгенерувати цитату', async ctx => {
    await ctx.reply('😎 Генерую настрій розробника...');

    const quotePrompt = `
    Придумай коротку дотепну цитату українською (до 200 символів),
    яка описує настрій, життя або філософію розробника.
    Формат:
    - гумористична або саркастична
    - можна почати з емодзі
    - у стилі Telegram: коротко, з іронією або самоіронією
    - без лапок і без Markdown
    Приклади:
    💻 Код — як кава: гіркий, але без нього ніяк.
    🧠 Якщо працює — не чіпай. Якщо не працює — теж не чіпай, поки не вип’єш кави.
    🔥 Я не помиляюсь — я просто створюю нові фічі випадково.
    `;

    try {
        const quoteResult = await model.generateContent(quotePrompt);
        let quote = quoteResult.response.text().trim();

        quote = quote
            .replace(/[*_`<>]/g, '')
            .replace(/\n{2,}/g, '\n')
            .trim();

        await ctx.reply(`💬 <b>Цитата розробника:</b>\n\n${quote}`, { parse_mode: 'HTML' });
    } catch (err) {
        console.error(err);
        await ctx.reply('⚠️ Не вдалося створити цитату.');
    }
});

bot.launch();
console.log('✅ Бот запущений (з кнопками під полем вводу)!');
