import neostandard from "neostandard";
import astroParser from "astro-eslint-parser";
import eslintPluginAstro from "eslint-plugin-astro";

export default [
  // Configuración base con neostandard
  ...neostandard({
    ts: true, // Habilitar soporte para TypeScript
    noStyle: true, // Deshabilitar reglas de estilo para usar Prettier
  }),
  // Configuración específica para archivos .astro
  {
    files: ["**/*.astro"],
    languageOptions: {
      parser: astroParser,
      parserOptions: {
        parser: "@typescript-eslint/parser",
        extraFileExtensions: [".astro"],
      },
    },
    plugins: {
      astro: eslintPluginAstro,
    },
    rules: {
      // Reglas recomendadas para Astro
      ...eslintPluginAstro.configs.recommended.rules,
      // Ajustes específicos si es necesario
      "astro/no-conflict-set-directives": "error",
      "astro/no-unused-define-vars-in-style": "error",
      // Deshabilitar reglas de React que no aplican a Astro
      "react/jsx-key": "off",
      "react/self-closing-comp": "off",
      "react/jsx-no-undef": "off",
      // Prohibir console (estilo Midudev - silencio total)
      'no-console': 'error'
    },
  },

  // Reglas globales para TS/JS
  {
    files: ["**/*.ts", "**/*.js"],
    rules: {
      // Prohibir console (estilo Midudev - silencio total)
      'no-console': 'error'
    }
  },

  // Ignores
  {
    ignores: ["dist/**/*", ".astro/**/*", "node_modules/**/*", ".vercel/**/*", "eslint-rules/**/*"],
  },
];
