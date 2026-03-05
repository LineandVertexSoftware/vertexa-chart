/**
 * Custom ESM loader hook that handles .wgsl files (used by WebGPURenderer via Vite's ?raw syntax).
 * In Node's test environment these files are not parseable as JS modules, so we return an empty
 * string as the default export — the shader content is irrelevant for unit tests.
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".wgsl") || url.includes(".wgsl?")) {
    return {
      format: "module",
      source: 'export default "";',
      shortCircuit: true
    };
  }
  return nextLoad(url, context);
}
