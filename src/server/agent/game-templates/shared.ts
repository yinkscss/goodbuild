/** The plain src/App.tsx around a template's game (the MiniPay one is written by withGameTemplate). */
export function appFor(from: string, name: string): string {
  return `import Game from "./play/Game";
import { ${name} } from "${from}";

export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{${name}}</h1>
      </header>
      <Game />
    </main>
  );
}
`;
}

/** What every template's brief ends with: the parts that make it a working, checked game. */
export const KEEP_2D =
  "Keep what makes it work: the probe calls, GameCanvas paused with onIdleFrame, the Pools and Spawners (nothing created per frame), spawned(kind) called inside onFrame, GameOver on the game with PostScore, free play with no wallet.";
export const KEEP_3D =
  "Keep what makes it work: the probe calls with the player's position, Scene3D paused with onIdleFrame, things built once and reused, spawned(kind) called inside the frame function, Hud3D, GameOver with PostScore, free play with no wallet.";
