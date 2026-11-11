/** Explicit JSON projections for shared configuration; ordinary source files remain byte-pinned. */
export type DependencySelector = { pointer: string; where?: Record<string, string> } | { heading: string };
export class MissingDependencySelection extends Error {}
export function validateDependencySelectors(value: unknown): asserts value is DependencySelector[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('Expected nonempty dependency selectors');
  for (const selector of value) {
    if (selector && typeof selector === 'object' && Object.hasOwn(selector, 'heading')) {
      if (Object.keys(selector).length !== 1 || typeof selector.heading !== 'string' || !/^#{1,6} [^\r\n]+$/.test(selector.heading)) throw new Error('Invalid Markdown dependency heading');
      continue;
    }
    if (!selector || typeof selector !== 'object' || Array.isArray(selector) || Object.keys(selector).some(key => !['pointer', 'where'].includes(key)) || typeof selector.pointer !== 'string' || !selector.pointer.startsWith('/') || /~(?![01])/.test(selector.pointer)) throw new Error('Invalid dependency JSON pointer');
    if (selector.where !== undefined && (!selector.where || typeof selector.where !== 'object' || Array.isArray(selector.where) || !Object.keys(selector.where).length || Object.entries(selector.where).some(([key, value]) => !key || typeof value !== 'string'))) throw new Error('Invalid dependency row selector');
  }
}
export function selectDependency(value: unknown, selector: DependencySelector): unknown {
  if ('heading' in selector) {
    if (typeof value !== 'string') throw new MissingDependencySelection('Markdown dependency requires text');
    const lines = value.replace(/\r\n/g, '\n').split('\n');
    const headings: { index: number; level: number; text: string }[] = [];
    let fence: string | null = null;
    for (let index = 0; index < lines.length; index++) {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(lines[index]);
      if (marker) { if (fence === null) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null; continue; }
      if (fence !== null) continue;
      const heading = /^(#{1,6}) +(.+?) *#* *$/.exec(lines[index]);
      if (heading) headings.push({ index, level: heading[1].length, text: heading[1] + ' ' + heading[2] });
    }
    const matches = headings.filter(heading => heading.text === selector.heading);
    if (matches.length !== 1) throw new MissingDependencySelection('Missing or ambiguous Markdown dependency heading: ' + selector.heading);
    const selected = matches[0], end = headings.find(heading => heading.index > selected.index && heading.level <= selected.level);
    return lines.slice(selected.index, end ? end.index : lines.length).join('\n').trimEnd();
  }
  let current: any = value;
  for (const part of selector.pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) throw new MissingDependencySelection('Missing dependency selection: ' + selector.pointer);
    current = current[part];
  }
  if (selector.where === undefined) return current;
  if (!Array.isArray(current)) throw new MissingDependencySelection('Dependency row selector requires an array: ' + selector.pointer);
  const rows = current.filter(row => row !== null && typeof row === 'object' && Object.entries(selector.where!).every(([key, value]) => Object.hasOwn(row, key) && row[key] === value));
  if (!rows.length) throw new MissingDependencySelection('No dependency rows match: ' + selector.pointer);
  return rows;
}
