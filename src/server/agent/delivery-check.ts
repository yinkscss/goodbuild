import type { Page } from "playwright-core";

/** Independent browser acceptance for the reported board game, including both winners and a draw. */
export async function checkTicTacToe(page: Page): Promise<string[]> {
  const fail = (why: string) => [`Tic-tac-toe acceptance: ${why}. Use nine buttons data-gb-cell="0" through "8", data-gb-status for turn/result, and a data-gb-restart button.`];
  let action = "finding the board";
  try {
    const cells = page.locator("button[data-gb-cell]");
    if (await cells.count() !== 9) return fail("the board needs nine playable cells");
    const cell = (n: number) => page.locator(`button[data-gb-cell="${n}"]`);
    const reset = async () => {
      action = "restarting the game";
      await page.locator("button[data-gb-restart]").click({ timeout: 1000 });
      if ((await cells.allTextContents()).some((s) => s.trim())) throw new Error("restart did not clear the board");
    };
    for (const [moves, outcome] of [[ [0, 3, 1, 4, 2], "X" ], [ [0, 3, 1, 4, 8, 5], "O" ], [ [0, 1, 2, 4, 3, 5, 7, 6, 8], "draw" ]] as const) {
      await reset();
      for (const [turn, n] of moves.entries()) {
        action = `playing cell ${n} on turn ${turn + 1} in the ${outcome} sequence`;
        await cell(n).click({ timeout: 1000 });
        if ((await cell(n).innerText()).trim() !== (turn % 2 ? "O" : "X")) return fail("turns did not alternate X and O");
      }
      const status = await page.locator("[data-gb-status]").innerText({ timeout: 1000 });
      if (outcome === "draw" ? !/draw|tie/i.test(status) : !(status.includes(outcome) && /win/i.test(status))) return fail(`the ${outcome} result was not reported`);
      const before = await cells.allTextContents();
      const empty = before.findIndex((s) => !s.trim());
      if (empty >= 0 && await cell(empty).isEnabled()) await cell(empty).click({ timeout: 1000 });
      if ((await cells.allTextContents()).join("|") !== before.join("|")) return fail("moves were allowed after the game ended");
    }
    await reset();
    await cell(0).click({ timeout: 1000 });
    const before = await cells.allTextContents();
    if (await cell(0).isEnabled()) await cell(0).click({ timeout: 1000 });
    if ((await cells.allTextContents()).join("|") !== before.join("|")) return fail("an occupied cell could be played again");
    await reset();
    return [];
  } catch (error) { return fail(`${action}: ${String((error as Error).message).slice(0, 600)}`); }
}
