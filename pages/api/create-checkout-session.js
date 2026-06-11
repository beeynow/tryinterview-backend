import Stripe from 'stripe';
const { findUserById } = require('../../lib/firestoreHelpers');
const { createCors, runMiddleware, requireAuth } = require('../../lib/apiUtils');

// Initialize Stripe with secret key from environment
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

const cors = createCors(['POST', 'GET', 'HEAD', 'OPTIONS']);

export default async function handler(req, res) {
  // Run CORS middleware
  await runMiddleware(req, res, cors);

  // Only allow POST requests (after OPTIONS is handled by CORS)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) return;
  const requestPriceId = req.body?.priceId;

  try {
    const { priceId } = req.body || {};
    const userId = authUser.uid;
    const email = authUser.email || req.body?.email;
    const existingUser = await findUserById(userId);

    // Validate required fields
    if (!priceId) {
      return res.status(400).json({ error: 'Price ID is required' });
    }

    if (!existingUser?.customerId && !email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate that it's a price ID (starts with 'price_'), not a product ID
    if (priceId.startsWith('prod_')) {
      return res.status(400).json({ 
        error: 'Invalid Price ID',
        message: 'You provided a Product ID (prod_). Please provide a Price ID (price_) instead. In Stripe Dashboard, go to your product and copy the Price ID from the pricing section.'
      });
    }

    if (!priceId.startsWith('price_')) {
      return res.status(400).json({ 
        error: 'Invalid Price ID',
        message: 'Price ID must start with "price_". Please check your Stripe Dashboard.'
      });
    }

    const sessionPayload = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL || 'https://www.tryintervies.site'}?payment_success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://www.tryinterviews.site'}?payment_canceled=true`,
      client_reference_id: userId,
      metadata: {
        userId,
      },
      subscription_data: {
        metadata: {
          userId,
        },
      },
    };

    if (existingUser?.customerId) {
      sessionPayload.customer = existingUser.customerId;
    } else {
      sessionPayload.customer_email = email;
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create(sessionPayload);

    // Return the session ID
    return res.status(200).json({ 
      sessionId: session.id,
      url: session.url 
    });

  } catch (error) {
    console.error('Error creating checkout session:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      priceId: requestPriceId,
      userId: authUser.uid,
      email: authUser.email || req.body?.email
    });
    return res.status(500).json({ 
      error: 'Failed to create checkout session',
      message: error.message,
      details: error.toString()
    });
  }
}
