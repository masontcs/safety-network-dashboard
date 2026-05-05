/** @type {import('next').NextConfig} */
const nextConfig = {
  // xlsx and csv-parse use Node.js-only APIs — must not be bundled by Next.js
  serverExternalPackages: ['xlsx', 'csv-parse'],
}

module.exports = nextConfig
