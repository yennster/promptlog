/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  transpilePackages: ["@audit/shared", "@audit/db"],
};

export default nextConfig;
