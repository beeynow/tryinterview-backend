const {
  createCors,
  getIdentityFromToken,
  requireAuth,
  runMiddleware,
} = require('../../lib/apiUtils');
const {
  getUserSettings,
  saveUserSettings,
} = require('../../lib/platformStore');

const cors = createCors(['GET', 'PUT', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authUser = await requireAuth(req, res);
  if (!authUser) {
    return;
  }

  const identity = getIdentityFromToken(authUser);

  if (req.method === 'GET') {
    try {
      const settings = await getUserSettings(identity.userId);
      return res.status(200).json({ settings });
    } catch (error) {
      console.error('Error loading settings:', error);
      return res.status(error.statusCode || 500).json({
        error: 'Failed to load settings',
        message: error.message,
      });
    }
  }

  if (req.method === 'PUT') {
    try {
      const settings = await saveUserSettings(identity.userId, req.body || {});
      return res.status(200).json({
        success: true,
        settings,
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      return res.status(error.statusCode || 500).json({
        error: 'Failed to save settings',
        message: error.message,
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
