module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // 仅在生产环境移除所有 console（开发环境保留日志）
      process.env.NODE_ENV === 'production' ? ['transform-remove-console', { 
        exclude: [] 
      }] : null
    ].filter(Boolean),
  };
};
