import Stripe from 'stripe';
const { createCors, runMiddleware, requireAuth } = require('../../lib/apiUtils');
const {
  cancelOtherSubscriptions,
  upsertSubscription,
  updateUserCustomerId
} = require('../../lib/firestoreHelpers');
const {
  buildSubscriptionRecord,
} = require('../../lib/stripeBilling');

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

      const normalizedSubscription = buildSubscriptionRecord({
        subscription,
        userId: trustedUserId,
        customerId,
        rawPayload: subscription,
      });

      subscriptionData = {
        ...normalizedSubscription,
        currentPeriodStart: normalizedSubscription.currentPeriodStart?.toISOString() || null,
        currentPeriodEnd: normalizedSubscription.currentPeriodEnd?.toISOString() || null,
        canceledAt: normalizedSubscription.canceledAt?.toISOString() || null,
      };

      if (trustedUserId) {
        // Cancel any previous active subscriptions for this user
        await cancelOtherSubscriptions(trustedUserId, subscription.id);

        const savedSub = await upsertSubscription(normalizedSubscription);

        console.log('✅ Subscription saved to database:', normalizedSubscription.planName, 'for user:', trustedUserId, '| Record ID:', savedSub?.id);

        await updateUserCustomerId(trustedUserId, customerId);
      } else {
        console.warn('⚠️ No userId found — subscription NOT saved to database. session.client_reference_id:', session.client_reference_id);
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
