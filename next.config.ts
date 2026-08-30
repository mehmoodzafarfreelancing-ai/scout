import type { NextConfig } from "next";

const config: NextConfig = {
  // Playwright must stay outside the serverless bundle: it is only ever loaded
  // by the CLI ingest job, and bundling it would blow the function size limit.
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default config;
