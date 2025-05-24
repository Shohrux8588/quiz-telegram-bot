require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const ADMIN_ID = Number(process.env.ADMIN_ID);

// Store answers: { testId: { "1": "a", "2": "b", ... } }
const testAnswers = {};

// Track user attempts: { userId: { testId: { count: number, last: timestamp } } }
const userAttempts = {};

// Leaderboard storage: { testId: [{ userId, username, date, correct, total }] }
const leaderboard = {};

// Helper to parse the answer format
function parseAnswers(text) {
  // Remove spaces and newlines
  text = text.trim().replace(/\s+/g, '');
  // Match format: testid+1a2b3c... or testid+10a11b...
  const match = /^(\d+)\+([0-9a-zA-Z]+)$/.exec(text);
  if (!match) return null;
  const testId = match[1];
  const rest = match[2];

  // Find all question-answer pairs: one or two digits followed by a single letter
  const pairs = rest.match(/(\d{1,2}[a-zA-Z])/g);
  if (!pairs) return null;
  const answers = {};
  for (const pair of pairs) {
    // Split multi-digit question number from answer
    const qMatch = /^(\d{1,2})([a-zA-Z])$/.exec(pair);
    if (!qMatch) return null;
    const q = qMatch[1];
    const a = qMatch[2].toLowerCase();
    answers[q] = a;
  }
  return { testId, answers };
}

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  // Ignore /start and /leaderboard here
  if (text.startsWith('/start') || text.startsWith('/leaderboard')) return;

  const parsed = parseAnswers(text);
  if (!parsed) {
    bot.sendMessage(chatId, "To'g'ri formatda yuboring!");
    return;
  }

  const { testId, answers } = parsed;

  if (userId === ADMIN_ID) {
    // Save answers
    testAnswers[testId] = answers;
    bot.sendMessage(chatId, `Test ${testId} uchun javoblar saqlandi.`);
  } else {
    // User: check if test exists
    if (!testAnswers[testId]) {
      bot.sendMessage(chatId, 'Test topilmadi!');
      return;
    }

    // User attempt tracking
    if (!userAttempts[userId]) userAttempts[userId] = {};
    if (!userAttempts[userId][testId]) userAttempts[userId][testId] = { count: 0, last: 0 };

    const now = Date.now();
    const attempt = userAttempts[userId][testId];

    // 5 minutes = 300000 ms
    if (attempt.count >= 3) {
      const wait = 300000 - (now - attempt.last);
      if (wait > 0) {
        const min = Math.ceil(wait / 60000);
        bot.sendMessage(
          chatId,
          `Siz ushbu testga 3 marta javob yubordingiz. Yangi javob uchun ${min} daqiqa kuting.`,
        );
        return;
      } else {
        // Reset after 5 minutes
        attempt.count = 0;
        attempt.last = 0;
      }
    }

    // If this is the first attempt after cooldown, set last to now
    if (attempt.count === 0) {
      attempt.last = now;
    }
    attempt.count++;

    // Check answers
    const correct = testAnswers[testId];
    let total = 0,
      right = 0;
    let resultMsg = `Test raqami - ${testId}\n`;
    for (const q in answers) {
      total++;
      const userAnswer = answers[q];
      if (correct[q] && userAnswer.length === 1 && correct[q] === userAnswer) {
        right++;
        resultMsg += `${q}. ${userAnswer} ✅\n`;
      } else {
        resultMsg += `${q}. ${userAnswer} ❌\n`;
      }
    }
    resultMsg += `\nNatija: ${right}/${total} to'g'ri`;
    bot.sendMessage(chatId, resultMsg);

    // Notify admin with user's full message
    const userDisplayName = msg.from.username
      ? `@${msg.from.username}`
      : `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || 'NoName';
    bot.sendMessage(
      ADMIN_ID,
      `Yangi javob!\nFoydalanuvchi: ${userDisplayName} (ID: ${userId})\nTest: ${testId}\nXabar: ${msg.text}`,
    );

    // Also send the checked result to admin
    bot.sendMessage(ADMIN_ID, `Natija (${userDisplayName}, ID: ${userId}):\n${resultMsg}`);

    // Save to leaderboard
    if (!leaderboard[testId]) leaderboard[testId] = [];
    leaderboard[testId].push({
      userId,
      username: msg.from.username,
      first_name: msg.from.first_name,
      last_name: msg.from.last_name,
      date: new Date(now).toLocaleString(),
      correct: right,
      total: total,
    });
  }
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // 1. Send channel invitation with hyperlink
  bot.sendMessage(
    chatId,
    "Tarix fanidan ko'proq materiallar bilan tanishish va testlar ishlash uchun <a href=\"https://t.me/afina_online_academy\">Afina Online Academy</a> kanalga a'zo bo'ling!",
    { parse_mode: 'HTML' },
  );

  // 2. Send instruction (admin or user)
  if (userId === ADMIN_ID) {
    bot.sendMessage(
      chatId,
      'Yangi test raqami va javoblarni quyidagi formatda kiriting:\n123+1a2b3c\nBu yerda: 123 - test raqami, 1 - savol raqami, a - javob.',
    );
  } else {
    bot.sendMessage(
      chatId,
      'Test raqami va javoblarini quyidagi formatda yuboring:\n123+1a2b3c\nBu yerda: 123 - test raqami, 1 - savol raqami, a - javob.',
    );
  }
});

// Leaderboard command for admin
bot.onText(/\/leaderboard/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (userId !== ADMIN_ID) return;

  let message = 'Leaderboard:\n';
  for (const testId in leaderboard) {
    message += `\nTest ${testId}:\n`;

    // Map to store best result per user
    const bestResults = {};

    leaderboard[testId].forEach((entry) => {
      if (
        !bestResults[entry.userId] ||
        entry.correct > bestResults[entry.userId].correct ||
        (entry.correct === bestResults[entry.userId].correct &&
          entry.total > bestResults[entry.userId].total)
      ) {
        bestResults[entry.userId] = entry;
      }
    });

    // Convert to array and sort by correct answers (descending), then by total (descending)
    const sorted = Object.values(bestResults).sort((a, b) => {
      if (b.correct !== a.correct) return b.correct - a.correct;
      return b.total - a.total;
    });

    if (sorted.length === 0) {
      message += '   Hali hech kim test ishlamagan.\n';
    } else {
      sorted.forEach((entry, idx) => {
        // Prefer username, then first+last name, then 'NoName'
        let displayName = entry.username;
        if (!displayName) {
          if (entry.first_name || entry.last_name) {
            displayName = `${entry.first_name || ''} ${entry.last_name || ''}`.trim();
          } else {
            displayName = 'NoName';
          }
        }
        message += `${idx + 1}. 👤 ${displayName} (ID: ${entry.userId})\n   📅 ${
          entry.date
        }\n   ✅ Natija: ${entry.correct}/${entry.total} to'g'ri\n`;
      });
    }
  }
  if (message === 'Leaderboard:\n') message += 'Hali hech kim test ishlamagan.';
  bot.sendMessage(chatId, message);
});
