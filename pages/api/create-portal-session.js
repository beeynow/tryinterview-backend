import Stripe from 'stripe';
const { findActiveSubscription, findUserById } = require('../../lib/firestoreHelpers');
const { createCors, runMiddleware, requireAuth } = require('../../lib/apiUtils');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

const cors = createCors(['POST', 'GET', 'HEAD', 'OPTIONS']);

export default async function handler(req, res) {
  // Run CORS middleware
  await runMiddleware(req, res, cors);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  try {
    const subscription = await findActiveSubscription(authUser.uid);
    const user = await findUserById(authUser.uid);
    const customerId = subscription?.customerId || user?.customerId;

    if (!customerId) {
      return res.status(404).json({ error: 'No active Stripe customer found for this user' });
    }

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.FRONTEND_URL || 'https://www.tryinterview.site'}/#dashboard`,
    });

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error('Error creating portal session:', error);
    return res.status(500).json({ 
      error: 'Failed to create portal session',
      message: error.message 
    });
  }
}
