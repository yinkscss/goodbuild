# The review on DeepSeek, low against high detail (D162)

Run on 21 Nov 2026 from the build session, through its DeepSeek access. Script: built two pages with Playwright, took the review's two screenshots of each (375px cropped to 1,568px tall, 1280px cropped to 1,400px), and sent them with `reviewPrompt` to `deepseek-flash` with thinking off, three times at each detail level.

- **"good"**: a tidy savings-goals page (header, headline, button, three goal cards with progress bars).
- **"broken"**: the same content with a headline that runs off the phone screen, cards that don't stack and overlap, and near-white text and a near-white button on white.

| Page | Detail | Prompt tokens | Verdicts (3 runs) |
|---|---|---|---|
| good | low | 1,015 | 1 false report ("a huge empty area", "small, low-contrast header text"), 2 ok |
| good | high | 1,457 | 3 ok |
| broken | low | 1,013 | 3 found the overflow and the cards; 1 also invented "a large blank placeholder box" |
| broken | high | 1,877 | 3 found the overflow, the cards and the low contrast |

Each call took 1.2 to 2.9 seconds and wrote 5 to 190 output tokens.

**Decision:** the review sends its pictures at `high` detail. `low` saves about 450 tokens a look and was wrong once in six, which costs a fix pass. The browser's visual check (P17) keeps DeepSeek's default for the same reason. Two of the six "broken" verdicts at high detail also asked for a progress bar, which is a feature, not a defect; the prompt says not to ask for features, and the fix pass is undone if it breaks a check.

Not measured here: real builds' screenshots, games, and how often the fix pass then makes the page better. The token report (D162) shows each build's review tokens in its log.
