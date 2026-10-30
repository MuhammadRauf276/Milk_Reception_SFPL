/** @type {import('next').NextConfig} */
const os = require('os');

const localIps = Object.values(os.networkInterfaces())
  .flat()
  .filter((net) => net && net.family === 'IPv4' && !net.internal)
  .map((net) => net.address);

// Report-only for now: violations are logged by the browser but nothing is blocked.
// Switch the header name to 'Content-Security-Policy' once the report is clean.
const contentSecurityPolicy = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()' },
  { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy },
];

if (process.env.NODE_ENV === 'production') {
  securityHeaders.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000' });
}

const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Ignore internal Turbopack generated type errors on Windows paths
    ignoreBuildErrors: true,
  },
  allowedDevOrigins: [
    'localhost',
    'localhost:3000',
    '127.0.0.1',
    '127.0.0.1:3000',
    '10.168.254.155',
    '10.168.254.155:3000',
    ...localIps,
    ...localIps.map((ip) => `${ip}:3000`),
  ],
  async redirects() {
    return [
      {
        source: '/department/qa-manager',
        destination: '/department/qa-head',
        permanent: true,
      },
      {
        source: '/department/qa-manager/:path*',
        destination: '/department/qa-head',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
