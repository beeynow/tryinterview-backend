const { createCors, runMiddleware } = require('../../../../lib/apiUtils');
const { createCsrfHandshake } = require('../../../../lib/sessionStore');

const cors = createCors(['GET', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const csrfToken = await createCsrfHandshake(res);
  return res.status(200).json({ csrfToken });
}
