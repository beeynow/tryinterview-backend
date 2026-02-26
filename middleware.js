import { NextResponse } from 'next/server';

export function middleware(request) {
  // Allowed origins for CORS
  const allowedOrigins = [
    'http://localhost:3000',
    'https://tryinterview.site',
    'https://www.tryinterview.site',
  ];

  const origin = request.headers.get('origin');
  const response = NextResponse.next();

  // Check if origin is allowed
  const isAllowedOrigin = allowedOrigins.includes(origin) || !origin;
  const allowOrigin = isAllowedOrigin ? origin : allowedOrigins[0];

  // Set CORS headers
  response.headers.set('Access-Control-Allow-Origin', allowOrigin || '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, stripe-signature');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Max-Age', '86400');

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': allowOrigin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, stripe-signature',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
