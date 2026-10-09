import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", fullyParallel: false, workers: 1, timeout: 45000,
  use: { baseURL: "http://127.0.0.1:3000", browserName: "chromium", channel: "chrome", screenshot: "only-on-failure", trace: "retain-on-failure" },
  reporter: [["list"], ["json", { outputFile: "../../output/auth-ui-browser.json" }]],
});
