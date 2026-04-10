import Stripe from 'stripe';
const {
  findActiveSubscription,
  findUserById,
  upsertSubscription,
  serializeDoc,
} = require('../../lib/firestoreHelpers');
const { createCors, runMiddleware, requireAuth } = require('../../lib/apiUtils');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

const cors = createCors(['GET', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;
  const userId = authUser.uid;

  try {
    console.log('🔍 Checking subscription for userId:', userId);

    // Find active subscription in Firestore
    let subscription = serializeDoc(await findActiveSubscription(userId));
    const user = serializeDoc(await findUserById(userId));

    // If not in DB, check Stripe directly
    if (!subscription) {
      console.log('💡 Not in DB, checking Stripe directly...');
      try {
        let customer = null;

        if (user?.customerId) {
          customer = await stripe.customers.retrieve(user.customerId);
        } else if (authUser.email) {
          const customers = await stripe.customers.list({
            email: authUser.email,
            limit: 1,
          });
          customer = customers.data[0] || null;
        }

        if (customer) {
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

            // Save to Firestore
            subscription = serializeDoc(await upsertSubscription({
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
            }));

            console.log('✅ Subscription synced from Stripe to Firestore:', planName);
          }
        }
      } catch (stripeError) {
        console.error('Stripe lookup error:', stripeError.message);
      }
    }

    if (!subscription || subscription.status !== 'active') {
      return res.json({
        hasSubscription: false,
        status: 'free',
        planName: 'Free',
        trialMockInterviews: 1,
      });
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
