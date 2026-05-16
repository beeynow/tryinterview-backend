import Stripe from 'stripe';
import { buffer } from 'micro';
const {
  upsertSubscription,
  updateSubscription,
  updateUserCustomerId,
} = require('../../lib/firestoreHelpers');
const {
  canUsePostgresStore,
  finalizeWebhookEvent,
  registerWebhookEvent,
} = require('../../lib/postgresStore');
const {
  buildSubscriptionRecord,
  getCheckoutUserId,
} = require('../../lib/stripeBilling');

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
        try {
          const webhookUserId = getCheckoutUserId(session);

          if (webhookUserId && session.customer) {
            await updateUserCustomerId(webhookUserId, session.customer);
            console.log('   💾 Customer linked to user in database');
          }

          if (!session.subscription || !webhookUserId) {
            if (!webhookUserId) {
              console.warn('   ⚠️ Missing userId on checkout session metadata; subscription sync skipped.');
            }
            break;
          }

          const subscription = await stripe.subscriptions.retrieve(session.subscription, {
            expand: ['items.data.price'],
          });
          const saved = await upsertSubscription(buildSubscriptionRecord({
            subscription,
            userId: webhookUserId,
            customerId: session.customer,
            rawPayload: subscription,
          }));

          console.log(
            '   💾 Subscription saved to database:',
            saved?.planName,
            '| userId:',
            webhookUserId,
            '| Record ID:',
            saved?.id
          );
        } catch (databaseError) {
          console.error('Database sync error:', databaseError.message);
        }
        break;

      case 'customer.subscription.created':
        const subscription = event.data.object;
        console.log('✅ Subscription created:', subscription.id);
        console.log('   Customer:', subscription.customer);
        console.log('   Status:', subscription.status);
        console.log('   Plan:', subscription.items.data[0]?.price.id);

        try {
          const subscriptionUserId = subscription.metadata?.userId || null;

          if (!subscriptionUserId) {
            console.warn('   ⚠️ Subscription metadata is missing userId; database sync skipped.');
            break;
          }

          await upsertSubscription(buildSubscriptionRecord({
            subscription,
            userId: subscriptionUserId,
            rawPayload: subscription,
          }));

          if (subscription.customer) {
            await updateUserCustomerId(subscriptionUserId, subscription.customer);
          }

          console.log('   💾 Subscription saved to database');
        } catch (databaseError) {
          console.error('Database sync error:', databaseError.message);
        }
        break;

      case 'customer.subscription.updated':
        const updatedSubscription = event.data.object;
        console.log('🔄 Subscription updated:', updatedSubscription.id);
        console.log('   New status:', updatedSubscription.status);
        console.log('   Cancel at period end:', updatedSubscription.cancel_at_period_end);

        try {
          const updateData = buildSubscriptionRecord({
            subscription: updatedSubscription,
            userId: updatedSubscription.metadata?.userId || null,
            rawPayload: updatedSubscription,
          });

          const updatedRecord = await updateSubscription(updatedSubscription.id, updateData);
          if (!updatedRecord && updateData.userId) {
            await upsertSubscription(updateData);
          }

          if (updateData.userId && updatedSubscription.customer) {
            await updateUserCustomerId(updateData.userId, updatedSubscription.customer);
          }

          console.log('   💾 Subscription updated in database');
        } catch (databaseError) {
          console.error('Database update error:', databaseError.message);
        }
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object;
        console.log('❌ Subscription deleted:', deletedSubscription.id);
        console.log('   Customer:', deletedSubscription.customer);

        try {
          const cancelData = buildSubscriptionRecord({
            subscription: deletedSubscription,
            userId: deletedSubscription.metadata?.userId || null,
            rawPayload: deletedSubscription,
          });
          cancelData.status = 'canceled';
          cancelData.canceledAt = cancelData.canceledAt || new Date();

          const deletedRecord = await updateSubscription(deletedSubscription.id, cancelData);
          if (!deletedRecord && cancelData.userId) {
            await upsertSubscription(cancelData);
          }

          console.log('   💾 Subscription marked as canceled in database');
        } catch (databaseError) {
          console.error('Database cancel error:', databaseError.message);
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
