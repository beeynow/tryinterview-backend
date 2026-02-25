// Simple in-memory subscription store
// In production, use a database (MongoDB, PostgreSQL, etc.)

class SubscriptionStore {
  constructor() {
    this.subscriptions = new Map();
    this.customers = new Map();
  }

  // Save customer info
  saveCustomer(customerId, data) {
    this.customers.set(customerId, {
      ...data,
      updatedAt: new Date().toISOString()
    });
  }

  // Get customer info
  getCustomer(customerId) {
    return this.customers.get(customerId);
  }

  // Get customer by user ID
  getCustomerByUserId(userId) {
    for (const [customerId, customer] of this.customers.entries()) {
      if (customer.userId === userId) {
        return { customerId, ...customer };
      }
    }
    return null;
  }

  // Save subscription
  saveSubscription(subscriptionId, data) {
    this.subscriptions.set(subscriptionId, {
      ...data,
      updatedAt: new Date().toISOString()
    });
  }

  // Get subscription
  getSubscription(subscriptionId) {
    return this.subscriptions.get(subscriptionId);
  }

  // Get subscription by customer ID
  getSubscriptionByCustomer(customerId) {
    for (const [subId, sub] of this.subscriptions.entries()) {
      if (sub.customerId === customerId) {
        return { subscriptionId: subId, ...sub };
      }
    }
    return null;
  }

  // Get subscription by user ID
  getSubscriptionByUserId(userId) {
    const customer = this.getCustomerByUserId(userId);
    if (customer) {
      return this.getSubscriptionByCustomer(customer.customerId);
    }
    return null;
  }

  // Get all subscriptions
  getAllSubscriptions() {
    return Array.from(this.subscriptions.entries()).map(([id, data]) => ({
      subscriptionId: id,
      ...data
    }));
  }

  // Get all customers
  getAllCustomers() {
    return Array.from(this.customers.entries()).map(([id, data]) => ({
      customerId: id,
      ...data
    }));
  }
}

// Export singleton instance
const subscriptionStore = new SubscriptionStore();
module.exports = subscriptionStore;
