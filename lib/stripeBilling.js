function getPlanNameFromPriceId(priceId) {
  if (!priceId) {
    return 'Unknown Plan';
  }

  if (priceId === process.env.STRIPE_PRICE_STARTER) {
    return 'Starter';
  }

  if (priceId === process.env.STRIPE_PRICE_PROFESSIONAL) {
    return 'Professional';
  }

  if (priceId === process.env.STRIPE_PRICE_PREMIUM) {
    return 'Premium';
  }

  return 'Unknown Plan';
}

function toDateFromUnixSeconds(value) {
  if (!value && value !== 0) {
    return null;
  }

  return new Date(Number(value) * 1000);
}

function getPrimarySubscriptionItem(subscription) {
  return subscription?.items?.data?.[0] || null;
}

function getCheckoutUserId(session) {
  return session?.client_reference_id || session?.metadata?.userId || null;
}

function getStripeCustomerId(value) {
  if (!value) {
    return null;
  }

  return typeof value === 'string' ? value : value.id || null;
}

function buildSubscriptionRecord({
  subscription,
  userId,
  customerId = null,
  rawPayload = null,
}) {
  const primaryItem = getPrimarySubscriptionItem(subscription);
  const price = primaryItem?.price || null;
  const priceId = price?.id || null;

  return {
    userId,
    customerId: customerId ?? getStripeCustomerId(subscription?.customer),
    subscriptionId: subscription.id,
    priceId,
    planName: getPlanNameFromPriceId(priceId),
    status: subscription.status,
    amount: typeof price?.unit_amount === 'number' ? price.unit_amount / 100 : null,
    currency: price?.currency ? String(price.currency).toUpperCase() : null,
    interval: price?.recurring?.interval || null,
    currentPeriodStart: toDateFromUnixSeconds(subscription.current_period_start),
    currentPeriodEnd: toDateFromUnixSeconds(subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: toDateFromUnixSeconds(subscription.canceled_at),
    rawPayload,
  };
}

module.exports = {
  buildSubscriptionRecord,
  getCheckoutUserId,
  getPlanNameFromPriceId,
  getStripeCustomerId,
  toDateFromUnixSeconds,
};
