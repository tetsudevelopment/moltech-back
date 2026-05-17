// @ts-check
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // ── Global ignores ─────────────────────────────────────────────────────────
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.js', '*.mjs'],
  },

  // ── TypeScript base: strict + stylistic ────────────────────────────────────
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // ── Global parser options: tsconfig.test.json covers src + test + configs ──
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Main source config ─────────────────────────────────────────────────────
  {
    files: ['src/**/*.ts'],
    plugins: {
      boundaries,
      import: importPlugin,
    },
    settings: {
      // eslint-plugin-boundaries: declare architecture layers
      'boundaries/elements': [
        { type: 'app-root', pattern: 'src/{main,app.module}.ts' },
        { type: 'config', pattern: 'src/config/**' },
        { type: 'common', pattern: 'src/common/**' },
        { type: 'infrastructure', pattern: 'src/infrastructure/**' },
        { type: 'prisma', pattern: 'src/infrastructure/prisma/**' },
        { type: 'domain', pattern: 'src/modules/*/domain/**' },
        { type: 'dtos', pattern: 'src/modules/*/dtos/**' },
        { type: 'events', pattern: 'src/modules/*/events/**' },
        { type: 'listeners', pattern: 'src/modules/*/listeners/**' },
        { type: 'repositories', pattern: 'src/modules/*/repositories/**' },
        { type: 'services', pattern: 'src/modules/*/services/**' },
        { type: 'controllers', pattern: 'src/modules/*/controllers/**' },
        { type: 'module-root', pattern: 'src/modules/*/*.module.ts' },
      ],
      'boundaries/ignore': ['**/*.spec.ts', '**/*.e2e-spec.ts'],
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
        node: true,
      },
    },
    rules: {
      // ── TypeScript strict ─────────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'off',

      // ── Architecture boundaries ──────────────────────────────────────────
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // app-root can import anything
            { from: 'app-root', allow: ['*'] },
            // module-root orchestrates its own layers
            {
              from: 'module-root',
              allow: [
                'controllers',
                'services',
                'repositories',
                'listeners',
                'common',
                'config',
                'infrastructure',
              ],
            },
            // controllers: service + dtos + common + config
            {
              from: 'controllers',
              allow: ['services', 'dtos', 'common', 'config'],
            },
            // services: repos + domain + common + events + config + infrastructure
            {
              from: 'services',
              allow: [
                'repositories',
                'domain',
                'dtos',
                'events',
                'common',
                'config',
                'infrastructure',
              ],
            },
            // repositories: prisma + common + domain
            {
              from: 'repositories',
              allow: ['prisma', 'common', 'domain', 'infrastructure'],
            },
            // listeners: services + events + common
            {
              from: 'listeners',
              allow: ['services', 'events', 'common'],
            },
            // domain, dtos, events: only common (pure types)
            { from: 'domain', allow: ['common'] },
            { from: 'dtos', allow: ['common'] },
            { from: 'events', allow: ['common', 'domain'] },
            // common: config + infrastructure only
            { from: 'common', allow: ['config', 'infrastructure', 'prisma'] },
            // config: nothing from src
            { from: 'config', allow: [] },
            // infrastructure: config + common
            { from: 'infrastructure', allow: ['config', 'common'] },
            // prisma is a sub-layer of infrastructure
            { from: 'prisma', allow: ['config'] },
          ],
        },
      ],

      // ── Blocked imports (prohibited libraries) ───────────────────────────
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'class-validator',
              message: 'Use Zod for validation. class-validator is prohibited.',
            },
            {
              name: 'class-transformer',
              message: 'Use Zod for validation. class-transformer is prohibited.',
            },
            { name: 'bcrypt', message: 'Use argon2 for password hashing. bcrypt is prohibited.' },
            {
              name: 'bcryptjs',
              message: 'Use argon2 for password hashing. bcryptjs is prohibited.',
            },
          ],
        },
      ],

      // ── Block process.env outside src/config/** ──────────────────────────
      // Files in src/config/** are allowed to read process.env directly.
      // All other files must use ConfigService. Enforced via no-restricted-syntax.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[object.name="process"][property.name="env"]',
          message:
            'Access env vars via ConfigService, not process.env directly. Only src/config/** is exempt.',
        },
      ],

      // ── Console is banned — use injected Pino logger ────────────────────
      'no-console': 'error',

      // ── Import hygiene ───────────────────────────────────────────────────
      'import/no-cycle': ['error', { maxDepth: 5 }],
      'import/no-self-import': 'error',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
          pathGroups: [{ pattern: '@/**', group: 'internal', position: 'after' }],
          pathGroupsExcludedImportTypes: ['builtin'],
        },
      ],
    },
  },

  // ── src/config/** override: allow process.env here ────────────────────────
  {
    files: ['src/config/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // ── NestJS module files: empty decorator-only classes are the pattern ────
  {
    files: ['**/*.module.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },

  // ── Test files: relaxed rules ──────────────────────────────────────────────
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      // Tests can import across any layer
      'boundaries/element-types': 'off',
      // Non-null assertions are common in test assertions
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Unbound methods appear in jest.spyOn patterns
      '@typescript-eslint/unbound-method': 'off',
      // Tests frequently use explicit any for mocks
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ── Prettier: must be last to disable conflicting stylistic rules ──────────
  prettier,
);
