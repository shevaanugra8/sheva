export type Role = "customer" | "seller" | "driver";

export type OrderStatus =
  | "pending"
  | "accepted"
  | "picked_up"
  | "delivered"
  | "cancelled";

export interface BotUser {
  telegramId: number;
  username: string;
  role: Role;
}

export interface Order {
  id: number;
  customerId: number;
  description: string;
  status: OrderStatus;
  sellerId?: number;
  driverId?: number;
  rating?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MenuItem {
  id: number;
  category: "makanan" | "minuman";
  name: string;
  price: number;
  available: boolean;
}

export interface CartItem {
  menuItemId: number;
  name: string;
  price: number;
  qty: number;
}

export type BroadcastTarget = "all" | "customer" | "seller" | "driver";

export type MenuEditPhase =
  | { phase: "add_name" }
  | { phase: "add_category"; name: string }
  | { phase: "add_price"; name: string; category: "makanan" | "minuman" }
  | { phase: "edit_price"; itemId: number; itemName: string };

const users = new Map<number, BotUser>();
const orders = new Map<number, Order>();
let orderCounter = 1;

let menuCounter = 1;
const menuItems = new Map<number, MenuItem>();

function addMenu(category: "makanan" | "minuman", name: string, price: number): void {
  const id = menuCounter++;
  menuItems.set(id, { id, category, name, price, available: true });
}

addMenu("makanan", "Tahu Bakso 3pcs", 10000);
addMenu("makanan", "Dubai Chewy Cookie 1pcs", 20000);
addMenu("makanan", "Dimsum Goreng 4pcs", 20000);
addMenu("makanan", "Dimsum Original 4pcs", 17000);
addMenu("makanan", "Dimsum Original 6pcs", 25000);
addMenu("makanan", "Dimsum Original 8pcs", 34000);
addMenu("makanan", "Dimsum Original 10pcs", 38000);
addMenu("makanan", "Dimsum Original 16pcs", 60000);
addMenu("makanan", "Dimsum Mentai 4pcs", 20000);
addMenu("makanan", "Dimsum Mentai 6pcs", 30000);
addMenu("makanan", "Dimsum Mentai 8pcs", 40000);
addMenu("makanan", "Dimsum Mentai 10pcs", 48000);
addMenu("makanan", "Dimsum Mentai 16pcs", 75000);
addMenu("makanan", "Dimsum Half Mentai Original 4pcs", 18000);
addMenu("makanan", "Dimsum Half Mentai Original 6pcs", 28000);
addMenu("makanan", "Dimsum Half Mentai Original 8pcs", 38000);
addMenu("makanan", "Dimsum Half Mentai Original 10pcs", 44000);
addMenu("makanan", "Dimsum Half Mentai Original 16pcs", 70000);
addMenu("makanan", "Cold Press Juice", 0);
addMenu("minuman", "Missed Red Hydra 150ml", 15000);
addMenu("minuman", "Missed Yellow Boost 150ml", 15000);
addMenu("minuman", "Missed Green Detox 150ml", 15000);
addMenu("minuman", "Missed Diva Glow 150ml", 15000);
addMenu("minuman", "Missed Red Hydra 250ml", 25000);
addMenu("minuman", "Missed Yellow Boost 250ml", 25000);
addMenu("minuman", "Missed Green Detox 250ml", 25000);
addMenu("minuman", "Missed Diva Glow 250ml", 25000);

const pendingBroadcast = new Map<number, BroadcastTarget>();
const pendingRoleAuth = new Map<number, Role>();
const cartMap = new Map<number, CartItem[]>();
const menuEditMap = new Map<number, MenuEditPhase>();
const pendingCustomOrder = new Map<number, true>();

export const broadcastState = {
  setPending(adminId: number, target: BroadcastTarget): void {
    pendingBroadcast.set(adminId, target);
  },
  getPending(adminId: number): BroadcastTarget | undefined {
    return pendingBroadcast.get(adminId);
  },
  clearPending(adminId: number): void {
    pendingBroadcast.delete(adminId);
  },
};

export const roleAuthState = {
  setPending(userId: number, role: Role): void {
    pendingRoleAuth.set(userId, role);
  },
  getPending(userId: number): Role | undefined {
    return pendingRoleAuth.get(userId);
  },
  clearPending(userId: number): void {
    pendingRoleAuth.delete(userId);
  },
};

export const cartState = {
  get(userId: number): CartItem[] {
    return cartMap.get(userId) ?? [];
  },
  addItem(userId: number, item: MenuItem): void {
    const cart = cartMap.get(userId) ?? [];
    const existing = cart.find((c) => c.menuItemId === item.id);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ menuItemId: item.id, name: item.name, price: item.price, qty: 1 });
    }
    cartMap.set(userId, cart);
  },
  clear(userId: number): void {
    cartMap.delete(userId);
  },
  total(userId: number): number {
    return (cartMap.get(userId) ?? []).reduce((sum, c) => sum + c.price * c.qty, 0);
  },
  count(userId: number): number {
    return (cartMap.get(userId) ?? []).reduce((sum, c) => sum + c.qty, 0);
  },
  formatSummary(userId: number): string {
    const cart = cartMap.get(userId) ?? [];
    if (cart.length === 0) return "_Keranjang kosong_";
    const lines = cart.map(
      (c) =>
        `• ${c.qty}x ${c.name}${c.price > 0 ? ` — Rp ${(c.price * c.qty).toLocaleString("id-ID")}` : " — Harga menyusul"}`,
    );
    const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
    lines.push(`\n*Total: Rp ${total.toLocaleString("id-ID")}*`);
    return lines.join("\n");
  },
  buildDescription(userId: number): string {
    const cart = cartMap.get(userId) ?? [];
    return cart
      .map((c) =>
        c.price > 0
          ? `${c.qty}x ${c.name} (Rp ${(c.price * c.qty).toLocaleString("id-ID")})`
          : `${c.qty}x ${c.name}`,
      )
      .join(", ");
  },
};

export const menuEditState = {
  set(userId: number, state: MenuEditPhase): void {
    menuEditMap.set(userId, state);
  },
  get(userId: number): MenuEditPhase | undefined {
    return menuEditMap.get(userId);
  },
  clear(userId: number): void {
    menuEditMap.delete(userId);
  },
};

export const customOrderState = {
  set(userId: number): void {
    pendingCustomOrder.set(userId, true);
  },
  has(userId: number): boolean {
    return pendingCustomOrder.has(userId);
  },
  clear(userId: number): void {
    pendingCustomOrder.delete(userId);
  },
};

export const menuStore = {
  getAll(): MenuItem[] {
    return Array.from(menuItems.values());
  },
  getByCategory(category: "makanan" | "minuman"): MenuItem[] {
    return Array.from(menuItems.values()).filter((m) => m.category === category && m.available);
  },
  getById(id: number): MenuItem | undefined {
    return menuItems.get(id);
  },
  addItem(category: "makanan" | "minuman", name: string, price: number): MenuItem {
    const id = menuCounter++;
    const item: MenuItem = { id, category, name, price, available: true };
    menuItems.set(id, item);
    return item;
  },
  updatePrice(id: number, price: number): MenuItem | undefined {
    const item = menuItems.get(id);
    if (!item) return undefined;
    item.price = price;
    return item;
  },
  updateName(id: number, name: string): MenuItem | undefined {
    const item = menuItems.get(id);
    if (!item) return undefined;
    item.name = name;
    return item;
  },
  toggleAvailable(id: number): MenuItem | undefined {
    const item = menuItems.get(id);
    if (!item) return undefined;
    item.available = !item.available;
    return item;
  },
  deleteItem(id: number): boolean {
    return menuItems.delete(id);
  },
  formatMenuText(): string {
    const makanan = Array.from(menuItems.values()).filter((m) => m.category === "makanan");
    const minuman = Array.from(menuItems.values()).filter((m) => m.category === "minuman");
    const fmt = (items: MenuItem[]) =>
      items
        .map((m) => {
          const price = m.price > 0 ? `Rp ${m.price.toLocaleString("id-ID")}` : "Harga menyusul";
          const avail = m.available ? "" : " _(tidak tersedia)_";
          return `  [${m.id}] ${m.name} — ${price}${avail}`;
        })
        .join("\n");
    return `🍱 *MAKANAN*\n${fmt(makanan)}\n\n🥤 *MINUMAN*\n${fmt(minuman)}`;
  },
};

export const store = {
  getUser(telegramId: number): BotUser | undefined {
    return users.get(telegramId);
  },

  registerUser(telegramId: number, username: string, role: Role): BotUser {
    const user: BotUser = { telegramId, username, role };
    users.set(telegramId, user);
    return user;
  },

  createOrder(customerId: number, description: string): Order {
    const order: Order = {
      id: orderCounter++,
      customerId,
      description,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    orders.set(order.id, order);
    return order;
  },

  getOrder(id: number): Order | undefined {
    return orders.get(id);
  },

  getPendingOrders(): Order[] {
    return Array.from(orders.values()).filter((o) => o.status === "pending");
  },

  getAcceptedUnassignedOrders(): Order[] {
    return Array.from(orders.values()).filter(
      (o) => o.status === "accepted" && !o.driverId,
    );
  },

  getOrdersByCustomer(customerId: number): Order[] {
    return Array.from(orders.values()).filter(
      (o) => o.customerId === customerId,
    );
  },

  getOrdersByDriver(driverId: number): Order[] {
    return Array.from(orders.values()).filter((o) => o.driverId === driverId);
  },

  acceptOrder(orderId: number, sellerId: number): Order | undefined {
    const order = orders.get(orderId);
    if (!order || order.status !== "pending") return undefined;
    order.sellerId = sellerId;
    order.status = "accepted";
    order.updatedAt = new Date();
    return order;
  },

  claimOrder(orderId: number, driverId: number): Order | undefined {
    const order = orders.get(orderId);
    if (!order || order.status !== "accepted" || order.driverId) return undefined;
    order.driverId = driverId;
    order.status = "picked_up";
    order.updatedAt = new Date();
    return order;
  },

  markDelivered(orderId: number, driverId: number): Order | undefined {
    const order = orders.get(orderId);
    if (!order || order.driverId !== driverId || order.status !== "picked_up")
      return undefined;
    order.status = "delivered";
    order.updatedAt = new Date();
    return order;
  },

  getOrdersBySeller(sellerId: number): Order[] {
    return Array.from(orders.values()).filter((o) => o.sellerId === sellerId);
  },

  getUsersByRole(role: Role): BotUser[] {
    return Array.from(users.values()).filter((u) => u.role === role);
  },

  getHistoryByCustomer(customerId: number): Order[] {
    return Array.from(orders.values())
      .filter((o) => o.customerId === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  },

  getHistoryBySeller(sellerId: number): Order[] {
    return Array.from(orders.values())
      .filter((o) => o.sellerId === sellerId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  },

  getHistoryByDriver(driverId: number): Order[] {
    return Array.from(orders.values())
      .filter((o) => o.driverId === driverId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  },

  getStatsCustomer(customerId: number) {
    const all = Array.from(orders.values()).filter((o) => o.customerId === customerId);
    return {
      total: all.length,
      pending: all.filter((o) => o.status === "pending").length,
      accepted: all.filter((o) => o.status === "accepted").length,
      onTheWay: all.filter((o) => o.status === "picked_up").length,
      delivered: all.filter((o) => o.status === "delivered").length,
      cancelled: all.filter((o) => o.status === "cancelled").length,
    };
  },

  getStatsSeller(sellerId: number) {
    const all = Array.from(orders.values()).filter((o) => o.sellerId === sellerId);
    const pending = Array.from(orders.values()).filter((o) => o.status === "pending").length;
    return {
      totalAccepted: all.length,
      delivered: all.filter((o) => o.status === "delivered").length,
      onTheWay: all.filter((o) => o.status === "picked_up").length,
      cancelled: all.filter((o) => o.status === "cancelled").length,
      pendingIncoming: pending,
    };
  },

  getStatsDriver(driverId: number) {
    const all = Array.from(orders.values()).filter((o) => o.driverId === driverId);
    const rated = all.filter((o) => o.rating !== undefined);
    const avgRating =
      rated.length > 0
        ? rated.reduce((sum, o) => sum + (o.rating ?? 0), 0) / rated.length
        : null;
    return {
      totalClaimed: all.length,
      delivered: all.filter((o) => o.status === "delivered").length,
      onTheWay: all.filter((o) => o.status === "picked_up").length,
      available: Array.from(orders.values()).filter(
        (o) => o.status === "accepted" && !o.driverId,
      ).length,
      avgRating,
      totalRatings: rated.length,
    };
  },

  rateOrder(orderId: number, customerId: number, rating: number): Order | undefined {
    const order = orders.get(orderId);
    if (
      !order ||
      order.customerId !== customerId ||
      order.status !== "delivered" ||
      order.rating !== undefined
    )
      return undefined;
    order.rating = rating;
    return order;
  },

  cancelOrder(orderId: number, customerId: number): Order | undefined {
    const order = orders.get(orderId);
    if (!order || order.customerId !== customerId || order.status === "delivered")
      return undefined;
    order.status = "cancelled";
    order.updatedAt = new Date();
    return order;
  },
};

export const statusEmoji: Record<OrderStatus, string> = {
  pending: "⏳",
  accepted: "✅",
  picked_up: "🚗",
  delivered: "📦",
  cancelled: "❌",
};

export const SELLER_PASSWORD = process.env["SELLER_PASSWORD"] ?? "akubakol";
export const DRIVER_PASSWORD = process.env["DRIVER_PASSWORD"] ?? "akukurir";
