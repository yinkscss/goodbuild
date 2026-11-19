import type { V2_PACKAGES } from "./template";

/**
 * The packages guide (D152, WS4): what each vetted v2 package is for, when not to use it, and one example
 * that type-checks and runs against the pinned version (packages.test.ts builds an app from these examples
 * and opens it in the run check). Only harness v2 builds are told about it.
 */
export const PACKAGES_GUIDE_NAME = "packages";

/** One line per package for the add_dependency description. */
export const V2_PACKAGE_USES: Record<keyof typeof V2_PACKAGES, string> = {
  zustand: "app state shared across pages",
  immer: "updating nested state",
  zod: "validating input (import from zod/mini)",
  "react-hook-form": "forms with several fields",
  recharts: "interactive charts",
  "@dnd-kit/core": "drag and drop",
  "@dnd-kit/sortable": "reorderable lists and boards",
  "matter-js": "2D physics",
  howler: "game sound and music",
  "react-markdown": "showing markdown people write",
  "fuse.js": "fuzzy search in a list",
  papaparse: "CSV import and export",
  nanoid: "random ids",
};

export const PACKAGES_GUIDE = `Packages beyond the base list (harness v2). Add one with add_dependency before importing it. Use one when it does real work; plain React is still the default for small things. Sizes are minified and gzipped in the published app.

zustand (0.4 kB): state that several pages share (a cart, a game's settings, a draft). Not for saved data: that is the app data store (app-data guide). Select single values, or use useShallow for several, so components don't re-render in a loop.
  import { create } from "zustand";
  import { useShallow } from "zustand/react/shallow";
  type Cart = { items: string[]; add: (id: string) => void; clear: () => void };
  export const useCart = create<Cart>()((set) => ({ items: [], add: (id) => set((s) => ({ items: [...s.items, id] })), clear: () => set({ items: [] }) }));
  const count = useCart((s) => s.items.length);
  const { add, clear } = useCart(useShallow((s) => ({ add: s.add, clear: s.clear })));

immer (3.7 kB): change deeply nested state by "mutating" a draft.
  import { produce } from "immer";
  setBoard((b) => produce(b, (d) => { d.columns[0].cards.push(card); }));

zod (4.6 kB from zod/mini, 91 kB from "zod": always import zod/mini): validate what people type or paste before using it.
  import * as z from "zod/mini";
  const Entry = z.object({ name: z.string().check(z.minLength(2, "At least 2 letters")), email: z.email("Enter an email"), age: z.number().check(z.gte(18, "18 or over")) });
  const r = Entry.safeParse(value);
  if (!r.success) setError(r.error.issues[0].message); else save(r.data);

react-hook-form (12 kB): forms with several fields, per-field errors and a submitting state. Validate with its own rules (validate can call a zod/mini schema). There is no resolvers package. register needs a native <input>, <select> or <textarea> (the starter Input doesn't pass refs on), so give those the same classes.
  import { useForm } from "react-hook-form";
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ title: string; amount: string }>();
  <form onSubmit={handleSubmit(async (v) => { await send(v); })}>
    <input className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" {...register("title", { required: "Give it a title" })} aria-invalid={!!errors.title} />
    {errors.title && <p className="text-sm text-danger">{errors.title.message}</p>}
    <input className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" inputMode="decimal" {...register("amount", { validate: (v) => Number(v) > 0 || "More than 0" })} />
  </form>

recharts (111 kB, adds react-is): interactive charts with tooltips, several series, stacked or mixed charts. For one simple line or bar chart the dashboard kit's Charts are lighter. Give it a sized parent; colour with the theme tokens.
  import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
  <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%">
    <LineChart data={points}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" /><XAxis dataKey="label" /><YAxis /><Tooltip />
      <Line type="monotone" dataKey="value" stroke="var(--color-accent)" strokeWidth={2} dot={false} /></LineChart>
  </ResponsiveContainer></div>

@dnd-kit/core and @dnd-kit/sortable (14 kB, adding either adds @dnd-kit/utilities): drag and drop, reorderable lists, kanban boards, builders. Works with touch. Give each item a stable id.
  import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
  import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
  import { CSS } from "@dnd-kit/utilities";
  function Row({ id, label }: { id: string; label: string }) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
    return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners} className="touch-none">{label}</li>;
  }
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => { if (e.over && e.active.id !== e.over.id) setItems((xs) => arrayMove(xs, xs.findIndex((x) => x.id === e.active.id), xs.findIndex((x) => x.id === e.over!.id))); };
  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
    <SortableContext items={items.map((x) => x.id)} strategy={verticalListSortingStrategy}><ul>{items.map((x) => <Row key={x.id} id={x.id} label={x.label} />)}</ul></SortableContext>
  </DndContext>

matter-js (27 kB): real 2D physics (falling, stacking, bouncing, ragdolls, pinball). Step the engine in your own requestAnimationFrame loop and draw on a canvas, or use Matter.Render for a quick start. Clean up on unmount.
  import Matter from "matter-js";
  const engine = Matter.Engine.create();
  const ground = Matter.Bodies.rectangle(200, 390, 400, 20, { isStatic: true });
  const ball = Matter.Bodies.circle(200, 50, 16, { restitution: 0.7 });
  Matter.Composite.add(engine.world, [ground, ball]);
  // each frame: Matter.Engine.update(engine, 1000 / 60); then draw ball.position.x, ball.position.y
  // on unmount: cancelAnimationFrame(frame); Matter.Engine.clear(engine);

howler (10 kB): sound effects and music: several sounds at once, volume, looping, sprites. Sources are uploaded assets (/assets/<name>) only, never external URLs. Start sound after a tap or key press, and offer a mute button.
  import { Howl, Howler } from "howler";
  const hit = new Howl({ src: ["/assets/hit.mp3"], volume: 0.6 });
  hit.play();
  Howler.mute(muted);

react-markdown (36 kB): show markdown people wrote (posts, notes, descriptions). Raw HTML in it is shown as text, which is safe; don't add plugins that allow HTML. Style elements through components.
  import Markdown from "react-markdown";
  <Markdown components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" className="text-accent underline" />, p: (p) => <p {...p} className="mb-3" /> }}>{post.body}</Markdown>

fuse.js (9 kB): fuzzy search over a list already in the page (typos forgiven). Build the index once with useMemo.
  import Fuse from "fuse.js";
  const fuse = useMemo(() => new Fuse(items, { keys: ["name", "tags"], threshold: 0.35 }), [items]);
  const shown = query ? fuse.search(query).map((r) => r.item) : items;

papaparse (7 kB): import a CSV the person picks, and export rows as a CSV download. Only parse files and text; never give it a URL (no download option).
  import Papa from "papaparse";
  Papa.parse<Record<string, string>>(file, { header: true, skipEmptyLines: true, complete: (r) => setRows(r.data) });
  const csv = Papa.unparse(rows);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));

nanoid (0.2 kB): short random ids for things made in the browser (cards, list items, drafts).
  import { nanoid } from "nanoid";
  const card = { id: nanoid(), title };

Not available, use instead: framer-motion or motion (the motion kit), phaser or pixi (the game-2d kit), @react-three/fiber (the three-d kit), map libraries (none yet), UI component packages (the starter pieces), axios or fetch helpers (there is no server to call).`;
