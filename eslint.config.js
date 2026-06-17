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
  { ignores: ["**/dist/**", "**/node_modules/**"] },
);
