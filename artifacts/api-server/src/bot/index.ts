import TelegramBot from "node-telegram-bot-api";
import { logger } from "../lib/logger";
import {
  store,
  broadcastState,
  roleAuthState,
  cartState,
  menuEditState,
  customOrderState,
  pendingSellerOrderState,
  deliveryPendingState,
  menuStore,
  statusEmoji,
  SELLER_PASSWORD,
  DRIVER_PASSWORD,
  DELIVERY_RATE_PER_KM,
  type Role,
  type BroadcastTarget,
} from "./store";

function formatRupiah(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function formatOrder(o: ReturnType<typeof store.getOrder>): string {
  if (!o) return "";
  const deliveryLine =
    o.distanceKm !== undefined && o.deliveryCost !== undefined
      ? `\n🚚 Jarak: *${o.distanceKm} km* | Ongkir: *${formatRupiah(o.deliveryCost)}*`
      : "";
  const sellerTag = o.sellerCreated ? " _(dibuat seller)_" : "";
  return (
    `*Pesanan #${o.id}*${sellerTag}\n` +
    `📝 ${o.description}${deliveryLine}\n` +
    `${statusEmoji[o.status]} Status: *${statusLabel(o.status)}*\n` +
    `🕒 ${o.createdAt.toLocaleString("id-ID")}`
  );
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    pending: "Menunggu",
    accepted: "Diterima Seller",
    picked_up: "Sedang Diantar",
    delivered: "Sudah Dikirim",
    cancelled: "Dibatalkan",
  };
  return map[s] ?? s;
}

function customerKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "🛍 Pesan Baru" }, { text: "📋 Pesanan Saya" }],
      [{ text: "🛒 Keranjang" }, { text: "❌ Batalkan Pesanan" }],
      [{ text: "🕒 Riwayat" }, { text: "📊 Statistik" }],
    ],
    resize_keyboard: true,
  };
}

function sellerKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "📥 Pesanan Masuk" }, { text: "📋 Pesanan Diterima" }],
      [{ text: "📝 Buat Pesanan" }, { text: "✏️ Kelola Menu" }],
      [{ text: "🕒 Riwayat" }, { text: "📊 Statistik" }],
    ],
    resize_keyboard: true,
  };
}

function driverKeyboard(): TelegramBot.ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "🚚 Pengiriman Tersedia" }, { text: "📋 Pengiriman Saya" }],
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

function roleMenu(role: Role) {
  if (role === "customer") return customerKeyboard();
  if (role === "seller") return sellerKeyboard();
  return driverKeyboard();
}

function menuCategoryKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🍱 Makanan", callback_data: "menu_cat:makanan" },
        { text: "🥤 Minuman", callback_data: "menu_cat:minuman" },
      ],
      [{ text: "📝 Pesanan Lainnya", callback_data: "menu_custom" }],
    ],
  };
}

function menuItemsKeyboard(
  category: "makanan" | "minuman",
  userId: number,
): TelegramBot.InlineKeyboardMarkup {
  const items = menuStore.getByCategory(category);
  const rows: TelegramBot.InlineKeyboardButton[][] = [];

  for (const item of items) {
    const label =
      item.price > 0
        ? `${item.name} — ${formatRupiah(item.price)}`
        : `${item.name} — Tanya harga`;
    rows.push([{ text: label, callback_data: `cart_add:${item.id}` }]);
  }

  const count = cartState.count(userId);
  const total = cartState.total(userId);
  const cartLabel =
    count > 0
      ? `🛒 Keranjang (${count} item · ${formatRupiah(total)})`
      : "🛒 Keranjang kosong";

  rows.push([
    { text: "🔙 Ganti Kategori", callback_data: "menu_back" },
    { text: cartLabel, callback_data: "cart_view" },
  ]);
  rows.push([{ text: "✅ Konfirmasi Pesanan", callback_data: "cart_confirm" }]);

  return { inline_keyboard: rows };
}

function cartKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🗑 Kosongkan Keranjang", callback_data: "cart_clear" },
        { text: "✅ Pesan Sekarang", callback_data: "cart_confirm" },
      ],
      [{ text: "🔙 Kembali ke Menu", callback_data: "menu_back" }],
    ],
  };
}

export function startBot(): TelegramBot | null {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) {
    logger.warn(
      "TELEGRAM_BOT_TOKEN tidak diset — bot Telegram tidak akan berjalan. Set environment variable dan restart.",
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
      logger.warn({ err, chatId }, "Gagal mengirim notifikasi");
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
    const allUsers = store
      .getUsersByRole("customer")
      .concat(store.getUsersByRole("seller"))
      .concat(store.getUsersByRole("driver"));

    const targets = target === "all" ? allUsers : store.getUsersByRole(target as Role);

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

  // ─── /start ───────────────────────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const firstName = msg.from!.first_name ?? "Kamu";
    const existing = store.getUser(userId);

    if (existing) {
      await bot.sendMessage(
        chatId,
        `Selamat datang kembali, *${firstName}*! Kamu terdaftar sebagai *${roleName(existing.role)}*.`,
        { parse_mode: "Markdown", reply_markup: roleMenu(existing.role) },
      );
      return;
    }

    await bot.sendMessage(
      chatId,
      `👋 Halo *${firstName}*! Selamat datang di bot pemesanan.\n\nSilakan pilih peranmu:`,
      { parse_mode: "Markdown", reply_markup: roleKeyboard() },
    );
  });

  function roleName(role: Role): string {
    if (role === "customer") return "Customer";
    if (role === "seller") return "Seller";
    return "Driver";
  }

  // ─── Pilih Role ────────────────────────────────────────────────────────────
  bot.onText(/^👤 Customer$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const existing = store.getUser(userId);
    if (existing) {
      await bot.sendMessage(chatId, `Kamu sudah terdaftar sebagai *${roleName(existing.role)}*.`, {
        parse_mode: "Markdown",
        reply_markup: roleMenu(existing.role),
      });
      return;
    }
    const username = msg.from!.username ?? msg.from!.first_name ?? String(userId);
    store.registerUser(userId, username, "customer");
    logger.info({ userId, role: "customer" }, "User registered");
    await bot.sendMessage(chatId, `✅ Kamu berhasil masuk sebagai *Customer*!`, {
      parse_mode: "Markdown",
      reply_markup: customerKeyboard(),
    });
  });

  bot.onText(/^🏪 Seller$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const existing = store.getUser(userId);
    if (existing) {
      await bot.sendMessage(chatId, `Kamu sudah terdaftar sebagai *${roleName(existing.role)}*.`, {
        parse_mode: "Markdown",
        reply_markup: roleMenu(existing.role),
      });
      return;
    }
    roleAuthState.setPending(userId, "seller");
    await bot.sendMessage(chatId, `🔐 Masukkan password untuk masuk sebagai *Seller*:`, {
      parse_mode: "Markdown",
    });
  });

  bot.onText(/^🚗 Driver$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const existing = store.getUser(userId);
    if (existing) {
      await bot.sendMessage(chatId, `Kamu sudah terdaftar sebagai *${roleName(existing.role)}*.`, {
        parse_mode: "Markdown",
        reply_markup: roleMenu(existing.role),
      });
      return;
    }
    roleAuthState.setPending(userId, "driver");
    await bot.sendMessage(chatId, `🔐 Masukkan password untuk masuk sebagai *Driver*:`, {
      parse_mode: "Markdown",
    });
  });

  // ─── /admin ────────────────────────────────────────────────────────────────
  bot.onText(/^\/admin$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(msg.from!.id)) {
      await bot.sendMessage(chatId, "⛔ Kamu tidak memiliki akses admin.");
      return;
    }
    await bot.sendMessage(chatId, `🛠 *Panel Admin*\n\nPilih aksi:`, {
      parse_mode: "Markdown",
      reply_markup: adminKeyboard(),
    });
  });

  async function startBroadcast(
    msg: TelegramBot.Message,
    target: BroadcastTarget,
    label: string,
  ): Promise<void> {
    const chatId = msg.chat.id;
    if (!isAdmin(msg.from!.id)) return;
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
    const userId = msg.from!.id;
    broadcastState.clearPending(userId);
    menuEditState.clear(userId);
    customOrderState.clear(userId);
    pendingSellerOrderState.clear(userId);
    deliveryPendingState.clear(userId);
    cartState.clear(userId);
    await bot.sendMessage(chatId, "❌ Aksi dibatalkan.", {
      reply_markup: store.getUser(userId) ? roleMenu(store.getUser(userId)!.role) : roleKeyboard(),
    });
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
    const customerUsers = store.getUsersByRole("customer");
    let totalOrders = 0, pending = 0, delivered = 0, cancelled = 0, onTheWay = 0;
    for (const u of customerUsers) {
      const ords = store.getOrdersByCustomer(u.telegramId);
      totalOrders += ords.length;
      pending += ords.filter((o) => o.status === "pending").length;
      delivered += ords.filter((o) => o.status === "delivered").length;
      cancelled += ords.filter((o) => o.status === "cancelled").length;
      onTheWay += ords.filter((o) => o.status === "picked_up").length;
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

  // ─── Riwayat ────────────────────────────────────────────────────────────────
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
    await bot.sendMessage(
      chatId,
      `${title}\n_Menampilkan ${Math.min(history.length, BATCH * 2)} pesanan terbaru._`,
      { parse_mode: "Markdown" },
    );
    const toShow = history.slice(0, BATCH * 2);
    const chunks: typeof toShow[] = [];
    for (let i = 0; i < toShow.length; i += BATCH) chunks.push(toShow.slice(i, i + BATCH));
    for (const chunk of chunks) {
      const text = chunk.map(formatOrder).join("\n\n─────────────\n\n");
      await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    }
  });

  // ─── Statistik ─────────────────────────────────────────────────────────────
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
      const successRate = s.total > 0 ? Math.round((s.delivered / s.total) * 100) : 0;
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
      const successRate =
        s.totalAccepted > 0 ? Math.round((s.delivered / s.totalAccepted) * 100) : 0;
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
      const successRate =
        s.totalClaimed > 0 ? Math.round((s.delivered / s.totalClaimed) * 100) : 0;
      const ratingLine =
        s.avgRating !== null
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

  // ─── Customer: Pesan Baru (catalog menu) ──────────────────────────────────
  bot.onText(/^🛍 Pesan Baru$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!store.getUser(msg.from!.id) || store.getUser(msg.from!.id)!.role !== "customer") {
      await bot.sendMessage(chatId, "Menu ini hanya untuk customer.");
      return;
    }
    const menuText = menuStore.formatMenuText();
    await bot.sendMessage(
      chatId,
      `📋 *DAFTAR MENU*\n\n${menuText}\n\n─────────────\nPilih kategori pesananmu:`,
      { parse_mode: "Markdown", reply_markup: menuCategoryKeyboard() },
    );
  });

  // ─── Customer: Lihat Keranjang ─────────────────────────────────────────────
  bot.onText(/^🛒 Keranjang$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    if (!store.getUser(userId) || store.getUser(userId)!.role !== "customer") return;
    const summary = cartState.formatSummary(userId);
    const count = cartState.count(userId);
    await bot.sendMessage(
      chatId,
      `🛒 *Keranjang Kamu*\n\n${summary}`,
      {
        parse_mode: "Markdown",
        reply_markup: count > 0 ? cartKeyboard() : undefined,
      },
    );
  });

  // ─── Customer: Batalkan Pesanan ────────────────────────────────────────────
  bot.onText(/^❌ Batalkan Pesanan$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!store.getUser(msg.from!.id) || store.getUser(msg.from!.id)!.role !== "customer") return;
    const myOrders = store.getOrdersByCustomer(msg.from!.id).filter(
      (o) => o.status === "pending" || o.status === "accepted",
    );
    if (myOrders.length === 0) {
      await bot.sendMessage(
        chatId,
        "Tidak ada pesanan yang bisa dibatalkan.\n\n_Pesanan hanya bisa dibatalkan sebelum diambil driver._",
        { parse_mode: "Markdown" },
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

  // ─── Customer: Pesanan Saya ────────────────────────────────────────────────
  bot.onText(/^📋 Pesanan Saya$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!store.getUser(msg.from!.id) || store.getUser(msg.from!.id)!.role !== "customer") return;
    const myOrders = store.getOrdersByCustomer(msg.from!.id).filter(
      (o) => o.status !== "delivered" && o.status !== "cancelled",
    );
    if (myOrders.length === 0) {
      await bot.sendMessage(
        chatId,
        "Tidak ada pesanan aktif. Tap *🛍 Pesan Baru* untuk memesan.",
        { parse_mode: "Markdown" },
      );
      return;
    }
    const text = myOrders.map(formatOrder).join("\n\n─────────────\n\n");
    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  // ─── Seller: Pesanan Masuk ─────────────────────────────────────────────────
  bot.onText(/^📥 Pesanan Masuk$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!store.getUser(msg.from!.id) || store.getUser(msg.from!.id)!.role !== "seller") return;
    const pending = store.getPendingOrders();
    if (pending.length === 0) {
      await bot.sendMessage(chatId, "Belum ada pesanan masuk. Pantau terus!");
      return;
    }
    for (const order of pending) {
      await bot.sendMessage(chatId, formatOrder(order), {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Terima Pesanan", callback_data: `accept_order:${order.id}` }],
          ],
        },
      });
    }
  });

  // ─── Seller: Pesanan Diterima ──────────────────────────────────────────────
  bot.onText(/^📋 Pesanan Diterima$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!store.getUser(msg.from!.id) || store.getUser(msg.from!.id)!.role !== "seller") return;
    const myOrders = store.getOrdersBySeller(msg.from!.id);
    if (myOrders.length === 0) {
      await bot.sendMessage(chatId, "Belum ada pesanan yang diterima.");
      return;
    }
    const text = myOrders.map(formatOrder).join("\n\n─────────────\n\n");
    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  // ─── Seller: Buat Pesanan (kirim langsung ke driver) ─────────────────────
  bot.onText(/^📝 Buat Pesanan$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const user = store.getUser(userId);
    if (!user || user.role !== "seller") return;
    pendingSellerOrderState.set(userId);
    await bot.sendMessage(
      chatId,
      `📝 *Buat Pesanan Baru*\n\nKetikkan deskripsi pesanan yang ingin dikirim ke driver.\n\n_Contoh: 2 porsi nasi goreng + 1 es teh, kirim ke Jl. Merdeka No. 5_\n\nKirim /cancel untuk batal.`,
      { parse_mode: "Markdown" },
    );
  });

  // ─── Seller: Kelola Menu ───────────────────────────────────────────────────
  bot.onText(/^✏️ Kelola Menu$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    if (!store.getUser(userId) || store.getUser(userId)!.role !== "seller") return;
    await sendMenuManagement(chatId);
  });

  async function sendMenuManagement(chatId: number): Promise<void> {
    const menuText = menuStore.formatMenuText();
    await bot.sendMessage(
      chatId,
      `✏️ *Kelola Menu*\n\n${menuText}\n\n─────────────\nGunakan tombol di bawah untuk mengelola menu:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "➕ Tambah Item Baru", callback_data: "menu_add" }],
            [
              { text: "✏️ Edit Harga Item", callback_data: "menu_edit_price" },
              { text: "🗑 Hapus Item", callback_data: "menu_delete" },
            ],
            [{ text: "🔄 Aktif/Non-aktif Item", callback_data: "menu_toggle" }],
          ],
        },
      },
    );
  }

  // ─── Driver: Pengiriman Tersedia ───────────────────────────────────────────
  bot.onText(/^🚚 Pengiriman Tersedia$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!store.getUser(msg.from!.id) || store.getUser(msg.from!.id)!.role !== "driver") return;
    const available = store.getAcceptedUnassignedOrders();
    if (available.length === 0) {
      await bot.sendMessage(chatId, "Belum ada pengiriman tersedia. Cek lagi nanti!");
      return;
    }
    for (const order of available) {
      await bot.sendMessage(chatId, formatOrder(order), {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚗 Ambil Pengiriman", callback_data: `claim_order:${order.id}` }],
          ],
        },
      });
    }
  });

  // ─── Driver: Pengiriman Saya ───────────────────────────────────────────────
  bot.onText(/^📋 Pengiriman Saya$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!store.getUser(msg.from!.id) || store.getUser(msg.from!.id)!.role !== "driver") return;
    const deliveries = store.getOrdersByDriver(msg.from!.id);
    if (deliveries.length === 0) {
      await bot.sendMessage(
        chatId,
        "Belum ada pengiriman. Ambil via *🚚 Pengiriman Tersedia*.",
        { parse_mode: "Markdown" },
      );
      return;
    }
    for (const order of deliveries) {
      const opts: TelegramBot.SendMessageOptions = { parse_mode: "Markdown" };
      if (order.status === "picked_up") {
        opts.reply_markup = {
          inline_keyboard: [
            [{ text: "📦 Tandai Sudah Dikirim", callback_data: `deliver_order:${order.id}` }],
          ],
        };
      }
      await bot.sendMessage(chatId, formatOrder(order), opts);
    }
  });

  // ─── Message handler (password, broadcast, menu edit, custom order) ────────
  bot.on("message", async (msg) => {
    if (!msg.text || !msg.from) return;
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    // Abaikan command
    if (text.startsWith("/")) return;

    // ── 1. Verifikasi password role ──────────────────────────────────────────
    const pendingRole = roleAuthState.getPending(userId);
    if (pendingRole) {
      const skipTexts = ["👤 Customer", "🏪 Seller", "🚗 Driver"];
      if (skipTexts.includes(text)) return;
      roleAuthState.clearPending(userId);
      const correctPassword =
        pendingRole === "seller" ? SELLER_PASSWORD : DRIVER_PASSWORD;
      if (text !== correctPassword) {
        await bot.sendMessage(
          chatId,
          `❌ Password salah. Silakan tekan /start dan coba lagi.`,
        );
        return;
      }
      const username = msg.from.username ?? msg.from.first_name ?? String(userId);
      store.registerUser(userId, username, pendingRole);
      logger.info({ userId, role: pendingRole }, "User registered via password");
      await bot.sendMessage(
        chatId,
        `✅ Password benar! Kamu berhasil masuk sebagai *${roleName(pendingRole)}*.`,
        { parse_mode: "Markdown", reply_markup: roleMenu(pendingRole) },
      );
      return;
    }

    // ── 2. Custom order (pesanan lainnya) → tanya jarak ─────────────────────
    if (customOrderState.has(userId)) {
      const skipCustom = [
        "🛍 Pesan Baru", "📋 Pesanan Saya", "🛒 Keranjang", "❌ Batalkan Pesanan",
        "🕒 Riwayat", "📊 Statistik",
      ];
      if (skipCustom.includes(text)) return;
      customOrderState.clear(userId);
      deliveryPendingState.set(userId, { description: text, itemsTotal: 0, initiatedBy: "customer" });
      await bot.sendMessage(
        chatId,
        `📝 *Pesanan:* ${text}\n\n🚚 Ongkir: Rp 1.500/km\n\n📍 Berapa jarak pengirimanmu? (ketik angka km, contoh: *3* atau *2.5*)`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // ── 2b. Seller order → tanya jarak ──────────────────────────────────────
    if (pendingSellerOrderState.has(userId)) {
      const skipSeller = [
        "📥 Pesanan Masuk", "📋 Pesanan Diterima", "📝 Buat Pesanan",
        "✏️ Kelola Menu", "🕒 Riwayat", "📊 Statistik",
      ];
      if (skipSeller.includes(text)) return;
      pendingSellerOrderState.clear(userId);
      deliveryPendingState.set(userId, { description: text, itemsTotal: 0, initiatedBy: "seller" });
      await bot.sendMessage(
        chatId,
        `📝 *Pesanan:* ${text}\n\n🚚 Ongkir: Rp 1.500/km\n\n📍 Berapa jarak pengiriman? (ketik angka km, contoh: *3* atau *2.5*)`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // ── 2c. Input jarak untuk delivery cost ──────────────────────────────────
    const deliveryPending = deliveryPendingState.get(userId);
    if (deliveryPending) {
      const skipDelivery = [
        "🛍 Pesan Baru", "📋 Pesanan Saya", "🛒 Keranjang", "❌ Batalkan Pesanan",
        "📥 Pesanan Masuk", "📋 Pesanan Diterima", "📝 Buat Pesanan",
        "✏️ Kelola Menu", "🕒 Riwayat", "📊 Statistik",
      ];
      if (skipDelivery.includes(text)) return;
      const distanceKm = parseFloat(text.replace(",", "."));
      if (isNaN(distanceKm) || distanceKm <= 0) {
        await bot.sendMessage(chatId, "Jarak tidak valid. Ketik angka km, contoh: *3* atau *2.5*", {
          parse_mode: "Markdown",
        });
        return;
      }
      const deliveryCost = Math.round(distanceKm * DELIVERY_RATE_PER_KM);
      const grandTotal = deliveryPending.itemsTotal + deliveryCost;
      const subtotalLine = deliveryPending.itemsTotal > 0
        ? `💰 Subtotal: *${formatRupiah(deliveryPending.itemsTotal)}*\n`
        : "";
      await bot.sendMessage(
        chatId,
        `📋 *Konfirmasi Pesanan*\n\n` +
        `📝 ${deliveryPending.description}\n\n` +
        `${subtotalLine}` +
        `🚚 Jarak: *${distanceKm} km*\n` +
        `📦 Ongkir: *${formatRupiah(deliveryCost)}*\n` +
        (deliveryPending.itemsTotal > 0 ? `💵 Total Bayar: *${formatRupiah(grandTotal)}*\n` : "") +
        `\nSetuju dengan biaya pengiriman ini?`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Setuju & Pesan", callback_data: `delivery_ok:${distanceKm}:${deliveryCost}` },
              { text: "❌ Batal", callback_data: "delivery_cancel" },
            ]],
          },
        },
      );
      return;
    }

    // ── 3. Menu edit flow (seller) ───────────────────────────────────────────
    const editState = menuEditState.get(userId);
    if (editState) {
      const skipEdit = ["📥 Pesanan Masuk", "📋 Pesanan Diterima", "✏️ Kelola Menu", "🕒 Riwayat", "📊 Statistik"];
      if (skipEdit.includes(text)) return;

      if (editState.phase === "add_name") {
        menuEditState.set(userId, { phase: "add_category", name: text });
        await bot.sendMessage(chatId, `Pilih kategori untuk *${text}*:`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🍱 Makanan", callback_data: "add_menu_cat:makanan" },
                { text: "🥤 Minuman", callback_data: "add_menu_cat:minuman" },
              ],
            ],
          },
        });
        return;
      }

      if (editState.phase === "add_price") {
        const price = parseInt(text.replace(/\D/g, ""), 10);
        if (isNaN(price) || price < 0) {
          await bot.sendMessage(chatId, "Harga tidak valid. Masukkan angka, contoh: 15000");
          return;
        }
        const item = menuStore.addItem(editState.category, editState.name, price);
        menuEditState.clear(userId);
        const priceLabel = price > 0 ? formatRupiah(price) : "Harga menyusul";
        await bot.sendMessage(
          chatId,
          `✅ Item *${item.name}* (${priceLabel}) berhasil ditambahkan!\n\nID item: *${item.id}*`,
          { parse_mode: "Markdown" },
        );
        await sendMenuManagement(chatId);
        return;
      }

      if (editState.phase === "edit_price") {
        // Mode hapus item
        if (editState.itemName === "__delete__") {
          const id = parseInt(text, 10);
          const item = menuStore.getById(id);
          if (!item) { await bot.sendMessage(chatId, `ID ${id} tidak ditemukan. Coba lagi.`); return; }
          menuStore.deleteItem(id);
          menuEditState.clear(userId);
          await bot.sendMessage(chatId, `🗑 Item *${item.name}* berhasil dihapus.`, { parse_mode: "Markdown" });
          await sendMenuManagement(chatId);
          return;
        }
        // Mode toggle item
        if (editState.itemName === "__toggle__") {
          const id = parseInt(text, 10);
          const item = menuStore.getById(id);
          if (!item) { await bot.sendMessage(chatId, `ID ${id} tidak ditemukan. Coba lagi.`); return; }
          const updated = menuStore.toggleAvailable(id);
          menuEditState.clear(userId);
          await bot.sendMessage(chatId, `${updated?.available ? "✅ Aktif" : "⏸ Non-aktif"}: *${item.name}*`, { parse_mode: "Markdown" });
          await sendMenuManagement(chatId);
          return;
        }
        // Mode edit harga — pertama tangkap ID (itemId === 0 = belum pilih)
        if (editState.itemId === 0) {
          const id = parseInt(text, 10);
          const item = menuStore.getById(id);
          if (!item) { await bot.sendMessage(chatId, `ID ${id} tidak ditemukan. Ketik ID yang valid.`); return; }
          menuEditState.set(userId, { phase: "edit_price", itemId: id, itemName: item.name });
          await bot.sendMessage(chatId, `✏️ Ketik harga baru untuk *${item.name}* (contoh: 25000):`, { parse_mode: "Markdown" });
          return;
        }
        // Sudah ada itemId — ini input harga baru
        const price = parseInt(text.replace(/\D/g, ""), 10);
        if (isNaN(price) || price < 0) {
          await bot.sendMessage(chatId, "Harga tidak valid. Masukkan angka, contoh: 20000");
          return;
        }
        menuStore.updatePrice(editState.itemId, price);
        menuEditState.clear(userId);
        const priceLabel = price > 0 ? formatRupiah(price) : "Harga menyusul";
        await bot.sendMessage(
          chatId,
          `✅ Harga *${editState.itemName}* berhasil diubah menjadi *${priceLabel}*.`,
          { parse_mode: "Markdown" },
        );
        await sendMenuManagement(chatId);
        return;
      }

      if (editState.phase === "add_category") {
        return;
      }
    }

    // ── 4. Broadcast admin ───────────────────────────────────────────────────
    if (isAdmin(userId)) {
      const pending = broadcastState.getPending(userId);
      if (pending) {
        const adminButtons = [
          "📢 Broadcast Semua", "📢 ke Customer", "📢 ke Seller", "📢 ke Driver",
          "👥 Daftar User", "📈 Statistik Global",
        ];
        if (adminButtons.includes(text)) return;
        broadcastState.clearPending(userId);
        await bot.sendMessage(chatId, `⏳ Mengirim broadcast...`);
        await doBroadcast(pending, text, chatId);
        return;
      }
    }
  });

  // ─── Callback query handler ────────────────────────────────────────────────
  bot.on("callback_query", async (query) => {
    const chatId = query.message!.chat.id;
    const userId = query.from.id;
    const data = query.data ?? "";

    // ── Delivery: konfirmasi biaya ────────────────────────────────────────────
    const deliveryOkMatch = data.match(/^delivery_ok:([\d.]+):(\d+)$/);
    if (deliveryOkMatch) {
      await bot.answerCallbackQuery(query.id);
      const pending = deliveryPendingState.get(userId);
      if (!pending) {
        await bot.sendMessage(chatId, "Sesi pesanan sudah habis. Silakan mulai ulang.");
        return;
      }
      const distanceKm = parseFloat(deliveryOkMatch[1]!);
      const deliveryCost = parseInt(deliveryOkMatch[2]!, 10);
      deliveryPendingState.clear(userId);

      const isSellerCreated = pending.initiatedBy === "seller";
      const order = store.createOrder(
        userId,
        pending.description,
        { sellerCreated: isSellerCreated, distanceKm, deliveryCost },
      );
      logger.info({ orderId: order.id, userId, isSellerCreated }, "Order confirmed with delivery cost");

      const grandTotal = pending.itemsTotal + deliveryCost;
      const totalLine = pending.itemsTotal > 0 ? `\n💵 Total Bayar: *${formatRupiah(grandTotal)}*` : "";

      await bot.editMessageReplyMarkup(
        { inline_keyboard: [[{ text: "✅ Pesanan dikonfirmasi", callback_data: "noop" }]] },
        { chat_id: chatId, message_id: query.message!.message_id },
      );
      await bot.sendMessage(
        chatId,
        `✅ *Pesanan #${order.id} berhasil dibuat!*\n\n` +
        `📝 ${pending.description}\n` +
        `🚚 Jarak: *${distanceKm} km* | Ongkir: *${formatRupiah(deliveryCost)}*${totalLine}\n\n` +
        (isSellerCreated ? `Driver akan segera mengambil pesanan ini.` : `Menunggu seller menerima pesananmu.`),
        { parse_mode: "Markdown" },
      );

      if (isSellerCreated) {
        // Seller buat pesanan → auto-accept lalu notify driver
        store.acceptOrder(order.id, userId);
        const drivers = store.getUsersByRole("driver");
        for (const driver of drivers) {
          await notify(
            driver.telegramId,
            `🔔 *Pesanan Baru dari Seller #${order.id}*\n📝 ${pending.description}\n🚚 Jarak: ${distanceKm} km | Ongkir: ${formatRupiah(deliveryCost)}\n\nBuka *🚚 Pengiriman Tersedia* untuk mengambil.`,
          );
        }
      } else {
        // Customer buat pesanan → notify seller
        const sellers = store.getUsersByRole("seller");
        for (const seller of sellers) {
          await notify(
            seller.telegramId,
            `🔔 *Pesanan Baru #${order.id}*\n📝 ${pending.description}\n🚚 Ongkir: ${formatRupiah(deliveryCost)}\n\nBuka *📥 Pesanan Masuk* untuk menerima.`,
          );
        }
      }
      return;
    }

    if (data === "delivery_cancel") {
      await bot.answerCallbackQuery(query.id, { text: "Pesanan dibatalkan." });
      deliveryPendingState.clear(userId);
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [[{ text: "❌ Dibatalkan", callback_data: "noop" }]] },
        { chat_id: chatId, message_id: query.message!.message_id },
      );
      return;
    }

    // ── Catalog: pilih kategori ──────────────────────────────────────────────
    if (data === "menu_back") {
      await bot.answerCallbackQuery(query.id);
      const menuText = menuStore.formatMenuText();
      await bot.sendMessage(
        chatId,
        `📋 *DAFTAR MENU*\n\n${menuText}\n\n─────────────\nPilih kategori pesananmu:`,
        { parse_mode: "Markdown", reply_markup: menuCategoryKeyboard() },
      );
      return;
    }

    const catMatch = data.match(/^menu_cat:(makanan|minuman)$/);
    if (catMatch) {
      await bot.answerCallbackQuery(query.id);
      const cat = catMatch[1] as "makanan" | "minuman";
      const label = cat === "makanan" ? "🍱 Makanan" : "🥤 Minuman";
      await bot.sendMessage(
        chatId,
        `${label} — Tap item untuk menambahkan ke keranjang:`,
        { reply_markup: menuItemsKeyboard(cat, userId) },
      );
      return;
    }

    if (data === "menu_custom") {
      await bot.answerCallbackQuery(query.id);
      customOrderState.set(userId);
      await bot.sendMessage(
        chatId,
        `📝 *Pesanan Lainnya*\n\nKetikkan pesananmu secara bebas.\nContoh: "1 porsi nasi goreng extra pedas"\n\nKirim /cancel untuk membatalkan.`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // ── Cart: tambah item ────────────────────────────────────────────────────
    const cartAddMatch = data.match(/^cart_add:(\d+)$/);
    if (cartAddMatch) {
      const itemId = parseInt(cartAddMatch[1]!, 10);
      const item = menuStore.getById(itemId);
      if (!item) {
        await bot.answerCallbackQuery(query.id, { text: "Item tidak ditemukan.", show_alert: true });
        return;
      }
      cartState.addItem(userId, item);
      const count = cartState.count(userId);
      const total = cartState.total(userId);
      await bot.answerCallbackQuery(query.id, {
        text: `✅ ${item.name} ditambahkan!\nKeranjang: ${count} item · ${formatRupiah(total)}`,
      });
      // Update tombol keranjang di pesan
      const cat = item.category;
      try {
        await bot.editMessageReplyMarkup(menuItemsKeyboard(cat, userId), {
          chat_id: chatId,
          message_id: query.message!.message_id,
        });
      } catch {
        // Abaikan jika tidak bisa update
      }
      return;
    }

    // ── Cart: lihat keranjang ────────────────────────────────────────────────
    if (data === "cart_view") {
      await bot.answerCallbackQuery(query.id);
      const summary = cartState.formatSummary(userId);
      const count = cartState.count(userId);
      await bot.sendMessage(
        chatId,
        `🛒 *Keranjang Kamu*\n\n${summary}`,
        {
          parse_mode: "Markdown",
          reply_markup: count > 0 ? cartKeyboard() : undefined,
        },
      );
      return;
    }

    // ── Cart: kosongkan ──────────────────────────────────────────────────────
    if (data === "cart_clear") {
      cartState.clear(userId);
      await bot.answerCallbackQuery(query.id, { text: "🗑 Keranjang dikosongkan." });
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [[{ text: "🔙 Kembali ke Menu", callback_data: "menu_back" }]] },
        { chat_id: chatId, message_id: query.message!.message_id },
      );
      return;
    }

    // ── Cart: konfirmasi → tanya jarak dulu ─────────────────────────────────
    if (data === "cart_confirm") {
      await bot.answerCallbackQuery(query.id);
      const items = cartState.get(userId);
      if (items.length === 0) {
        await bot.sendMessage(chatId, "Keranjang kamu kosong. Pilih menu terlebih dahulu.");
        return;
      }
      const description = cartState.buildDescription(userId);
      const total = cartState.total(userId);
      cartState.clear(userId);
      deliveryPendingState.set(userId, { description, itemsTotal: total, initiatedBy: "customer" });
      await bot.sendMessage(
        chatId,
        `🛍 *Ringkasan Pesanan*\n\n${description}\n\n💰 Subtotal: *${formatRupiah(total)}*\n🚚 Ongkir: Rp 1.500/km\n\n📍 Berapa jarak pengirimanmu? (ketik angka km, contoh: *3* atau *2.5*)`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // ── Seller: kelola menu ──────────────────────────────────────────────────
    if (data === "menu_add") {
      await bot.answerCallbackQuery(query.id);
      menuEditState.set(userId, { phase: "add_name" });
      await bot.sendMessage(chatId, `➕ *Tambah Item Baru*\n\nKetik nama item baru:\n(Kirim /cancel untuk batal)`, {
        parse_mode: "Markdown",
      });
      return;
    }

    if (data === "menu_edit_price") {
      await bot.answerCallbackQuery(query.id);
      const menuText = menuStore.formatMenuText();
      await bot.sendMessage(
        chatId,
        `✏️ *Edit Harga Item*\n\n${menuText}\n\n─────────────\nKetik *ID item* yang ingin diubah harganya:`,
        { parse_mode: "Markdown" },
      );
      menuEditState.set(userId, { phase: "edit_price", itemId: 0, itemName: "_pilih item_" });
      return;
    }

    if (data === "menu_delete") {
      await bot.answerCallbackQuery(query.id);
      const menuText = menuStore.formatMenuText();
      await bot.sendMessage(
        chatId,
        `🗑 *Hapus Item*\n\n${menuText}\n\n─────────────\nKetik *ID item* yang ingin dihapus:`,
        { parse_mode: "Markdown" },
      );
      menuEditState.set(userId, { phase: "edit_price", itemId: -1, itemName: "__delete__" });
      return;
    }

    if (data === "menu_toggle") {
      await bot.answerCallbackQuery(query.id);
      const menuText = menuStore.formatMenuText();
      await bot.sendMessage(
        chatId,
        `🔄 *Aktif/Non-aktif Item*\n\n${menuText}\n\n─────────────\nKetik *ID item* yang ingin di-toggle:`,
        { parse_mode: "Markdown" },
      );
      menuEditState.set(userId, { phase: "edit_price", itemId: -2, itemName: "__toggle__" });
      return;
    }

    const addMenuCatMatch = data.match(/^add_menu_cat:(makanan|minuman)$/);
    if (addMenuCatMatch) {
      await bot.answerCallbackQuery(query.id);
      const cat = addMenuCatMatch[1] as "makanan" | "minuman";
      const current = menuEditState.get(userId);
      if (!current || current.phase !== "add_category") return;
      menuEditState.set(userId, { phase: "add_price", name: current.name, category: cat });
      await bot.sendMessage(
        chatId,
        `💰 Ketik harga untuk *${current.name}* (dalam rupiah, contoh: 15000).\nMasukkan 0 jika harga menyusul:`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // ── Tangani ID untuk edit/delete/toggle (via message handler override) ───
    // Kita gunakan inline keyboard khusus per item untuk delete dan toggle
    const menuItemEditMatch = data.match(/^mitem_(edit|del|toggle):(\d+)$/);
    if (menuItemEditMatch) {
      const action = menuItemEditMatch[1]!;
      const itemId = parseInt(menuItemEditMatch[2]!, 10);
      const item = menuStore.getById(itemId);
      if (!item) {
        await bot.answerCallbackQuery(query.id, { text: "Item tidak ditemukan.", show_alert: true });
        return;
      }
      if (action === "del") {
        menuStore.deleteItem(itemId);
        await bot.answerCallbackQuery(query.id, { text: `🗑 ${item.name} dihapus.` });
        await sendMenuManagement(chatId);
        return;
      }
      if (action === "toggle") {
        const updated = menuStore.toggleAvailable(itemId);
        const label = updated?.available ? "✅ Aktif" : "⏸ Non-aktif";
        await bot.answerCallbackQuery(query.id, { text: `${label}: ${item.name}` });
        await sendMenuManagement(chatId);
        return;
      }
      if (action === "edit") {
        menuEditState.set(userId, { phase: "edit_price", itemId, itemName: item.name });
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(
          chatId,
          `✏️ Ketik harga baru untuk *${item.name}* (contoh: 25000):`,
          { parse_mode: "Markdown" },
        );
        return;
      }
    }

    // ── Seller: terima pesanan ───────────────────────────────────────────────
    const acceptMatch = data.match(/^accept_order:(\d+)$/);
    if (acceptMatch) {
      const user = store.getUser(userId);
      if (!user || user.role !== "seller") {
        await bot.answerCallbackQuery(query.id, { text: "Hanya seller yang bisa menerima pesanan.", show_alert: true });
        return;
      }
      const orderId = parseInt(acceptMatch[1]!, 10);
      const order = store.acceptOrder(orderId, userId);
      if (!order) {
        await bot.editMessageText("⚠️ Pesanan sudah diterima atau tidak tersedia.", {
          chat_id: chatId, message_id: query.message!.message_id,
        });
        await bot.answerCallbackQuery(query.id);
        return;
      }
      logger.info({ orderId, sellerId: userId }, "Order accepted");
      await bot.editMessageText(
        `${formatOrder(order)}\n\n✅ Pesanan diterima oleh seller.`,
        { chat_id: chatId, message_id: query.message!.message_id, parse_mode: "Markdown" },
      );
      await bot.answerCallbackQuery(query.id, { text: "Pesanan diterima!" });
      await notify(order.customerId, `✅ *Pesanan #${order.id} diterima seller!*\n\nDriver akan segera mengambil pesananmu.`);
      const drivers = store.getUsersByRole("driver");
      for (const driver of drivers) {
        await notify(driver.telegramId, `🔔 *Ada Pesanan Baru untuk Diantar!*\n\nPesanan #${order.id}\n📝 ${order.description}\n\nBuka *🚚 Pengiriman Tersedia* untuk mengambil.`);
      }
      return;
    }

    // ── Driver: ambil pengiriman ─────────────────────────────────────────────
    const claimMatch = data.match(/^claim_order:(\d+)$/);
    if (claimMatch) {
      const user = store.getUser(userId);
      if (!user || user.role !== "driver") {
        await bot.answerCallbackQuery(query.id, { text: "Hanya driver yang bisa mengambil pengiriman.", show_alert: true });
        return;
      }
      const orderId = parseInt(claimMatch[1]!, 10);
      const order = store.claimOrder(orderId, userId);
      if (!order) {
        await bot.editMessageText("⚠️ Pesanan sudah diambil driver lain.", {
          chat_id: chatId, message_id: query.message!.message_id,
        });
        await bot.answerCallbackQuery(query.id);
        return;
      }
      logger.info({ orderId, driverId: userId }, "Order claimed");
      await bot.editMessageText(
        `${formatOrder(order)}\n\n🚗 Kamu sedang mengantarkan pesanan ini.`,
        { chat_id: chatId, message_id: query.message!.message_id, parse_mode: "Markdown" },
      );
      await bot.answerCallbackQuery(query.id, { text: "Pengiriman diambil!" });
      await notify(order.customerId, `🚗 *Pesanan #${order.id} sedang diantar!*\n\nDriver sedang dalam perjalanan.`);
      if (order.sellerId) {
        await notify(order.sellerId, `🚗 *Pesanan #${order.id} diambil driver.*\nSedang dalam pengiriman.`);
      }
      return;
    }

    // ── Driver: tandai terkirim ──────────────────────────────────────────────
    const deliverMatch = data.match(/^deliver_order:(\d+)$/);
    if (deliverMatch) {
      const user = store.getUser(userId);
      if (!user || user.role !== "driver") {
        await bot.answerCallbackQuery(query.id, { text: "Hanya driver yang bisa menandai kiriman.", show_alert: true });
        return;
      }
      const orderId = parseInt(deliverMatch[1]!, 10);
      const order = store.markDelivered(orderId, userId);
      if (!order) {
        await bot.answerCallbackQuery(query.id, { text: "Tidak bisa menandai pesanan ini.", show_alert: true });
        return;
      }
      logger.info({ orderId, driverId: userId }, "Order delivered");
      await bot.editMessageText(
        `${formatOrder(order)}\n\n📦 Pesanan telah berhasil dikirim!`,
        { chat_id: chatId, message_id: query.message!.message_id, parse_mode: "Markdown" },
      );
      await bot.answerCallbackQuery(query.id, { text: "Pengiriman selesai!" });

      if (order.sellerCreated) {
        // Pesanan dibuat seller → notif seller saja, tidak ada rating customer
        if (order.sellerId) {
          await notify(order.sellerId, `📦 *Pesanan #${order.id} berhasil terkirim!*\n📝 ${order.description}`);
        }
      } else {
        // Pesanan dari customer → notif seller + minta rating
        if (order.sellerId) {
          await notify(order.sellerId, `📦 *Pesanan #${order.id} berhasil terkirim!*`);
        }
        await bot.sendMessage(
          order.customerId,
          `📦 *Pesanan #${order.id} sudah sampai!*\n\n${order.description}\n\nBeri rating untuk driver kamu:`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [1, 2, 3, 4, 5].map((r) => ({
                  text: "⭐".repeat(r),
                  callback_data: `rate_order:${order.id}:${r}`,
                })),
              ],
            },
          },
        );
      }
      return;
    }

    // ── Customer: batalkan pesanan ───────────────────────────────────────────
    const cancelMatch = data.match(/^cancel_order:(\d+)$/);
    if (cancelMatch) {
      const user = store.getUser(userId);
      if (!user || user.role !== "customer") {
        await bot.answerCallbackQuery(query.id, { text: "Hanya customer yang bisa membatalkan pesanan.", show_alert: true });
        return;
      }
      const orderId = parseInt(cancelMatch[1]!, 10);
      const order = store.cancelOrder(orderId, userId);
      if (!order) {
        await bot.editMessageText("⚠️ Pesanan tidak bisa dibatalkan. Mungkin sudah diambil driver atau sudah selesai.", {
          chat_id: chatId, message_id: query.message!.message_id,
        });
        await bot.answerCallbackQuery(query.id);
        return;
      }
      logger.info({ orderId, customerId: userId }, "Order cancelled");
      await bot.editMessageText(
        `${formatOrder(order)}\n\n❌ Pesanan telah dibatalkan.`,
        { chat_id: chatId, message_id: query.message!.message_id, parse_mode: "Markdown" },
      );
      await bot.answerCallbackQuery(query.id, { text: "Pesanan dibatalkan." });
      if (order.sellerId) {
        await notify(order.sellerId, `❌ *Pesanan #${order.id} Dibatalkan*\n📝 ${order.description}\n\nCustomer membatalkan pesanan ini.`);
      }
      return;
    }

    // ── Customer: rating driver ──────────────────────────────────────────────
    const rateMatch = data.match(/^rate_order:(\d+):([1-5])$/);
    if (rateMatch) {
      const orderId = parseInt(rateMatch[1]!, 10);
      const rating = parseInt(rateMatch[2]!, 10);
      const order = store.rateOrder(orderId, userId, rating);
      if (!order) {
        await bot.answerCallbackQuery(query.id, { text: "Rating sudah diberikan atau pesanan tidak valid.", show_alert: true });
        return;
      }
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [[{ text: `${"⭐".repeat(rating)} — Terima kasih!`, callback_data: "noop" }]] },
        { chat_id: chatId, message_id: query.message!.message_id },
      );
      await bot.answerCallbackQuery(query.id, { text: `⭐ Rating ${rating}/5 diberikan!` });
      if (order.driverId) {
        await notify(order.driverId, `⭐ *Rating baru!*\n\nKamu mendapat rating *${rating}/5* untuk Pesanan #${order.id}.`);
      }
      return;
    }

    // ── Menu edit: tangani ID item dari input teks di message handler ────────
    // (Handled via menuEditState in message handler for edit_price/delete/toggle
    //  but the initial ID selection goes through the message handler)

    await bot.answerCallbackQuery(query.id);
  });

  logger.info("Bot Telegram berhasil dijalankan");
  return bot;
}
