// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  // Spread the recommended Obsidian config
  ...obsidianmd.configs.recommended,
  
  // Our TypeScript files configuration
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    // Project-specific overrides
    rules: {
      // Sentence case with our brand names as allowed
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: ["Calcifer", "Obsidian", "OpenAI", "Ollama"],
          acronyms: ["AI", "API", "URL", "RAG", "UI", "RPM", "OK"],
          enforceCamelCaseLower: true,
        },
      ],
    },
  },
  
  // Ignore patterns
  {
    ignores: [
      "node_modules/**",
      "main.js",
      "*.mjs",
    ],
  },
]);
