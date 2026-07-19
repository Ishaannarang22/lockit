import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      // A leading underscore marks an intentionally-unused binding
      // (e.g. type-shape assertions in tests).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // The marketing site under www/ is a dependency-free, browser-targeted static
  // site (plain IIFE JS), intentionally outside the TypeScript/package toolchain.
  { ignores: ["**/dist/**", "**/node_modules/**", "www/**"] },
);
