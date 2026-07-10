const nodeExternals = require('webpack-node-externals');
const webpack = require('webpack');

/**
 * Nest 官方 monorepo 打包姿势：node_modules 全部 external，
 * 仅 @star/* workspace 包（以 TS 源码消费）被打进 bundle。
 * 产物为纯 CJS 单文件 dist/main.js + external 的 node_modules（含生成的 Prisma Client）。
 */
module.exports = (options) => ({
  ...options,
  externals: [nodeExternals({ allowlist: [/^@star\//] })],
  plugins: [
    ...options.plugins,
    // NestJS 可选惰性依赖，未安装时忽略而非报错
    new webpack.IgnorePlugin({
      checkResource(resource) {
        const lazy = [
          '@nestjs/microservices',
          '@nestjs/websockets/socket-module',
          '@nestjs/microservices/microservices-module',
          'class-transformer/storage',
        ];
        if (!lazy.includes(resource)) return false;
        try {
          require.resolve(resource);
          return false;
        } catch {
          return true;
        }
      },
    }),
  ],
});
