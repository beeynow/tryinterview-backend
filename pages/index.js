export default function Home() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      padding: '2rem'
    }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>🚀 TryInterview API</h1>
      <p style={{ fontSize: '1.25rem', marginBottom: '2rem', opacity: 0.9 }}>
        Backend API for Stripe Payments
      </p>
      
      <div style={{
        background: 'rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(10px)',
        padding: '2rem',
        borderRadius: '12px',
        maxWidth: '600px',
        textAlign: 'left'
      }}>
        <h2 style={{ marginBottom: '1rem' }}>✅ API Status: Running</h2>
        
        <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Available Endpoints:</h3>
        <ul style={{ lineHeight: '1.8' }}>
          <li><code>POST /api/create-checkout-session</code></li>
          <li><code>POST /api/create-portal-session</code></li>
          <li><code>POST /api/webhook</code></li>
        </ul>

        <p style={{ marginTop: '1.5rem', fontSize: '0.9rem', opacity: 0.8 }}>
          📚 See <code>README.md</code> for API documentation
        </p>
      </div>
    </div>
  );
}
