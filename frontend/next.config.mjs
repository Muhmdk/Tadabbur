/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow importing the shared contract from outside the Next root.
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
