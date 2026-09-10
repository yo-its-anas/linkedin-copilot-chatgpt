export function normalizeAppId(value) {
  if (typeof value !== 'string') throw new Error('Use the real registered app ID.');
  const id = value.replace(/^plugin_(?=asdk_app_)/, '');
  if (!/^(asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('Use an asdk_app_, connector_, or templated_apps_ ID, not a plugin listing ID.');
  }
  return id;
}
