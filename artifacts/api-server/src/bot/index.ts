import TelegramBot from "node-telegram-bot-api";
import { logger } from "../lib/logger";
import { store, statusEmoji, type Role } from "./store";

function formatOrder(o: ReturnType<typeof store.getOrder>): string {
  if (!o) return "";
  return (
    `*Order #${o.id}*\n` +
    `📝 ${o.description}\n` +
    `${statusEmoji[o.status]} Status: *${o.status.replace("_", " ")}*\n` +
    `🕒 ${o.createdAt.toLocaleString()}`
  );
}

function customerKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "📦 New Order" }, { text: "📋 My Orders" }]],
    resize_keyboard: true,
  };
}

function sellerKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "📥 Incoming Orders" }, { text: "📋 Accepted Orders" }]],
    resize_keyboard: true,
  };
}

function driverKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "🚚 Available Deliveries" }, { text: "📋 My Deliveries" }]],
    resize_keyboard: true,
  };
}

function roleKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "👤 Customer" }, { text: "🏪 Seller" }, { text: "🚗 Driver" }]],
    resize_keyboard: true,
  };
}

function roleMenu(role: Role) {
  if (role === "customer") return customerKeyboard();
  if (role === "seller") return sellerKeyboard();
  return driverKeyboard();
}

export function startBot(): TelegramBot | null {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) {
    logger.warn(
      "TELEGRAM_BOT_TOKEN is not set — Telegram bot will not start. Set the environment variable and restart.",
    );
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });

  bot.on("polling_error", (err) => {
    logger.error({ err }, "Telegram polling error");
  });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const firstName = msg.from!.first_name ?? "there";
    const existing = store.getUser(userId);

    if (existing) {
      await bot.sendMessage(
        chatId,
        `Welcome back, *${firstName}*\\! You are registered as a *${existing.role}*\\.`,
        { parse_mode: "MarkdownV2", reply_markup: roleMenu(existing.role) },
      );
      return;
    }

    await bot.sendMessage(
      chatId,
      `👋 Welcome to the *Delivery Bot*, ${firstName}\\!\n\nPlease choose your role:`,
      { parse_mode: "MarkdownV2", reply_markup: roleKeyboard() },
    );
  });

  async function registerRole(
    msg: TelegramBot.Message,
    role: Role,
  ): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const existing = store.getUser(userId);

    if (existing) {
      await bot.sendMessage(
        chatId,
        `You already have the *${existing.role}* role\\.`,
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    const username =
      msg.from!.username ?? msg.from!.first_name ?? String(userId);
    store.registerUser(userId, username, role);
    logger.info({ userId, role }, "User registered");

    await bot.sendMessage(chatId, `✅ Registered as *${role}*\\!`, {
      parse_mode: "MarkdownV2",
      reply_markup: roleMenu(role),
    });
  }

  bot.onText(/^👤 Customer$/, (msg) => registerRole(msg, "customer"));
  bot.onText(/^🏪 Seller$/, (msg) => registerRole(msg, "seller"));
  bot.onText(/^🚗 Driver$/, (msg) => registerRole(msg, "driver"));

  async function requireRole(
    chatId: number,
    userId: number,
    role: Role,
  ): Promise<boolean> {
    const user = store.getUser(userId);
    if (!user) {
      await bot.sendMessage(chatId, "Please use /start to register first.");
      return false;
    }
    if (user.role !== role) {
      await bot.sendMessage(
        chatId,
        `This action is only available to *${role}s*\\.`,
        { parse_mode: "MarkdownV2" },
      );
      return false;
    }
    return true;
  }

  bot.onText(/^📦 New Order$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!(await requireRole(chatId, msg.from!.id, "customer"))) return;
    await bot.sendMessage(
      chatId,
      "Please send your order description\\.\nFormat: `/neworder <description>`\n\nExample: `/neworder 2x Pizza Margherita`",
      { parse_mode: "MarkdownV2" },
    );
  });

  bot.onText(/^\/neworder (.+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!(await requireRole(chatId, msg.from!.id, "customer"))) return;
    const description = match?.[1]?.trim();
    if (!description) {
      await bot.sendMessage(
        chatId,
        "Please provide an order description\\.\nExample: `/neworder 2x Pizza Margherita`",
        { parse_mode: "MarkdownV2" },
      );
      return;
    }
    const order = store.createOrder(msg.from!.id, description);
    logger.info({ orderId: order.id, customerId: msg.from!.id }, "Order created");
    await bot.sendMessage(
      chatId,
      `✅ Order *#${order.id}* placed\\!\n📝 ${escapeMarkdown(description)}\n\nWaiting for a seller to accept your order\\.`,
      { parse_mode: "MarkdownV2" },
    );
  });

  bot.onText(/^\/neworder$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!(await requireRole(chatId, msg.from!.id, "customer"))) return;
    await bot.sendMessage(
      chatId,
      "Please provide an order description\\.\nExample: `/neworder 2x Pizza Margherita`",
      { parse_mode: "MarkdownV2" },
    );
  });

  bot.onText(/^📋 My Orders$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!(await requireRole(chatId, msg.from!.id, "customer"))) return;
    const myOrders = store.getOrdersByCustomer(msg.from!.id);
    if (myOrders.length === 0) {
      await bot.sendMessage(
        chatId,
        "You have no orders yet\\. Tap *📦 New Order* to place one\\.",
        { parse_mode: "MarkdownV2" },
      );
      return;
    }
    const text = myOrders.map(formatOrder).join("\n\n─────────────\n\n");
    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  bot.onText(/^📥 Incoming Orders$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!(await requireRole(chatId, msg.from!.id, "seller"))) return;
    const pending = store.getPendingOrders();
    if (pending.length === 0) {
      await bot.sendMessage(
        chatId,
        "No pending orders at the moment\\. Check back soon\\!",
        { parse_mode: "MarkdownV2" },
      );
      return;
    }
    for (const order of pending) {
      await bot.sendMessage(chatId, formatOrder(order), {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Accept Order", callback_data: `accept_order:${order.id}` }],
          ],
        },
      });
    }
  });

  bot.onText(/^📋 Accepted Orders$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!(await requireRole(chatId, msg.from!.id, "seller"))) return;
    const myOrders = store.getOrdersBySeller(msg.from!.id);
    if (myOrders.length === 0) {
      await bot.sendMessage(chatId, "You have no accepted orders yet.");
      return;
    }
    const text = myOrders.map(formatOrder).join("\n\n─────────────\n\n");
    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  bot.onText(/^🚚 Available Deliveries$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!(await requireRole(chatId, msg.from!.id, "driver"))) return;
    const available = store.getAcceptedUnassignedOrders();
    if (available.length === 0) {
      await bot.sendMessage(
        chatId,
        "No deliveries available right now\\. Check back soon\\!",
        { parse_mode: "MarkdownV2" },
      );
      return;
    }
    for (const order of available) {
      await bot.sendMessage(chatId, formatOrder(order), {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚗 Claim Delivery", callback_data: `claim_order:${order.id}` }],
          ],
        },
      });
    }
  });

  bot.onText(/^📋 My Deliveries$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!(await requireRole(chatId, msg.from!.id, "driver"))) return;
    const deliveries = store.getOrdersByDriver(msg.from!.id);
    if (deliveries.length === 0) {
      await bot.sendMessage(
        chatId,
        "You have no active deliveries\\. Claim one via *🚚 Available Deliveries*\\.",
        { parse_mode: "MarkdownV2" },
      );
      return;
    }
    for (const order of deliveries) {
      const opts: TelegramBot.SendMessageOptions = { parse_mode: "Markdown" };
      if (order.status === "picked_up") {
        opts.reply_markup = {
          inline_keyboard: [
            [{ text: "📦 Mark Delivered", callback_data: `deliver_order:${order.id}` }],
          ],
        };
      }
      await bot.sendMessage(chatId, formatOrder(order), opts);
    }
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message!.chat.id;
    const userId = query.from.id;
    const data = query.data ?? "";

    const acceptMatch = data.match(/^accept_order:(\d+)$/);
    const claimMatch = data.match(/^claim_order:(\d+)$/);
    const deliverMatch = data.match(/^deliver_order:(\d+)$/);

    if (acceptMatch) {
      const user = store.getUser(userId);
      if (!user || user.role !== "seller") {
        await bot.answerCallbackQuery(query.id, {
          text: "Only sellers can accept orders.",
          show_alert: true,
        });
        return;
      }
      const orderId = parseInt(acceptMatch[1]!, 10);
      const order = store.acceptOrder(orderId, userId);
      if (!order) {
        await bot.editMessageText(
          "⚠️ This order has already been accepted or is no longer available.",
          { chat_id: chatId, message_id: query.message!.message_id },
        );
        await bot.answerCallbackQuery(query.id);
        return;
      }
      logger.info({ orderId, sellerId: userId }, "Order accepted");
      await bot.editMessageText(
        `${formatOrder(order)}\n\n✅ You accepted this order! Waiting for a driver to pick it up.`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          parse_mode: "Markdown",
        },
      );
      await bot.answerCallbackQuery(query.id, { text: "Order accepted!" });
      return;
    }

    if (claimMatch) {
      const user = store.getUser(userId);
      if (!user || user.role !== "driver") {
        await bot.answerCallbackQuery(query.id, {
          text: "Only drivers can claim deliveries.",
          show_alert: true,
        });
        return;
      }
      const orderId = parseInt(claimMatch[1]!, 10);
      const order = store.claimOrder(orderId, userId);
      if (!order) {
        await bot.editMessageText(
          "⚠️ This delivery has already been claimed or is unavailable.",
          { chat_id: chatId, message_id: query.message!.message_id },
        );
        await bot.answerCallbackQuery(query.id);
        return;
      }
      logger.info({ orderId, driverId: userId }, "Order claimed");
      await bot.editMessageText(
        `${formatOrder(order)}\n\n🚗 You claimed this delivery! Go pick it up.`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📦 Mark Delivered", callback_data: `deliver_order:${order.id}` }],
            ],
          },
        },
      );
      await bot.answerCallbackQuery(query.id, { text: "Delivery claimed!" });
      return;
    }

    if (deliverMatch) {
      const user = store.getUser(userId);
      if (!user || user.role !== "driver") {
        await bot.answerCallbackQuery(query.id, {
          text: "Only drivers can mark deliveries.",
          show_alert: true,
        });
        return;
      }
      const orderId = parseInt(deliverMatch[1]!, 10);
      const order = store.markDelivered(orderId, userId);
      if (!order) {
        await bot.editMessageText(
          "⚠️ Could not update this order. It may already be delivered.",
          { chat_id: chatId, message_id: query.message!.message_id },
        );
        await bot.answerCallbackQuery(query.id);
        return;
      }
      logger.info({ orderId, driverId: userId }, "Order delivered");
      await bot.editMessageText(
        `${formatOrder(order)}\n\n🎉 Delivery complete! Great job!`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          parse_mode: "Markdown",
        },
      );
      await bot.answerCallbackQuery(query.id, { text: "Marked as delivered! 🎉" });
      return;
    }

    await bot.answerCallbackQuery(query.id);
  });

  logger.info("Telegram bot started (polling)");
  return bot;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}
