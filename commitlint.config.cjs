/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subject line: imperative, lowercase, no trailing period
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'subject-max-length': [2, 'always', 72],
    // Type: must be one of the canonical conventional types
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'type-empty': [2, 'never'],
    'type-case': [2, 'always', 'lower-case'],
    // Body and footer: blank line between header/body
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
    // Block AI attribution per CLAUDE.md
    'footer-max-line-length': [0],
  },
};
