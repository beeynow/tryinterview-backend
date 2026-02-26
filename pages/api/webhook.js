import Stripe from 'stripe';
import { buffer } from 'micro';
const subscriptionStore = require('../../lib/subscriptionStore');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle the event
  console.log(`\n🔔 Webhook Event: ${event.type}`);
  
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        console.log('✅ Checkout session completed:', session.id);
        console.log('   Customer:', session.customer);
        console.log('   Subscription:', session.subscription);
        
        // Save customer info
        if (session.customer) {
          subscriptionStore.saveCustomer(session.customer, {
            email: session.customer_email,
            userId: session.metadata?.userId,
            name: session.customer_details?.name,
            subscriptionId: session.subscription,
            status: 'active',
            createdAt: new Date().toISOString()
          });
          console.log('   💾 Customer saved to store');
        }
        break;

      case 'customer.subscription.created':
        const subscription = event.data.object;
        console.log('✅ Subscription created:', subscription.id);
        console.log('   Customer:', subscription.customer);
        console.log('   Status:', subscription.status);
        console.log('   Plan:', subscription.items.data[0]?.price.id);
        
        // Save subscription
        subscriptionStore.saveSubscription(subscription.id, {
          customerId: subscription.customer,
          status: subscription.status,
          priceId: subscription.items.data[0]?.price.id,
          currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          createdAt: new Date().toISOString()
        });
        console.log('   💾 Subscription saved to store');
        break;

      case 'customer.subscription.updated':
        const updatedSubscription = event.data.object;
        console.log('🔄 Subscription updated:', updatedSubscription.id);
        console.log('   New status:', updatedSubscription.status);
        console.log('   Cancel at period end:', updatedSubscription.cancel_at_period_end);
        
        // Update subscription
        const existingSub = subscriptionStore.getSubscription(updatedSubscription.id);
        if (existingSub) {
          subscriptionStore.saveSubscription(updatedSubscription.id, {
            ...existingSub,
            status: updatedSubscription.status,
            priceId: updatedSubscription.items.data[0]?.price.id,
            currentPeriodStart: new Date(updatedSubscription.current_period_start * 1000).toISOString(),
            currentPeriodEnd: new Date(updatedSubscription.current_period_end * 1000).toISOString(),
            cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end
          });
          console.log('   💾 Subscription updated in store');
        }
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object;
        console.log('❌ Subscription deleted:', deletedSubscription.id);
        console.log('   Customer:', deletedSubscription.customer);
        
        // Update subscription status
        const deletedSub = subscriptionStore.getSubscription(deletedSubscription.id);
        if (deletedSub) {
          subscriptionStore.saveSubscription(deletedSubscription.id, {
            ...deletedSub,
            status: 'canceled',
            canceledAt: new Date().toISOString()
          });
          console.log('   💾 Subscription marked as canceled');
        }
        break;

      case 'invoice.payment_succeeded':
        const invoice = event.data.object;
        console.log('💰 Payment succeeded for invoice:', invoice.id);
        console.log('   Amount:', invoice.amount_paid / 100, invoice.currency.toUpperCase());
        console.log('   Customer:', invoice.customer);
        console.log('   Subscription:', invoice.subscription);
        break;

      case 'invoice.payment_failed':
        const failedInvoice = event.data.object;
        console.log('❌ Payment failed for invoice:', failedInvoice.id);
        console.log('   Customer:', failedInvoice.customer);
        console.log('   Amount:', failedInvoice.amount_due / 100, failedInvoice.currency.toUpperCase());
        break;

      case 'customer.created':
        const customer = event.data.object;
        console.log('👤 Customer created:', customer.id);
        console.log('   Email:', customer.email);
        break;

      case 'customer.updated':
        const updatedCustomer = event.data.object;
        console.log('👤 Customer updated:', updatedCustomer.id);
        break;

      case 'checkout.session.expired':
        const expiredSession = event.data.object;
        console.log('⏱️ Checkout session expired:', expiredSession.id);
        console.log('   Customer email:', expiredSession.customer_email);
        console.log('   Created:', new Date(expiredSession.created * 1000).toISOString());
        // Optional: Track abandoned checkouts for follow-up
        break;

      case 'payment_intent.succeeded':
        const successfulIntent = event.data.object;
        console.log('💳 Payment intent succeeded:', successfulIntent.id);
        console.log('   Amount:', successfulIntent.amount / 100, successfulIntent.currency.toUpperCase());
        console.log('   Customer:', successfulIntent.customer);
        // This confirms delayed payment methods succeeded
        break;

      case 'payment_intent.payment_failed':
        const failedIntent = event.data.object;
        console.log('❌ Payment intent failed:', failedIntent.id);
        console.log('   Amount:', failedIntent.amount / 100, failedIntent.currency.toUpperCase());
        console.log('   Customer:', failedIntent.customer);
        console.log('   Error:', failedIntent.last_payment_error?.message || 'Unknown error');
        // Handle failed delayed payment
        break;

      default:
        console.log(`ℹ️  Unhandled event type: ${event.type}`);
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
