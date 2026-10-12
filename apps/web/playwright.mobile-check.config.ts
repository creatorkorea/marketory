import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig(base, {
  testMatch: /(?:auth|seller)\.spec\.ts/,
  use: { ...base.use, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  reporter: [["list"], ["json", { outputFile: "../../output/mobile-browser-20261012.json" }]],
});
