import Stripe from 'stripe';
import Cors from 'cors';
const subscriptionStore = require('../../lib/subscriptionStore');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

const cors = Cors({
  methods: ['GET', 'POST', 'OPTIONS'],
  origin: '*',
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionId = req.query.session_id || req.body?.session_id;
  const userId = req.query.userId || req.body?.userId;

  if (!sessionId) {
    return res.status(400).json({ error: 'session_id is required' });
  }

  try {
    console.log('🔍 Verifying payment for session:', sessionId);
    
    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'subscription.items.data.price']
    });

    console.log('📊 Session details:', {
      id: session.id,
      status: session.payment_status,
      customer: session.customer,
      subscription: session.subscription?.id
    });

    if (session.payment_status !== 'paid') {
      return res.json({
        success: false,
        status: session.payment_status,
        message: 'Payment not completed yet'
      });
    }

    // Get subscription details
    let subscriptionData = null;
    if (session.subscription) {
      const subscription = typeof session.subscription === 'string' 
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;

      const priceId = subscription.items.data[0]?.price.id;
      const customerId = session.customer;
      const userIdFromSession = session.client_reference_id || userId;

      // Determine plan name from price ID
      let planName = 'Unknown Plan';
      if (priceId === process.env.STRIPE_PRICE_STARTER) planName = 'Starter';
      else if (priceId === process.env.STRIPE_PRICE_PROFESSIONAL) planName = 'Professional';
      else if (priceId === process.env.STRIPE_PRICE_PREMIUM) planName = 'Premium';
      else if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) planName = 'Enterprise';

      subscriptionData = {
        subscriptionId: subscription.id,
        customerId: customerId,
        userId: userIdFromSession,
        status: subscription.status,
        priceId: priceId,
        planName: planName,
        currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        amount: subscription.items.data[0]?.price.unit_amount / 100,
        currency: subscription.items.data[0]?.price.currency.toUpperCase(),
        interval: subscription.items.data[0]?.price.recurring?.interval,
        createdAt: new Date().toISOString()
      };

      // Save to subscription store
      if (userIdFromSession) {
        // Save customer
        subscriptionStore.saveCustomer(customerId, {
          email: session.customer_email || session.customer_details?.email,
          userId: userIdFromSession,
          name: session.customer_details?.name,
          subscriptionId: subscription.id,
          status: 'active',
          createdAt: new Date().toISOString()
        });

        // Save subscription
        subscriptionStore.saveSubscription(subscription.id, subscriptionData);
        
        console.log('✅ Subscription saved for user:', userIdFromSession);
        console.log('   Plan:', planName);
        console.log('   Status:', subscription.status);
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
