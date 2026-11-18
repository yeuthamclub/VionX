// Expo's default Metro config detects the pnpm monorepo (watchFolders, node_modules paths).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// macOS writes AppleDouble `._*` files on ExFAT drives; expo-router would load them as routes.
const appleDouble = /(^|[\\/])\._[^\\/]*$/;
const blockList = config.resolver.blockList;
config.resolver.blockList = blockList
  ? [...(Array.isArray(blockList) ? blockList : [blockList]), appleDouble]
  : appleDouble;

module.exports = config;
