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

const users = new Map<number, BotUser>();
const orders = new Map<number, Order>();
let orderCounter = 1;

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
