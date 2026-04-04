const {
  findUserById,
  findActiveSubscription,
  upsertUser,
  serializeDoc,
} = require('../../lib/firestoreHelpers');
const {
  createCors,
  runMiddleware,
  requireAuth,
  getIdentityFromToken,
} = require('../../lib/apiUtils');

const cors = createCors(['GET', 'POST', 'PUT', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') return res.status(200).end();
  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const { userId, email: tokenEmail, name: tokenName, photoURL: tokenPhotoURL, provider: tokenProvider } =
    getIdentityFromToken(authUser);

  // GET - Get user profile
  if (req.method === 'GET') {
    try {
      const user = serializeDoc(await findUserById(userId));
      const subscription = serializeDoc(await findActiveSubscription(userId));

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
          interviewType: user.interviewType,
          availability: user.availability,
          notifications: user.notifications,
          customerId: user.customerId,
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
      const existingUser = await findUserById(userId);
      const {
        email,
        name,
        photoURL,
        provider,
        onboarded,
        jobTitle,
        experience,
        skills,
        goals,
        interviewType,
        availability,
        notifications,
      } = req.body || {};

      const userData = {
        userId,
        lastLoginAt: new Date(),
      };

      // Only add defined fields
      if (email || tokenEmail) userData.email = email || tokenEmail;
      if (name !== undefined && name !== null && name !== '') {
        userData.name = name;
      } else if (!existingUser?.name && tokenName) {
        userData.name = tokenName;
      }
      if (photoURL || tokenPhotoURL) userData.photoURL = photoURL || tokenPhotoURL;
      if (provider || tokenProvider) userData.provider = provider || tokenProvider;
      if (onboarded !== undefined) userData.onboarded = onboarded;
      if (jobTitle) userData.jobTitle = jobTitle;
      if (experience) userData.experience = experience;
      if (skills) userData.skills = skills;
      if (goals) userData.goals = goals;
      if (interviewType) userData.interviewType = interviewType;
      if (availability) userData.availability = availability;
      if (notifications !== undefined) userData.notifications = notifications;

      const user = await upsertUser(userData);

      console.log('✅ User profile saved to Firestore:', userId);
      return res.json({ success: true, user: serializeDoc(user) });
    } catch (error) {
      console.error('Error saving profile:', error);
      return res.status(500).json({ error: 'Failed to save profile' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
