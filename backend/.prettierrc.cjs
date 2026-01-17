module.exports = {
  semi: true,
  trailingComma: 'all',
  singleQuote: true,
  printWidth: 120,
  tabWidth: 2,
  useTabs: false,
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'auto',

  // File-specific overrides
  overrides: [
    {
      files: '*.md',
      options: {
        proseWrap: 'always',
        printWidth: 80,
      },
    },
    {
      files: '*.{yaml,yml}',
      options: {
        singleQuote: false,
      },
    },
  ],
};
