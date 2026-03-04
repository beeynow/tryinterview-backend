import Cors from 'cors';
import {
  findUserById,
  findActiveSubscription,
  upsertUser
} from '../../lib/firestoreHelpers.js';

const cors = Cors({
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  origin: '*',
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  // GET - Get user profile
  if (req.method === 'GET') {
    try {
      const user = await findUserById(userId);
      const subscription = await findActiveSubscription(userId);

      if (!user) {
        return res.json({ exists: false });
      }

      return res.json({
        exists: true,
        user: {
          userId: user.userId,
          email: user.email,
          name: user.name,
          photoURL: user.photoURL,
          provider: user.provider,
          onboarded: user.onboarded,
          jobTitle: user.jobTitle,
          experience: user.experience,
          skills: user.skills,
          goals: user.goals,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
        },
        subscription: subscription ? {
          hasSubscription: true,
          planName: subscription.planName,
          status: subscription.status,
          priceId: subscription.priceId,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          amount: subscription.amount,
          currency: subscription.currency,
          interval: subscription.interval,
        } : { hasSubscription: false }
      });
    } catch (error) {
      console.error('Error getting profile:', error);
      return res.status(500).json({ error: 'Failed to get profile' });
    }
  }

  // POST/PUT - Create or update user profile
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const { email, name, photoURL, provider, onboarded, jobTitle, experience, skills, goals } = req.body;

      const userData = {
        userId,
        lastLoginAt: new Date()
      };

      // Only add defined fields
      if (email) userData.email = email;
      if (name) userData.name = name;
      if (photoURL) userData.photoURL = photoURL;
      if (provider) userData.provider = provider;
      if (onboarded !== undefined) userData.onboarded = onboarded;
      if (jobTitle) userData.jobTitle = jobTitle;
      if (experience) userData.experience = experience;
      if (skills) userData.skills = skills;
      if (goals) userData.goals = goals;

      const user = await upsertUser(userData);

      console.log('✅ User profile saved to Firestore:', userId);
      return res.json({ success: true, user });
    } catch (error) {
      console.error('Error saving profile:', error);
      return res.status(500).json({ error: 'Failed to save profile' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
