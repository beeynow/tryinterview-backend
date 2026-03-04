import Cors from 'cors';
import Stripe from 'stripe';
import {
  findActiveSubscription,
  upsertSubscription
} from '../../lib/firestoreHelpers.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

const cors = Cors({
  methods: ['GET', 'OPTIONS'],
  origin: '*',
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = req.query;

  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    console.log('🔍 Checking subscription for userId:', userId);

    // Find active subscription in Firestore
    let subscription = await findActiveSubscription(userId);

    // If not in DB, check Stripe directly
    if (!subscription) {
      console.log('💡 Not in DB, checking Stripe directly...');
      try {
        const customers = await stripe.customers.search({
          query: `metadata[\'userId\']:\'${userId}\'`,
          limit: 1
        });

        if (customers.data.length > 0) {
          const customer = customers.data[0];
          const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'active',
            limit: 1,
            expand: ['data.items.data.price']
          });

          if (subscriptions.data.length > 0) {
            const stripeSub = subscriptions.data[0];
            const priceId = stripeSub.items.data[0]?.price.id;

            let planName = 'Unknown Plan';
            if (priceId === process.env.STRIPE_PRICE_STARTER) planName = 'Starter';
            else if (priceId === process.env.STRIPE_PRICE_PROFESSIONAL) planName = 'Professional';
            else if (priceId === process.env.STRIPE_PRICE_PREMIUM) planName = 'Premium';
            else if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) planName = 'Enterprise';

            // Save to Firestore
            subscription = await upsertSubscription({
              userId,
              customerId: customer.id,
              subscriptionId: stripeSub.id,
              priceId,
              planName,
              status: 'active',
              amount: stripeSub.items.data[0]?.price.unit_amount / 100,
              currency: stripeSub.items.data[0]?.price.currency?.toUpperCase(),
              interval: stripeSub.items.data[0]?.price.recurring?.interval,
              currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
              currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
              cancelAtPeriodEnd: stripeSub.cancel_at_period_end
            });

            console.log('✅ Subscription synced from Stripe to Firestore:', planName);
          }
        }
      } catch (stripeError) {
        console.error('Stripe lookup error:', stripeError.message);
      }
    }

    if (!subscription || subscription.status !== 'active') {
      return res.json({ hasSubscription: false, status: 'none' });
    }

    console.log('✅ Returning subscription:', subscription.planName, subscription.priceId);
    return res.json({
      hasSubscription: true,
      status: subscription.status,
      priceId: subscription.priceId,
      planName: subscription.planName,
      subscriptionId: subscription.subscriptionId,
      customerId: subscription.customerId,
      currentPeriodEnd: subscription.currentPeriodEnd,
      currentPeriodStart: subscription.currentPeriodStart,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
      amount: subscription.amount,
      currency: subscription.currency,
      interval: subscription.interval,
    });

  } catch (error) {
    console.error('❌ Error checking subscription:', error);
    return res.status(500).json({ error: 'Failed to check subscription' });
  }
}
