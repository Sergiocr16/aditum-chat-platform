import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@aditum-chat/shared'],
  // SPA client-side (Firebase SDK): export estático a Firebase Hosting (CDN puro).
  output: 'export',
  images: { unoptimized: true },
};

export default nextConfig;
