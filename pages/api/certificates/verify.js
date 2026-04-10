const {
  createCors,
  runMiddleware,
} = require('../../../lib/apiUtils');
const {
  findCertificateByCode,
} = require('../../../lib/platformStore');

const cors = createCors(['GET', 'OPTIONS']);

export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const certificateCode = String(req.query.code || '').trim().toUpperCase();

  if (!certificateCode) {
    return res.status(400).json({
      error: 'Certificate code is required',
    });
  }

  try {
    const certificate = await findCertificateByCode(certificateCode);

    if (!certificate || certificate.revokedAt) {
      return res.status(404).json({
        valid: false,
        error: 'Certificate not found',
      });
    }

    return res.status(200).json({
      valid: true,
      certificate,
    });
  } catch (error) {
    console.error('Error verifying certificate:', error);
    return res.status(error.statusCode || 500).json({
      valid: false,
      error: 'Failed to verify certificate',
      message: error.message,
    });
  }
}
