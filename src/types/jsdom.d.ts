// The slice of jsdom GoodBuild uses (a window for DOMPurify in svg-sanitize.ts), so the
// package needs no @types dependency.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string);
    readonly window: Window & typeof globalThis;
  }
}
