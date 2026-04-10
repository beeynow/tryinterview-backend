const { createCors, requireAuth, runMiddleware } = require('../../../../lib/apiUtils');
const { findUserById, serializeDoc } = require('../../../../lib/firestoreHelpers');

const cors = createCors(['GET', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  try {
    const user = serializeDoc(await findUserById(authUser.uid));

    return res.status(200).json({
      authenticated: true,
      user: user || {
        userId: authUser.uid,
        email: authUser.email || null,
        name: authUser.name || null,
      },
    });
  } catch (error) {
    console.error('❌ Failed to resolve session user:', error);
    return res.status(500).json({
      error: 'Failed to fetch session user',
      message: error.message,
    });
  }
}
