import type { ReactNode } from "react";

/** The heading row every landing section shares: display headline left, one line of support right. */
export function SectionHeading({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-6 md:flex-row md:items-end">
      <div className="max-w-[820px]">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id} className="display mt-3 text-[28px] font-bold sm:text-[40px]">
          {title}
        </h2>
      </div>
      <p className="max-w-sm text-base text-grey-600">{children}</p>
    </div>
  );
}
