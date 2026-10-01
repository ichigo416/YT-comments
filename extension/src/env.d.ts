/** Injected at build time by build.mjs. */
declare const __API_BASE__: string;

declare module "*.css" {
  const content: string;
  export default content;
}
