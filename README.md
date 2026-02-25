# TryInterview Backend API

Next.js backend API for handling Stripe payments and webhooks for TryInterview.

## Features

- ✅ Stripe Checkout Session creation
- ✅ Customer Portal for subscription management
- ✅ Webhook handling for subscription events
- ✅ CORS configured for frontend integration
- ✅ TypeScript-ready

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Update `.env.local` with your Stripe credentials:

```env
STRIPE_SECRET_KEY=sk_test_your_actual_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
FRONTEND_URL=http://localhost:3001
PORT=3002
```

#### Get Your Stripe Secret Key:
1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy the "Secret key" (starts with `sk_test_`)
3. Add it to `.env.local`

#### Get Your Webhook Secret:
1. Go to https://dashboard.stripe.com/test/webhooks
2. Click "+ Add endpoint"
3. Endpoint URL: `http://localhost:3002/api/webhook`
4. Select events: `checkout.session.completed`, `customer.subscription.*`, `invoice.*`
5. Copy the "Signing secret" (starts with `whsec_`)
6. Add it to `.env.local`

### 3. Run Development Server

```bash
npm run dev
```

The API will run on http://localhost:3002

### 4. Test API Endpoints

**Create Checkout Session:**
```bash
curl -X POST http://localhost:3002/api/create-checkout-session \
  -H "Content-Type: application/json" \
  -d '{
    "priceId": "price_xxxxx",
    "userId": "user123",
    "email": "test@example.com"
  }'
```

**Response:**
```json
{
  "sessionId": "cs_test_xxxxx",
  "url": "https://checkout.stripe.com/c/pay/cs_test_xxxxx"
}
```

## API Endpoints

### POST /api/create-checkout-session

Creates a Stripe Checkout session for subscription.

**Request Body:**
```json
{
  "priceId": "price_xxxxx",
  "userId": "user123",
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "sessionId": "cs_test_xxxxx",
  "url": "https://checkout.stripe.com/c/pay/cs_test_xxxxx"
}
```

### POST /api/create-portal-session

Creates a Stripe Customer Portal session.

**Request Body:**
```json
{
  "customerId": "cus_xxxxx"
}
```

**Response:**
```json
{
  "url": "https://billing.stripe.com/session/xxxxx"
}
```

### POST /api/webhook

Handles Stripe webhook events.

**Events Handled:**
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

## Frontend Integration

Update your frontend Stripe service to use this backend:

```javascript
// src/services/stripeService.js
export const createCheckoutSession = async (priceId, user) => {
  try {
    const response = await fetch('http://localhost:3002/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priceId,
        userId: user.uid,
        email: user.email
      }),
    });

    const { sessionId, url } = await response.json();
    
    // Redirect to Stripe Checkout
    window.location.href = url;
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw error;
  }
};
```

## Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy!

### Other Platforms

Works with any Node.js hosting:
- Railway
- Render
- Heroku
- AWS Lambda
- Google Cloud Run

## Security Notes

- ✅ Never commit `.env.local` to git
- ✅ Use environment variables for all secrets
- ✅ Validate webhook signatures
- ✅ Use HTTPS in production
- ✅ Verify Stripe webhook events

## Troubleshooting

**CORS Errors:**
- Check `FRONTEND_URL` in `.env.local`
- Verify frontend URL matches exactly

**Webhook Not Working:**
- Check webhook secret is correct
- Verify endpoint URL in Stripe Dashboard
- Check webhook signature verification

**Checkout Session Fails:**
- Verify Stripe secret key
- Check Price IDs are correct
- Ensure products exist in Stripe Dashboard

## Support

For issues, check:
- Stripe Dashboard logs
- Next.js console output
- Browser console errors

---

Built with ❤️ for TryInterview
# tryinterview-backend
