import { sha } from './config.ts';
import { resolve, relative, join, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';

export function unityRevision(root: string) {
  const git = (args: string[]) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
    killSignal: 'SIGKILL',
  }).trimEnd();
  return { projectRoot: root, revision: git(['rev-parse', 'HEAD']), workingTree: git(['status', '--porcelain']) };
}

export const unityStages = ['preflight', 'prepare', 'capture', 'restore'] as const;

/** Explicit backend recipes; legacy argument arrays remain AI Kit recipes. */
export function unityPlan(
  config: any,
  root: string,
  scenario: string,
  viewport: string,
  output: string,
) {
  const recipe = config.scenarios?.[scenario]?.unity,
    size = config.viewports?.[viewport];
  if (!recipe || !size || !output)
    throw new Error('Unity plan requires a recipe, viewport and output.');
  const backend = recipe.backend ?? 'ai-kit';
  if (!['ai-kit', 'unity'].includes(backend))
    throw new Error('Unity backend must be ai-kit or unity.');
  const stages = recipe.stages ?? recipe;
  const out = resolve(root, output),
    within = relative(join(root, '.aikit/scratch'), out);
  if (!within || within.startsWith('..') || isAbsolute(within))
    throw new Error('Unity output must be below this checkout’s .aikit/scratch directory.');
  const values: any = {
    out,
    scenario,
    width: size.width,
    height: size.height,
    capture: join(out, 'unity.png'),
    receipt: join(out, 'unity.json'),
    projectRoot: root,
  };
  const render = (arg: string) =>
    arg.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!(key in values)) throw new Error('Unknown recipe placeholder ' + key);
      return arg === '{{' + key + '}}' || typeof values[key] === 'number'
        ? String(values[key])
        : JSON.stringify(values[key]).slice(1, -1);
    });
  const rendered = Object.fromEntries(
    unityStages.map((stage) => {
      const commands = stages[stage];
      if (!Array.isArray(commands) || !commands.length)
        throw new Error('Incomplete Unity lifecycle recipe: ' + stage);
      const rows = Array.isArray(commands[0]) ? commands : [commands];
      return [
        stage,
        rows.map((argv: any) => {
          if (
            !Array.isArray(argv) ||
            !argv.length ||
            argv.some((v) => typeof v !== 'string' || !v.length)
          )
            throw new Error('Recipe commands must be nonempty string argument arrays.');
          const args = argv.map(render);
          if (backend === 'unity') {
            // Pin the Editor before the parameter fence; never retarget a recipe silently.
            const fence = args.indexOf('--'),
              options = fence < 0 ? args : args.slice(0, fence);
            if (
              options.some(
                (v: string) =>
                  v.startsWith('--project-path=') ||
                  ['--pid', '--port', '--instance', '--runtime'].includes(v) ||
                  /^--(pid|port|instance|runtime)=/.test(v),
              )
            )
              throw new Error(
                'Unity recipes use the checkout project path, not alternate instance selectors.',
              );
            const targets = options.flatMap((v: string, i: number) =>
              v === '--project-path' ? [i] : [],
            );
            if (
              targets.length > 1 ||
              (targets.length &&
                (!options[targets[0] + 1] || resolve(root, options[targets[0] + 1]) !== root))
            )
              throw new Error('Unity recipe targets another project.');
            if (!targets.length)
              args.splice(fence < 0 ? args.length : fence, 0, '--project-path', root);
          }
          return args;
        }),
      ];
    }),
  );
  const prepareReceipts = (recipe.prepareReceipts ?? []).map((barrier: any) => {
    if (!barrier || Object.keys(barrier).sort().join() !== 'afterCommand,expected,path,timeoutMs' ||
        !Number.isInteger(barrier.afterCommand) || barrier.afterCommand < 0 || barrier.afterCommand >= rendered.prepare.length ||
        typeof barrier.path !== 'string' || !Number.isInteger(barrier.timeoutMs) || barrier.timeoutMs < 1 || barrier.timeoutMs > 120000 ||
        !barrier.expected || Array.isArray(barrier.expected) || typeof barrier.expected !== 'object' || !Object.keys(barrier.expected).length)
      throw new Error('Invalid preparation receipt barrier');
    const path = resolve(root, render(barrier.path)), within = relative(out, path);
    if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('Preparation receipt must belong to this fresh output');
    return { ...barrier, path };
  });
  return {
    scenario,
    viewport,
    configHash: sha(JSON.stringify(config)),
    out,
    reference: config.helix,
    revision: unityRevision(root),
    backend,
    executable: backend,
    environment: backend === 'ai-kit'
      ? { AIKIT_QA_VIEWPORT: `${size.width}x${size.height}`, AIKIT_QA_DIR: join(out, 'qa') }
      : {},
    stages: rendered,
    prepareReceipts,
    notes: [
      'Commands are argument arrays, not shell strings. Run preflight, prepare, capture and always restore owned Unity state, including after failure.',
      'Overlay environment on the child process environment for every lifecycle command, including restoration. Do not resize the Game view independently of the play session viewport.',
      'Project preflight must verify storage isolation and backend compatibility. A checkout path alone does not prove isolation.',
    ],
  };
}

export function unityExecutable(plan: any, overrides: { aiKit?: string; unity?: string } = {}) {
  const backend = plan.backend ?? 'ai-kit';
  if (
    !['ai-kit', 'unity'].includes(backend) ||
    (plan.executable !== undefined && plan.executable !== backend)
  )
    throw new Error('Invalid Unity execution backend.');
  return backend === 'unity' ? (overrides.unity ?? 'unity') : (overrides.aiKit ?? 'ai-kit');
}
