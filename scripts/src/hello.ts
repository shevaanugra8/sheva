import TelegramBot from 'node-telegram-bot-api';

const token = '8089004934:AAE2oWrE2n4E1NsRlzqEtr8WiyzBapNC2OY';

const bot = new TelegramBot(token, { polling: true });

bot.onText(/\\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Bot Delivery Aktif 🚚');
});

console.log('Bot Telegram berjalan 🚚');