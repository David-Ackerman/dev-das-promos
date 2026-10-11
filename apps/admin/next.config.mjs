/** @type {import('next').NextConfig} */
const allowLocalHttpApiUrl = process.env.ALLOW_LOCAL_HTTP_API_URL === "true";

if (process.env.NODE_ENV === "production") {
  const requiredUrls = ["API_URL", "NEXT_PUBLIC_API_URL"];
  const missing = requiredUrls.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }

  const parsedUrls = new Map();
  for (const name of requiredUrls) {
    try {
      const url = new URL(process.env[name]);
      if (
        url.protocol !== "https:" &&
        !(
          allowLocalHttpApiUrl &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        )
      ) {
        throw new Error();
      }
      if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        throw new Error();
      }
      parsedUrls.set(name, url);
    } catch {
      throw new Error(
        `${name} must be a clean API origin using HTTPS in production (HTTP is allowed only for localhost CI)`,
      );
    }
  }

  if (parsedUrls.get("API_URL").origin !== parsedUrls.get("NEXT_PUBLIC_API_URL").origin) {
    throw new Error("API_URL and NEXT_PUBLIC_API_URL must point to the same API origin");
  }
}

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.media-amazon.com" },
      { protocol: "https", hostname: "**.susercontent.com" },
      { protocol: "https", hostname: "**.shopee.com.br" },
      { protocol: "https", hostname: "**.mlstatic.com" },
      { protocol: "https", hostname: "images.example.com" },
    ],
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
