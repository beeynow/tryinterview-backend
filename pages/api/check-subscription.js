// API to check user's subscription status
const subscriptionStore = require('../../lib/subscriptionStore');
import Cors from 'cors';

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

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = req.query.userId || req.body?.userId;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    // Get subscription by user ID
    const subscription = subscriptionStore.getSubscriptionByUserId(userId);
    
    if (!subscription) {
      return res.json({
        hasSubscription: false,
        status: 'none',
        message: 'No active subscription found'
      });
    }

    return res.json({
      hasSubscription: true,
      status: subscription.status,
      priceId: subscription.priceId,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      subscription: subscription
    });

  } catch (error) {
    console.error('Error checking subscription:', error);
    return res.status(500).json({ error: 'Failed to check subscription' });
  }
}
