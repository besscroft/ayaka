import desktopConfig from "./apps/desktop/eslint.config.mjs";

export default [
  ...desktopConfig,
  {
    files: ["tests/desktop/**/*.{ts,tsx}"],
    rules: {
      "prettier/prettier": "off",
    },
  },
];
