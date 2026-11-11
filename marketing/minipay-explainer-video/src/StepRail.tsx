import React from "react";
import { C, F, SAFE } from "./theme";
import { Tick } from "./ui";

const STEPS = ["Deploy", "Publish", "MiniPay"];
/** The 1-2-3 rail along the top of the walkthrough scenes. active: 0..2, or 3 when all are done. */
export const StepRail: React.FC<{ active: number; inT: number }> = ({ active, inT }) => (
  <div style={{ position: "absolute", left: SAFE.x, top: 236, width: SAFE.w, display: "flex", gap: 14, opacity: inT, transform: `translateY(${(1 - inT) * -30}px)` }}>
    {STEPS.map((s, i) => {
      const done = i < active;
      const on = i === active;
      return (
        <div key={s} style={{ flex: 1, height: 74, borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, background: on ? C.purple : done ? C.lilacSoft : "rgba(255,255,255,.75)", color: on ? C.cream : done ? C.purple : "rgba(17,17,17,.4)", fontFamily: F.ui, fontWeight: 700, fontSize: 30, boxShadow: on ? `0 18px 40px -16px ${C.purple}` : "none" }}>
          {done ? <Tick size={34} /> : <span style={{ fontFamily: F.slam, fontWeight: 900, fontSize: 28, color: on ? C.pink : "inherit" }}>{i + 1}</span>}
          {s}
        </div>
      );
    })}
  </div>
);
