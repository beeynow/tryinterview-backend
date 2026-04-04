import Stripe from 'stripe';
const { createCors, runMiddleware, requireAuth } = require('../../lib/apiUtils');
const {
  cancelOtherSubscriptions,
  upsertSubscription,
  updateUserCustomerId
} = require('../../lib/firestoreHelpers');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

const cors = createCors(['GET', 'POST', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const sessionId = req.query.session_id || req.body?.session_id;

  if (!sessionId) return res.status(400).json({ error: 'session_id is required' });

  try {
    console.log('🔍 Verifying payment for session:', sessionId);

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'subscription.items.data.price', 'customer']
    });

    console.log('📊 Session status:', session.payment_status);

    if (session.payment_status !== 'paid') {
      return res.json({
        success: false,
        status: session.payment_status,
        message: 'Payment not completed yet'
      });
    }

    let subscriptionData = null;

    if (session.subscription) {
      const subscription = typeof session.subscription === 'string'
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;

      const priceId = subscription.items.data[0]?.price.id;
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const userIdFromSession =
        session.client_reference_id ||
        session.metadata?.userId ||
        subscription.metadata?.userId;
      const sessionEmail = session.customer_details?.email || session.customer_email || null;

      if (userIdFromSession && userIdFromSession !== authUser.uid) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'This checkout session does not belong to the authenticated user.',
        });
      }

      if (!userIdFromSession) {
        if (!authUser.email || !sessionEmail || sessionEmail !== authUser.email) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: 'The checkout session could not be matched to the authenticated user.',
          });
        }
      }

      const trustedUserId = userIdFromSession || authUser.uid;

      let planName = 'Unknown Plan';
      if (priceId === process.env.STRIPE_PRICE_STARTER) planName = 'Starter';
      else if (priceId === process.env.STRIPE_PRICE_PROFESSIONAL) planName = 'Professional';
      else if (priceId === process.env.STRIPE_PRICE_PREMIUM) planName = 'Premium';
      else if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) planName = 'Enterprise';

      subscriptionData = {
        subscriptionId: subscription.id,
        customerId,
        userId: trustedUserId,
        status: subscription.status,
        priceId,
        planName,
        currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        amount: subscription.items.data[0]?.price.unit_amount / 100,
        currency: subscription.items.data[0]?.price.currency?.toUpperCase(),
        interval: subscription.items.data[0]?.price.recurring?.interval,
      };

      if (trustedUserId) {
        // Cancel any previous active subscriptions for this user
        await cancelOtherSubscriptions(trustedUserId, subscription.id);

        // Upsert new subscription to Firestore
        const savedSub = await upsertSubscription({
          userId: trustedUserId,
          customerId,
          subscriptionId: subscription.id,
          priceId,
          planName,
          status: subscription.status,
          amount: subscription.items.data[0]?.price.unit_amount / 100,
          currency: subscription.items.data[0]?.price.currency?.toUpperCase(),
          interval: subscription.items.data[0]?.price.recurring?.interval,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end
        });

        console.log('✅ Subscription saved to Firestore:', planName, 'for user:', trustedUserId, '| Doc ID:', savedSub?.id);

        // Update user's stripeCustomerId
        await updateUserCustomerId(trustedUserId, customerId);
      } else {
        console.warn('⚠️ No userId found — subscription NOT saved to Firestore. session.client_reference_id:', session.client_reference_id);
      }
    }

    return res.json({
      success: true,
      paymentStatus: session.payment_status,
      subscription: subscriptionData,
      message: 'Payment verified successfully'
    });

  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to verify payment',
      message: error.message
    });
  }
}
