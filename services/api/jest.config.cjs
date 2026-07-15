/** jest 配置：ts-jest 走 CJS 编译，@star/* 直接映射到共享包 TS 源码。 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  setupFiles: ['reflect-metadata'],
  moduleNameMapper: {
    '^@star/astro-data$': '<rootDir>/../../packages/astro-data/src/index.ts',
    '^@star/astro-core$': '<rootDir>/../../packages/astro-core/src/index.ts',
    '^@star/astro-ephem$': '<rootDir>/../../packages/astro-ephem/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
