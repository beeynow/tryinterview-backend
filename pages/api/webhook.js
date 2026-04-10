import Stripe from 'stripe';
import { buffer } from 'micro';
import {
  upsertSubscription,
  updateSubscription,
} from '../../lib/firestoreHelpers.js';
const {
  canUsePostgresStore,
  finalizeWebhookEvent,
  registerWebhookEvent,
} = require('../../lib/postgresStore');
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
    if (canUsePostgresStore()) {
      const shouldProcessEvent = await registerWebhookEvent({
        provider: 'stripe',
        externalEventId: event.id,
        eventType: event.type,
        payload: event.data.object,
      });

      if (!shouldProcessEvent) {
        console.log(`ℹ️ Stripe event ${event.id} already processed, skipping duplicate delivery.`);
        return res.json({ received: true, duplicate: true });
      }
    }

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

        // Save to Firestore
        try {
          if (session.subscription) {
            const subscription = await stripe.subscriptions.retrieve(session.subscription, {
              expand: ['items.data.price']
            });
            
            const priceId = subscription.items.data[0]?.price.id;
            let planName = 'Unknown Plan';
            if (priceId === process.env.STRIPE_PRICE_STARTER) planName = 'Starter';
            else if (priceId === process.env.STRIPE_PRICE_PROFESSIONAL) planName = 'Professional';
            else if (priceId === process.env.STRIPE_PRICE_PREMIUM) planName = 'Premium';

            const webhookUserId = session.client_reference_id || session.metadata?.userId;
            const saved = await upsertSubscription({
              userId: webhookUserId,
              customerId: session.customer,
              subscriptionId: subscription.id,
              priceId: priceId,
              planName: planName,
              status: subscription.status,
              amount: subscription.items.data[0]?.price.unit_amount / 100,
              currency: subscription.items.data[0]?.price.currency?.toUpperCase(),
              interval: subscription.items.data[0]?.price.recurring?.interval,
              currentPeriodStart: new Date(subscription.current_period_start * 1000),
              currentPeriodEnd: new Date(subscription.current_period_end * 1000),
              cancelAtPeriodEnd: subscription.cancel_at_period_end
            });
            console.log('   💾 Subscription saved to Firestore:', planName, '| userId:', webhookUserId, '| Doc ID:', saved?.id);
          }
        } catch (firestoreError) {
          console.error('Firestore save error:', firestoreError.message);
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

        // Update in-memory store
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

        // Update Firestore
        try {
          const updPriceId = updatedSubscription.items.data[0]?.price.id;
          let updPlanName = 'Unknown Plan';
          if (updPriceId === process.env.STRIPE_PRICE_STARTER) updPlanName = 'Starter';
          else if (updPriceId === process.env.STRIPE_PRICE_PROFESSIONAL) updPlanName = 'Professional';
          else if (updPriceId === process.env.STRIPE_PRICE_PREMIUM) updPlanName = 'Premium';

          await updateSubscription(updatedSubscription.id, {
            status: updatedSubscription.status,
            priceId: updPriceId,
            planName: updPlanName,
            amount: updatedSubscription.items.data[0]?.price.unit_amount / 100,
            currency: updatedSubscription.items.data[0]?.price.currency?.toUpperCase(),
            interval: updatedSubscription.items.data[0]?.price.recurring?.interval,
            currentPeriodStart: new Date(updatedSubscription.current_period_start * 1000),
            currentPeriodEnd: new Date(updatedSubscription.current_period_end * 1000),
            cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end
          });
          console.log('   💾 Subscription updated in Firestore:', updPlanName, updatedSubscription.status);
        } catch (firestoreError) {
          console.error('Firestore update error:', firestoreError.message);
        }
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object;
        console.log('❌ Subscription deleted:', deletedSubscription.id);
        console.log('   Customer:', deletedSubscription.customer);

        // Update in-memory store
        const deletedSub = subscriptionStore.getSubscription(deletedSubscription.id);
        if (deletedSub) {
          subscriptionStore.saveSubscription(deletedSubscription.id, {
            ...deletedSub,
            status: 'canceled',
            canceledAt: new Date().toISOString()
          });
          console.log('   💾 Subscription marked as canceled in store');
        }

        // Update Firestore
        try {
          await updateSubscription(deletedSubscription.id, {
            status: 'canceled',
            canceledAt: new Date()
          });
          console.log('   💾 Subscription marked as canceled in Firestore');
        } catch (firestoreError) {
          console.error('Firestore cancel error:', firestoreError.message);
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

    if (canUsePostgresStore()) {
      await finalizeWebhookEvent({
        provider: 'stripe',
        externalEventId: event.id,
        status: 'processed',
      });
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);

    if (canUsePostgresStore()) {
      await finalizeWebhookEvent({
        provider: 'stripe',
        externalEventId: event.id,
        status: 'failed',
        errorMessage: error.message,
      });
    }

    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
