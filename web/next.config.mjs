/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export -> ./out, served by the Go backend (no Node runtime needed).
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,
};

export default nextConfig;
