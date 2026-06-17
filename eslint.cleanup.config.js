import tseslint from 'typescript-eslint'
export default tseslint.config({
  files: ['**/*.{ts,tsx}'],
  extends: [tseslint.configs.base],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', {
      args: 'none',
      varsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    }],
  },
})
