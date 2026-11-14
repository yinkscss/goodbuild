/**
 * Blank out comments and string literals in Solidity source, keeping every character offset and newline
 * (GB-04). Text rules (does this contract have a `function deposit(`, is there a `testExploit...` function)
 * must read code, not comments or strings: a comment that mentions a function name is not that function.
 *
 * A small lexer, not a regex: it handles `//` and block comments, double- and single-quoted strings with
 * backslash escapes, and the `unicode"..."` / `hex"..."` forms (their quotes are ordinary string quotes).
 * Quotes are kept so a string argument still looks like a string; its contents become spaces.
 */
export function stripSolidity(source: string): string {
  const out: string[] = [];
  const n = source.length;
  let i = 0;
  const blank = (c: string) => (c === "\n" || c === "\r" ? c : " ");
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") out.push(blank(source[i++]));
    } else if (c === "/" && next === "*") {
      out.push(" ", " ");
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) out.push(blank(source[i++]));
      if (i < n) {
        out.push(" ", " ");
        i += 2;
      }
    } else if (c === '"' || c === "'") {
      out.push(c);
      i++;
      // A string can't span lines in Solidity; stopping at a newline keeps one stray quote from blanking the file.
      while (i < n && source[i] !== c && source[i] !== "\n") {
        if (source[i] === "\\" && i + 1 < n && source[i + 1] !== "\n") {
          out.push(" ", " ");
          i += 2;
        } else out.push(blank(source[i++]));
      }
      if (i < n && source[i] === c) out.push(source[i++]);
    } else {
      out.push(c);
      i++;
    }
  }
  return out.join("");
}
