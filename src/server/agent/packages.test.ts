// @vitest-environment node
import { readFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { checkApp } from "./checks";
import { loadGuides } from "./guides";
import { packagesFor } from "./kits";
import { PACKAGES_GUIDE, V2_PACKAGE_USES } from "./packages-guide";
import { BUILD_TOOLS, V2_BUILD_TOOLS, systemPrompt } from "./prompt";
import { closeRunCheckBrowser, runCheck } from "./run-check";
import { ALLOWED_DEPENDENCIES, COMPANION_PACKAGES, V2_PACKAGES, dependenciesOf, packageJson, starterFiles } from "./template";
import { typeCheck } from "./type-check";
import { Workspace } from "./workspace";

afterAll(() => closeRunCheckBrowser());

/** An app that uses every v2 package the way the packages guide shows. */
const APP = `import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { produce } from "immer";
import * as z from "zod/mini";
import { useForm } from "react-hook-form";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Matter from "matter-js";
import { Howl, Howler } from "howler";
import Markdown from "react-markdown";
import Fuse from "fuse.js";
import Papa from "papaparse";
import { nanoid } from "nanoid";

type Cart = { items: string[]; add: (id: string) => void; clear: () => void };
const useCart = create<Cart>()((set) => ({ items: [], add: (id) => set((s) => ({ items: [...s.items, id] })), clear: () => set({ items: [] }) }));
const Entry = z.object({ name: z.string().check(z.minLength(2, "At least 2 letters")), email: z.email("Enter an email") });

function Row({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners} className="touch-none">{label}</li>;
}

export default function App() {
  const count = useCart((s) => s.items.length);
  const { add } = useCart(useShallow((s) => ({ add: s.add, clear: s.clear })));
  const [board, setBoard] = useState({ columns: [{ cards: [] as string[] }] });
  const [zodMessage, setZodMessage] = useState("");
  const [sent, setSent] = useState("");
  const { register, handleSubmit, formState: { errors } } = useForm<{ title: string; amount: string }>();
  const [items, setItems] = useState([{ id: "a", label: "Apples" }, { id: "b", label: "Bananas" }]);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => { if (e.over && e.active.id !== e.over.id) setItems((xs) => arrayMove(xs, xs.findIndex((x) => x.id === e.active.id), xs.findIndex((x) => x.id === e.over!.id))); };
  const [query, setQuery] = useState("");
  const fruit = useMemo(() => [{ name: "Mango", tags: ["sweet"] }, { name: "Lemon", tags: ["sour"] }], []);
  const fuse = useMemo(() => new Fuse(fruit, { keys: ["name", "tags"], threshold: 0.35 }), [fruit]);
  const shown = query ? fuse.search(query).map((r) => r.item) : fruit;
  const [ballY, setBallY] = useState(0);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [id] = useState(() => nanoid());
  const sound = useRef<Howl | null>(null);

  useEffect(() => {
    const engine = Matter.Engine.create();
    const ground = Matter.Bodies.rectangle(200, 390, 400, 20, { isStatic: true });
    const ball = Matter.Bodies.circle(200, 50, 16, { restitution: 0.7 });
    Matter.Composite.add(engine.world, [ground, ball]);
    for (let i = 0; i < 30; i++) Matter.Engine.update(engine, 1000 / 60);
    setBallY(Math.round(ball.position.y));
    Papa.parse<Record<string, string>>("name,score\\nAda,3\\nBola,5", { header: true, skipEmptyLines: true, complete: (r) => setRows(r.data) });
    sound.current = new Howl({ src: ["/assets/hit.mp3"], volume: 0.6, preload: false });
    Howler.mute(true);
    return () => Matter.Engine.clear(engine);
  }, []);

  return (
    <main>
      <h1>Every package</h1>
      <p>Cart: {count}</p>
      <button onClick={() => add("x")}>Add to cart</button>
      <button onClick={() => setBoard((b) => produce(b, (d) => { d.columns[0].cards.push("card"); }))}>Add card</button>
      <p>Cards: {board.columns[0].cards.length}</p>
      <button onClick={() => { const r = Entry.safeParse({ name: "A", email: "nope" }); setZodMessage(r.success ? "valid" : r.error.issues[0].message); }}>Validate</button>
      <p>{zodMessage}</p>
      <form onSubmit={handleSubmit((v) => setSent(\`\${v.title} for \${v.amount}\`))}>
        <label htmlFor="title">Title</label>
        <input id="title" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" {...register("title", { required: "Give it a title" })} aria-invalid={!!errors.title} />
        {errors.title && <p>{errors.title.message}</p>}
        <label htmlFor="amount">Amount</label>
        <input id="amount" inputMode="decimal" {...register("amount", { validate: (v) => Number(v) > 0 || "More than 0" })} />
        {errors.amount && <p>{errors.amount.message}</p>}
        <button type="submit">Save</button>
      </form>
      <p>{sent && \`Saved \${sent}\`}</p>
      <div style={{ width: 400, height: 200 }}><ResponsiveContainer width="100%" height="100%">
        <LineChart data={[{ label: "Mon", value: 1 }, { label: "Tue", value: 3 }]}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip />
          <Line type="monotone" dataKey="value" stroke="var(--color-accent)" dot={false} /></LineChart>
      </ResponsiveContainer></div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((x) => x.id)} strategy={verticalListSortingStrategy}><ul>{items.map((x) => <Row key={x.id} id={x.id} label={x.label} />)}</ul></SortableContext>
      </DndContext>
      <label htmlFor="q">Search</label>
      <input id="q" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul>{shown.map((f) => <li key={f.name}>{f.name}</li>)}</ul>
      <p>Ball at {ballY}</p>
      <p>Rows: {rows.map((r) => r.name).join(", ")}</p>
      <p>Id length {id.length}</p>
      <Markdown components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}>{"# Notes\\n\\nSome **bold** words and <b>raw html</b>."}</Markdown>
    </main>
  );
}
`;

function projectWithEveryPackage(): Record<string, string> {
  const ws = new Workspace(starterFiles(), { v2: true });
  for (const name of Object.keys(V2_PACKAGES)) {
    const r = ws.execute("add_dependency", JSON.stringify({ name }), "build");
    expect(r.ok, r.result).toBe(true);
  }
  return { ...ws.files, "src/App.tsx": APP };
}

describe("the vetted v2 packages (D152 WS4)", () => {
  it("are pinned exactly, in publish-runtime too, with licences publishing can ship", () => {
    const runtime = (JSON.parse(readFileSync("publish-runtime/package.json", "utf8")) as { dependencies: Record<string, string> }).dependencies;
    for (const [name, version] of Object.entries({ ...V2_PACKAGES, ...Object.assign({}, ...Object.values(COMPANION_PACKAGES)) })) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(runtime[name]).toBe(version);
      expect(ALLOWED_DEPENDENCIES[name]).toBe(version);
      const pkg = JSON.parse(readFileSync(`publish-runtime/node_modules/${name}/package.json`, "utf8")) as { version: string; license: string };
      expect(pkg.version).toBe(version);
      expect(["MIT", "ISC", "Apache-2.0"]).toContain(pkg.license);
    }
    // Every package has a line in the add_dependency description and a section in the guide.
    for (const name of Object.keys(V2_PACKAGES)) {
      expect(V2_PACKAGE_USES[name as keyof typeof V2_PACKAGES]).toBeTruthy();
      expect(PACKAGES_GUIDE).toContain(name);
    }
  });

  it("can be added only in a v2 build, and bring the packages the preview needs beside them", () => {
    const v1 = new Workspace(starterFiles());
    expect(v1.execute("add_dependency", JSON.stringify({ name: "zustand" }), "build")).toMatchObject({ ok: false });
    expect(packagesFor(starterFiles())).not.toHaveProperty("recharts");

    const v2 = new Workspace(starterFiles(), { v2: true });
    expect(v2.execute("add_dependency", JSON.stringify({ name: "recharts" }), "build")).toMatchObject({ ok: true, result: "Added recharts@3.10.1 (and react-is, which it needs)." });
    expect(v2.execute("add_dependency", JSON.stringify({ name: "@dnd-kit/sortable" }), "build").result).toContain("@dnd-kit/core, @dnd-kit/utilities");
    expect(dependenciesOf(v2.files)).toEqual(expect.arrayContaining(["recharts", "react-is", "@dnd-kit/sortable", "@dnd-kit/core", "@dnd-kit/utilities"]));
    // A companion isn't something to add on its own.
    expect(v2.execute("add_dependency", JSON.stringify({ name: "react-is" }), "build")).toMatchObject({ ok: false });
    // A project built under v2 keeps its packages if the flag goes off: package.json keeps them.
    expect(dependenciesOf({ "package.json": packageJson(["react", "zustand"]) })).toEqual(["react", "zustand"]);
  });

  it("are named only to v2 builds: the add_dependency description, the rules and the guide", () => {
    const describe = (tools: typeof BUILD_TOOLS) => tools.find((t) => t.function.name === "add_dependency")!.function.description;
    expect(describe(V2_BUILD_TOOLS)).toContain("zustand (app state shared across pages)");
    expect(describe(BUILD_TOOLS)).not.toContain("zustand");
    expect(systemPrompt("build", false, true)).toContain("Read the packages guide before adding one");
    expect(systemPrompt("build", false, false)).not.toContain("zustand");
    expect(loadGuides(["packages"]).loaded).toEqual(["packages"]);
  });

  it("tell a v1 build what they always did and a v2 build to add the package", () => {
    const files = { ...starterFiles(), "src/App.tsx": 'import { LineChart } from "recharts";\nexport default function App() { return <LineChart width={1} height={1} data={[]} />; }\n' };
    const v1 = checkApp(files).errors.find((i) => i.message.includes("recharts"));
    expect(v1?.message).toContain("The dashboard kit does this with no package");
    const v2 = checkApp(files, { v2: true }).errors.find((i) => i.message.includes("recharts"));
    expect(v2?.message).toContain('Call add_dependency("recharts") first.');
    // A companion is added through the package that needs it.
    const dnd = { ...starterFiles(), "src/App.tsx": 'import { CSS } from "@dnd-kit/utilities";\nexport default function App() { return <p>{String(CSS)}</p>; }\n' };
    expect(checkApp(dnd, { v2: true }).errors.find((i) => i.message.includes("@dnd-kit/utilities"))?.message).toContain('Call add_dependency("@dnd-kit/core") first, which installs @dnd-kit/utilities with it.');
  });

  it("type-check against the pinned versions, as the guide uses them", { timeout: 120_000 }, async () => {
    const result = await typeCheck(projectWithEveryPackage());
    expect(result.ran, result.note).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("bundle and run in the browser check", { timeout: 120_000 }, async () => {
    const result = await runCheck(projectWithEveryPackage(), {
      acceptance: {
        flows: [
          { name: "State", steps: [{ click: { role: "button", name: "Add to cart" } }, { expect: { text: "Cart: 1" } }, { click: { role: "button", name: "Add card" } }, { expect: { text: "Cards: 1" } }] },
          { name: "Validation", steps: [{ click: { role: "button", name: "Validate" } }, { expect: { text: "At least 2 letters" } }] },
          { name: "Form", steps: [{ click: { role: "button", name: "Save" } }, { expect: { text: "Give it a title" } }, { fill: { label: "Title" }, value: "Rent" }, { fill: { label: "Amount" }, value: "50" }, { click: { role: "button", name: "Save" } }, { expect: { text: "Saved Rent for 50" } }] },
          { name: "Search", steps: [{ fill: { label: "Search" }, value: "mngo" }, { expect: { text: "Mango" } }, { expect: { hidden: "Lemon" } }] },
          { name: "The rest", steps: [{ expect: { text: "Apples" } }, { expect: { text: "Rows: Ada, Bola" } }, { expect: { text: "Id length 21" } }, { expect: { role: "heading", name: "Notes" } }, { expect: { text: "<b>raw html</b>" } }] },
        ],
      },
    });
    expect(result.ran, result.note).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.acceptance?.filter((r) => r.status !== "pass")).toEqual([]);
  });
});
