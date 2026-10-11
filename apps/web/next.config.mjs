/** @type {import('next').NextConfig} */
const allowLocalHttpApiUrl = process.env.ALLOW_LOCAL_HTTP_API_URL === "true";

if (process.env.NODE_ENV === "production") {
  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    throw new Error("Missing required production environment variable: NEXT_PUBLIC_SITE_URL");
  }

  if (!process.env.PUBLIC_OPERATOR_NAME?.trim()) {
    throw new Error("Missing required production environment variable: PUBLIC_OPERATOR_NAME");
  }

  if (
    !process.env.PUBLIC_CONTACT_EMAIL ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.PUBLIC_CONTACT_EMAIL)
  ) {
    throw new Error("PUBLIC_CONTACT_EMAIL must be a valid email address in production");
  }

  try {
    const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL);
    if (
      siteUrl.protocol !== "https:" ||
      siteUrl.pathname !== "/" ||
      siteUrl.search ||
      siteUrl.hash ||
      siteUrl.username ||
      siteUrl.password
    ) {
      throw new Error();
    }
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a clean HTTPS origin in production");
  }

  if (!process.env.API_URL) {
    throw new Error("Missing required production environment variable: API_URL");
  }

  try {
    const url = new URL(process.env.API_URL);
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
  } catch {
    throw new Error(
      "API_URL must be a clean API origin using HTTPS in production (HTTP is allowed only for localhost CI)",
    );
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
