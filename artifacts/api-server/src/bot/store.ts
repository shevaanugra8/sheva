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
