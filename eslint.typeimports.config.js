import tseslint from 'typescript-eslint'
export default tseslint.config({
  files: ['**/*.{ts,tsx}'],
  extends: [tseslint.configs.base],
  rules: {
    '@typescript-eslint/consistent-type-imports': ['error', {
      prefer: 'type-imports',
      fixStyle: 'separate-type-imports',
    }],
  },
})
