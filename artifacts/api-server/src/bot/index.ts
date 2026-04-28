import TelegramBot from "node-telegram-bot-api";
import { logger } from "../lib/logger";
import { store, broadcastState, statusEmoji, type Role, type BroadcastTarget } from "./store";

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
    keyboard: [
      [{ text: "📦 New Order" }, { text: "📋 My Orders" }],
      [{ text: "❌ Cancel Order" }, { text: "🕒 Riwayat" }],
      [{ text: "📊 Statistik" }],
    ],
    resize_keyboard: true,
  };
}

function sellerKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "📥 Incoming Orders" }, { text: "📋 Accepted Orders" }],
      [{ text: "🕒 Riwayat" }, { text: "📊 Statistik" }],
    ],
    resize_keyboard: true,
  };
}

function driverKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "🚚 Available Deliveries" }, { text: "📋 My Deliveries" }],
      [{ text: "🕒 Riwayat" }, { text: "📊 Statistik" }],
    ],
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

function adminKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "📢 Broadcast Semua" }],
      [{ text: "📢 ke Customer" }, { text: "📢 ke Seller" }, { text: "📢 ke Driver" }],
      [{ text: "👥 Daftar User" }, { text: "📈 Statistik Global" }],
    ],
    resize_keyboard: true,
  };
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

  async function notify(chatId: number, text: string): Promise<void> {
    try {
      await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch (err) {
      logger.warn({ err, chatId }, "Failed to send notification");
    }
  }

  const adminIds: Set<number> = new Set(
    (process.env["ADMIN_CHAT_IDS"] ?? "")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n)),
  );

  function isAdmin(userId: number): boolean {
    return adminIds.has(userId);
  }

  async function doBroadcast(
    target: BroadcastTarget,
    message: string,
    adminChatId: number,
  ): Promise<void> {
    const allUsers = store.getUsersByRole("customer")
      .concat(store.getUsersByRole("seller"))
      .concat(store.getUsersByRole("driver"));

    const targets =
      target === "all"
        ? allUsers
        : store.getUsersByRole(target as Role);

    let sent = 0;
    let failed = 0;
    for (const u of targets) {
      try {
        await bot.sendMessage(u.telegramId, `📢 *Pengumuman*\n\n${message}`, {
          parse_mode: "Markdown",
        });
        sent++;
      } catch {
        failed++;
      }
    }
    await notify(
      adminChatId,
      `✅ Broadcast selesai!\n📤 Terkirim: *${sent}*\n❌ Gagal: *${failed}*`,
    );
    logger.info({ target, sent, failed }, "Broadcast sent");
  }

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

  bot.onText(/^\/admin$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    if (!isAdmin(userId)) {
      await bot.sendMessage(chatId, "⛔ Kamu tidak memiliki akses admin.");
      return;
    }
    await bot.sendMessage(
      chatId,
      `🛠 *Panel Admin*\n\nSelamat datang di panel admin\\. Pilih aksi:`,
      { parse_mode: "MarkdownV2", reply_markup: adminKeyboard() },
    );
  });

  async function startBroadcast(
    msg: TelegramBot.Message,
    target: BroadcastTarget,
    label: string,
  ): Promise<void> {
    const chatId = msg.chat.id;
    if (!isAdmin(msg.from!.id)) {
      await bot.sendMessage(chatId, "⛔ Kamu tidak memiliki akses admin.");
      return;
    }
    broadcastState.setPending(msg.from!.id, target);
    await bot.sendMessage(
      chatId,
      `📢 *Broadcast ke ${label}*\n\nKetik pesan yang ingin dikirim.\nKirim /cancel untuk membatalkan.`,
      { parse_mode: "Markdown" },
    );
  }

  bot.onText(/^📢 Broadcast Semua$/, (msg) => startBroadcast(msg, "all", "Semua User"));
  bot.onText(/^📢 ke Customer$/, (msg) => startBroadcast(msg, "customer", "Customer"));
  bot.onText(/^📢 ke Seller$/, (msg) => startBroadcast(msg, "seller", "Seller"));
  bot.onText(/^📢 ke Driver$/, (msg) => startBroadcast(msg, "driver", "Driver"));

  bot.onText(/^\/cancel$/, async (msg) => {
    const chatId = msg.chat.id;
    broadcastState.clearPending(msg.from!.id);
    await bot.sendMessage(chatId, "❌ Aksi dibatalkan.");
  });

  bot.onText(/^👥 Daftar User$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(msg.from!.id)) return;
    const customers = store.getUsersByRole("customer");
    const sellers = store.getUsersByRole("seller");
    const drivers = store.getUsersByRole("driver");
    const total = customers.length + sellers.length + drivers.length;
    const lines = [
      `👥 *Daftar User (${total} total)*\n`,
      `👤 Customer (${customers.length}): ${customers.map((u) => `@${u.username}`).join(", ") || "-"}`,
      `🏪 Seller (${sellers.length}): ${sellers.map((u) => `@${u.username}`).join(", ") || "-"}`,
      `🚗 Driver (${drivers.length}): ${drivers.map((u) => `@${u.username}`).join(", ") || "-"}`,
    ];
    await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
  });

  bot.onText(/^📈 Statistik Global$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(msg.from!.id)) return;
    const customers = store.getUsersByRole("customer").length;
    const sellers = store.getUsersByRole("seller").length;
    const drivers = store.getUsersByRole("driver").length;
    // Count orders via all customers
    const customerUsers = store.getUsersByRole("customer");
    let totalOrders = 0, pending = 0, delivered = 0, cancelled = 0, onTheWay = 0;
    for (const u of customerUsers) {
      const orders = store.getOrdersByCustomer(u.telegramId);
      totalOrders += orders.length;
      pending += orders.filter((o) => o.status === "pending").length;
      delivered += orders.filter((o) => o.status === "delivered").length;
      cancelled += orders.filter((o) => o.status === "cancelled").length;
      onTheWay += orders.filter((o) => o.status === "picked_up").length;
    }
    const text =
      `📈 *Statistik Global Bot*\n\n` +
      `👤 Customer: *${customers}*\n` +
      `🏪 Seller: *${sellers}*\n` +
      `🚗 Driver: *${drivers}*\n` +
      `👥 Total User: *${customers + sellers + drivers}*\n\n` +
      `📦 Total Pesanan: *${totalOrders}*\n` +
      `⏳ Pending: *${pending}*\n` +
      `🚗 Diantar: *${onTheWay}*\n` +
      `✅ Selesai: *${delivered}*\n` +
      `❌ Dibatalkan: *${cancelled}*`;
    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  bot.onText(/^🕒 Riwayat$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const user = store.getUser(userId);

    if (!user) {
      await bot.sendMessage(chatId, "Silakan gunakan /start untuk mendaftar terlebih dahulu.");
      return;
    }

    let history: ReturnType<typeof store.getHistoryByCustomer> = [];
    let title = "";

    if (user.role === "customer") {
      history = store.getHistoryByCustomer(userId);
      title = "📋 *Riwayat Pesanan Kamu*";
    } else if (user.role === "seller") {
      history = store.getHistoryBySeller(userId);
      title = "📋 *Riwayat Pesanan Seller*";
    } else {
      history = store.getHistoryByDriver(userId);
      title = "📋 *Riwayat Pengiriman Kamu*";
    }

    if (history.length === 0) {
      await bot.sendMessage(chatId, "Belum ada riwayat pesanan.", { parse_mode: "Markdown" });
      return;
    }

    const BATCH = 5;
    await bot.sendMessage(chatId, `${title}\n_Menampilkan ${Math.min(history.length, BATCH * 2)} pesanan terbaru, diurutkan dari yang terbaru._`, {
      parse_mode: "Markdown",
    });

    const toShow = history.slice(0, BATCH * 2);
    const chunks: typeof toShow[] = [];
    for (let i = 0; i < toShow.length; i += BATCH) chunks.push(toShow.slice(i, i + BATCH));

    for (const chunk of chunks) {
      const text = chunk.map(formatOrder).join("\n\n─────────────\n\n");
      await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    }
  });

  bot.onText(/^📊 Statistik$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const user = store.getUser(userId);

    if (!user) {
      await bot.sendMessage(chatId, "Silakan gunakan /start untuk mendaftar terlebih dahulu.");
      return;
    }

    let text = "";

    if (user.role === "customer") {
      const s = store.getStatsCustomer(userId);
      const successRate = s.total > 0
        ? Math.round((s.delivered / s.total) * 100)
        : 0;
      text =
        `📊 *Statistik Kamu*\n\n` +
        `📦 Total Pesanan: *${s.total}*\n` +
        `⏳ Menunggu Seller: *${s.pending}*\n` +
        `✅ Diterima Seller: *${s.accepted}*\n` +
        `🚗 Sedang Diantar: *${s.onTheWay}*\n` +
        `📦 Selesai Terkirim: *${s.delivered}*\n` +
        `❌ Dibatalkan: *${s.cancelled}*\n\n` +
        `🏆 Tingkat Keberhasilan: *${successRate}%*`;
    } else if (user.role === "seller") {
      const s = store.getStatsSeller(userId);
      const successRate = s.totalAccepted > 0
        ? Math.round((s.delivered / s.totalAccepted) * 100)
        : 0;
      text =
        `📊 *Statistik Seller*\n\n` +
        `📥 Pesanan Masuk (Pending): *${s.pendingIncoming}*\n` +
        `✅ Total Diterima: *${s.totalAccepted}*\n` +
        `🚗 Sedang Dikirim: *${s.onTheWay}*\n` +
        `📦 Berhasil Terkirim: *${s.delivered}*\n` +
        `❌ Dibatalkan: *${s.cancelled}*\n\n` +
        `🏆 Tingkat Penyelesaian: *${successRate}%*`;
    } else {
      const s = store.getStatsDriver(userId);
      const successRate = s.totalClaimed > 0
        ? Math.round((s.delivered / s.totalClaimed) * 100)
        : 0;
      const ratingLine = s.avgRating !== null
        ? `⭐ Rating Rata-rata: *${s.avgRating.toFixed(1)}/5* (${s.totalRatings} ulasan)\n`
        : `⭐ Rating Rata-rata: *Belum ada*\n`;
      text =
        `📊 *Statistik Driver*\n\n` +
        `🚚 Tersedia Sekarang: *${s.available}*\n` +
        `📋 Total Diambil: *${s.totalClaimed}*\n` +
        `🚗 Sedang Diantar: *${s.onTheWay}*\n` +
        `📦 Berhasil Dikirim: *${s.delivered}*\n` +
        ratingLine +
        `\n🏆 Tingkat Keberhasilan: *${successRate}%*`;
    }

    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  bot.onText(/^❌ Cancel Order$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!(await requireRole(chatId, msg.from!.id, "customer"))) return;

    const myOrders = store.getOrdersByCustomer(msg.from!.id).filter(
      (o) => o.status === "pending" || o.status === "accepted",
    );

    if (myOrders.length === 0) {
      await bot.sendMessage(
        chatId,
        "Tidak ada pesanan yang bisa dibatalkan\\.\n\n_Pesanan hanya bisa dibatalkan sebelum diambil driver\\._",
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    await bot.sendMessage(chatId, "Pilih pesanan yang ingin dibatalkan:");
    for (const order of myOrders) {
      await bot.sendMessage(chatId, formatOrder(order), {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "❌ Batalkan Pesanan Ini", callback_data: `cancel_order:${order.id}` }],
          ],
        },
      });
    }
  });

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

    // Notifikasi semua seller
    const sellers = store.getUsersByRole("seller");
    for (const seller of sellers) {
      await notify(
        seller.telegramId,
        `🔔 *Pesanan Baru #${order.id}*\n📝 ${description}\n\nBuka *📥 Incoming Orders* untuk menerima pesanan ini.`,
      );
    }
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

  // Intercept pesan biasa untuk broadcast admin
  bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/") || !msg.from) return;
    const userId = msg.from.id;
    if (!isAdmin(userId)) return;
    const pending = broadcastState.getPending(userId);
    if (!pending) return;
    // Cek bukan tombol menu admin
    const adminButtons = [
      "📢 Broadcast Semua", "📢 ke Customer", "📢 ke Seller", "📢 ke Driver",
      "👥 Daftar User", "📈 Statistik Global",
    ];
    if (adminButtons.includes(msg.text)) return;
    broadcastState.clearPending(userId);
    await bot.sendMessage(msg.chat.id, `⏳ Mengirim broadcast...`);
    await doBroadcast(pending, msg.text, msg.chat.id);
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message!.chat.id;
    const userId = query.from.id;
    const data = query.data ?? "";

    const cancelMatch = data.match(/^cancel_order:(\d+)$/);
    const acceptMatch = data.match(/^accept_order:(\d+)$/);
    const claimMatch = data.match(/^claim_order:(\d+)$/);
    const deliverMatch = data.match(/^deliver_order:(\d+)$/);
    const rateMatch = data.match(/^rate_order:(\d+):([1-5])$/);

    if (cancelMatch) {
      const user = store.getUser(userId);
      if (!user || user.role !== "customer") {
        await bot.answerCallbackQuery(query.id, {
          text: "Hanya customer yang bisa membatalkan pesanan.",
          show_alert: true,
        });
        return;
      }
      const orderId = parseInt(cancelMatch[1]!, 10);
      const order = store.cancelOrder(orderId, userId);
      if (!order) {
        await bot.editMessageText(
          "⚠️ Pesanan tidak bisa dibatalkan. Mungkin sudah diambil driver atau sudah selesai.",
          { chat_id: chatId, message_id: query.message!.message_id },
        );
        await bot.answerCallbackQuery(query.id);
        return;
      }
      logger.info({ orderId, customerId: userId }, "Order cancelled");
      await bot.editMessageText(
        `${formatOrder(order)}\n\n❌ Pesanan telah dibatalkan.`,
        { chat_id: chatId, message_id: query.message!.message_id, parse_mode: "Markdown" },
      );
      await bot.answerCallbackQuery(query.id, { text: "Pesanan dibatalkan." });

      // Notifikasi seller jika sudah menerima pesanan
      if (order.sellerId) {
        await notify(
          order.sellerId,
          `❌ *Pesanan #${order.id} Dibatalkan*\n📝 ${order.description}\n\nCustomer telah membatalkan pesanan ini.`,
        );
      }
      return;
    }

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

      // Notifikasi customer
      await notify(
        order.customerId,
        `✅ *Pesanan #${order.id} Diterima!*\n📝 ${order.description}\n\nPesanan kamu sedang diproses oleh seller. Driver akan segera mengambilnya.`,
      );
      // Notifikasi semua driver
      const drivers = store.getUsersByRole("driver");
      for (const driver of drivers) {
        await notify(
          driver.telegramId,
          `🚗 *Pesanan Siap Diambil #${order.id}*\n📝 ${order.description}\n\nBuka *🚚 Available Deliveries* untuk mengambil pengiriman ini.`,
        );
      }
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

      // Notifikasi customer
      await notify(
        order.customerId,
        `🚗 *Pesanan #${order.id} Sedang Diantar!*\n📝 ${order.description}\n\nDriver sudah mengambil pesananmu dan dalam perjalanan.`,
      );
      // Notifikasi seller
      if (order.sellerId) {
        await notify(
          order.sellerId,
          `🚗 *Driver Mengambil Pesanan #${order.id}*\n📝 ${order.description}\n\nPesanan sedang dalam pengiriman.`,
        );
      }
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

      // Notifikasi customer + minta rating
      await notify(
        order.customerId,
        `📦 *Pesanan #${order.id} Telah Sampai!*\n📝 ${order.description}\n\n🎉 Pesananmu sudah terkirim. Terima kasih sudah berbelanja!`,
      );
      try {
        await bot.sendMessage(
          order.customerId,
          `⭐ *Beri Rating untuk Driver*\n\nBagaimana pengalaman pengirimanmu untuk Pesanan #${order.id}?`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "⭐ 1", callback_data: `rate_order:${order.id}:1` },
                  { text: "⭐⭐ 2", callback_data: `rate_order:${order.id}:2` },
                  { text: "⭐⭐⭐ 3", callback_data: `rate_order:${order.id}:3` },
                  { text: "⭐⭐⭐⭐ 4", callback_data: `rate_order:${order.id}:4` },
                  { text: "⭐⭐⭐⭐⭐ 5", callback_data: `rate_order:${order.id}:5` },
                ],
              ],
            },
          },
        );
      } catch (err) {
        logger.warn({ err }, "Failed to send rating prompt");
      }
      // Notifikasi seller
      if (order.sellerId) {
        await notify(
          order.sellerId,
          `✅ *Pesanan #${order.id} Selesai Dikirim!*\n📝 ${order.description}\n\nPesanan berhasil diterima oleh customer.`,
        );
      }
      return;
    }

    if (rateMatch) {
      const orderId = parseInt(rateMatch[1]!, 10);
      const stars = parseInt(rateMatch[2]!, 10);
      const order = store.rateOrder(orderId, userId, stars);

      if (!order) {
        await bot.answerCallbackQuery(query.id, {
          text: "Rating sudah diberikan atau pesanan tidak valid.",
          show_alert: true,
        });
        return;
      }

      const starStr = "⭐".repeat(stars);
      logger.info({ orderId, userId, stars }, "Order rated");

      await bot.editMessageText(
        `${starStr} *Rating Tersimpan!*\n\nKamu memberi *${stars}/5* bintang untuk pengiriman Pesanan #${order.id}.\nTerima kasih atas penilaianmu!`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          parse_mode: "Markdown",
        },
      );
      await bot.answerCallbackQuery(query.id, { text: `${starStr} Terima kasih!` });

      // Notifikasi driver tentang rating
      if (order.driverId) {
        await notify(
          order.driverId,
          `⭐ *Kamu mendapat rating baru!*\n\nPesanan #${order.id}: *${stars}/5* ${starStr}\n\nTerima kasih sudah memberikan pelayanan terbaik!`,
        );
      }
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
