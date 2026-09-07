import { defineConfig } from "wxt";

const webOrigin = process.env.WXT_PUBLIC_WEB_ORIGIN || "http://localhost:3000";
const supabaseOrigin = process.env.WXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  publicDir: "../../icons",
  manifestVersion: 3,
  manifest: {
    name: "Blueprint",
    description: "Connect your Blueprint path to focused YouTube learning sessions.",
    version: "3.0.0",
    minimum_chrome_version: "116",
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwossMlznCpyCm30nQuuuJvB47rFS14hHUr93dicJ6stkCBLBf2H4yWogmMDOUGBphWbuLB4tImLi1x4EdVJx1MpeYgePlW19u5/vYIOSyf89EnmUEYC0Bc/1VJV3ycN+Y7p2H42wAzlN0d2MwO4zsX0Om7ISjkQS+9my8vuXH1kB9FYnv5CuMz/Jgih5VFAF46FffTfYHDW/cnne5nsWwaojhP0Mxeeei6Y5oFVJOHag6pFmEriptL5dwk95vlCc7vWmkClDrqfnvWOkERXvbj/F3ZZyLeZwQozge2sD8AwaokUvIwuw12uAJKwdVGZhjJUEp4srDxLa2BLqH+VxRwIDAQAB",
    permissions: ["identity", "sidePanel", "storage", "tabs"],
    host_permissions: ["https://www.youtube.com/*", `${webOrigin}/*`, `${supabaseOrigin}/*`],
    icons: { 16: "icon16.png", 48: "icon48.png", 128: "icon128.png" },
    action: {
      default_title: "Open Blueprint",
      default_icon: { 16: "icon16.png", 48: "icon48.png", 128: "icon128.png" },
    },
  },
});
