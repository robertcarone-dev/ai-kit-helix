/** The retired mod no longer owns checkout selection. Explicit roots and cwd discovery remain. */
export async function connectedProjectRoot(args: string[], _validateUrl: (url: string) => string): Promise<string | null> {
  const indexes = args.flatMap((arg, i) => arg === '--helix-project' ? [i] : []);
  if (indexes.length > 1) throw new Error('Supply --helix-project only once.');
  if (!indexes.length) return null;
  const project = args[indexes[0] + 1];
  if (!project || !/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('--helix-project requires a project slug.');
  if (args.includes('--project-root') || args.includes('--help') || ['help', '-h'].includes(args[0])) return null;
  throw new Error('Workbench connections have been retired. Run inside the Unity repo without --helix-project, or supply --project-root DIR.');
}
