export const sceneProfiles = ['all', 'layout', 'geometry', 'appearance', 'motion'];
export function validateSceneOptions(options: any = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new Error('Scene options must be an object');
  for (const k of Object.keys(options))
    if (!['profile', 'semanticIds', 'includeDescendants', 'geometryRevision'].includes(k))
      throw new Error('Unknown scene option ' + k);
  if (!sceneProfiles.includes(options.profile ?? 'all')) throw new Error('Unknown scene profile');
  if (
    options.semanticIds !== undefined &&
    (!Array.isArray(options.semanticIds) ||
      !options.semanticIds.length ||
      options.semanticIds.some((id) => typeof id !== 'string' || !id) ||
      new Set(options.semanticIds).size !== options.semanticIds.length)
  )
    throw new Error('semanticIds must be a nonempty unique list');
  if (options.includeDescendants !== undefined && typeof options.includeDescendants !== 'boolean')
    throw new Error('includeDescendants must be boolean');
  if (options.geometryRevision !== undefined && typeof options.geometryRevision !== 'string')
    throw new Error('geometryRevision must be a string');
  return { ...options, profile: options.profile ?? 'all' };
}
export function resolveSceneOptions(config: any, name?: string) {
  return validateSceneOptions(name ? (config.sceneProfiles?.[name] ?? { profile: name }) : {});
}
