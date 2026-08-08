import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { lazyPlugins } from "vite-plus";

export default defineConfig(({ command }) => ({
  plugins: lazyPlugins(() => [
    ...(command === "build" ? [cloudflare({ viteEnvironment: { name: "ssr" } })] : []),
    tailwindcss(),
    reactRouter(),
  ]),
  resolve: {
    dedupe: ["react", "react-dom"],
    tsconfigPaths: true,
  },
}));
