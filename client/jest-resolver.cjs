const workletsResolver = require('react-native-worklets/jest/resolver');
const nativeResolver = require(require('@react-native/jest-preset').resolver);

module.exports = (request, options) => workletsResolver(request, {
  ...options,
  defaultResolver: (path, workletOptions) => nativeResolver(path, {
    ...workletOptions,
    defaultResolver: options.defaultResolver,
  }),
});
