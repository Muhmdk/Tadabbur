/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" },
      { source: "/ws/:path*", destination: "http://127.0.0.1:8000/ws/:path*" },
    ];
  },
  // Allow importing the shared contract from outside the Next root.
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
