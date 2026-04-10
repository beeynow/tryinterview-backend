const {
  createCors,
  getIdentityFromToken,
  requireAuth,
  runMiddleware,
} = require('../../lib/apiUtils');
const {
  getDashboardSnapshot,
} = require('../../lib/platformStore');

const cors = createCors(['GET', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) {
    return;
  }

  try {
    const identity = getIdentityFromToken(authUser);
    const dashboard = await getDashboardSnapshot(identity.userId, identity);

    return res.status(200).json(dashboard);
  } catch (error) {
    console.error('Error loading dashboard:', error);
    return res.status(error.statusCode || 500).json({
      error: 'Failed to load dashboard',
      message: error.message,
    });
  }
}
