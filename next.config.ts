import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Suppress webpack warnings from @thatopen/components (uses node APIs)
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
  // Don't attempt to statically analyze these packages during build
  serverExternalPackages: ["three", "web-ifc"],
};

export default nextConfig;
