import Image from "next/image";
import Link from "next/link";

import { FillPromptChip } from "@/components/home/home-prompt";
import { RetryButton } from "@/components/home/retry-button";
import { TONE_CLASS, projectStatusMeta, relativeTime } from "@/lib/home";
import { cn } from "@/lib/utils";
import cube from "../../../public/assets/chrome-cube.jpg";

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  chainId: number;
  updatedAt: Date;
}

const THUMBS = [
  "linear-gradient(135deg, #F3EEF8, #E2D2F0)",
  "linear-gradient(135deg, #F3EEF8, #EFE6F7)",
];

/** One project card: thumbnail, name, status dot and line, relative time (mockup b). */
export function ProjectCard({ project, index, now }: { project: ProjectSummary; index: number; now: Date }) {
  const status = projectStatusMeta(project.status, project.chainId);
  return (
    <Link
      href={`/p/${project.id}`}
      className="group flex h-[196px] flex-col rounded-card bg-surface p-5 shadow-card outline-none transition-shadow duration-200 ease-gb hover:shadow-pop focus-visible:shadow-focus"
    >
      <div className="h-[78px] rounded-block" style={{ background: THUMBS[index % THUMBS.length] }} aria-hidden>
        <div className="flex gap-1.5 p-3">
          <span className="h-2 w-8 rounded bg-white/80" />
          <span className="h-2 w-5 rounded bg-white/60" />
        </div>
      </div>
      <p className="mt-4 truncate font-semibold">{project.name}</p>
      <div className="mt-1 flex flex-col gap-0.5 text-xs text-grey-600">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", TONE_CLASS[status.tone])} aria-hidden />
          {status.label}
        </span>
        <span>{relativeTime(project.updatedAt, now)}</span>
      </div>
    </Link>
  );
}

export function ProjectGrid({ projects, now = new Date() }: { projects: ProjectSummary[]; now?: Date }) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {projects.map((p, i) => (
        <ProjectCard key={p.id} project={p} index={i} now={now} />
      ))}
    </div>
  );
}

/** DESIGN_SYSTEM §4 empty state: a chrome object, one sentence, three example chips. */
export function ProjectsEmpty() {
  return (
    <div className="mt-4 flex flex-col items-center rounded-card bg-surface px-6 py-10 text-center shadow-card">
      <Image src={cube} alt="" className="size-28 object-contain mix-blend-multiply" sizes="112px" />
      <p className="mt-4 max-w-sm text-sm text-grey-600">
        No builds yet. Describe your first dApp above, or start from one of these.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <FillPromptChip templateId="savings-circle" />
        <FillPromptChip templateId="tip-jar" />
        <FillPromptChip templateId="event-tickets" />
      </div>
    </div>
  );
}

/** Skeleton cards in surface-tint with a soft shimmer. Never a full-screen spinner. */
export function ProjectGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading projects">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-[196px] flex-col rounded-card bg-surface p-5 shadow-card">
          <div className="skeleton h-[78px] rounded-block motion-reduce:animate-none" />
          <div className="skeleton mt-4 h-4 w-2/3 rounded-full motion-reduce:animate-none" />
          <div className="skeleton mt-2 h-3 w-1/2 rounded-full motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

/** Inline error card: danger dot, plain-language cause, Retry, expandable details. */
export function ProjectsError({ detail }: { detail?: string }) {
  return (
    <div className="mt-4 rounded-card bg-surface p-5 shadow-card" role="alert">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-sm font-medium">We couldn&apos;t load your projects.</p>
            <p className="text-sm text-grey-600">Your builds are safe. This is usually a brief connection problem.</p>
          </div>
        </div>
        <RetryButton />
      </div>
      {detail && (
        <details className="mt-3 pl-5 text-xs text-grey-600">
          <summary className="cursor-pointer select-none">Details</summary>
          <pre className="mt-2 overflow-x-auto rounded-block bg-canvas p-3 font-mono text-[12px] whitespace-pre-wrap">{detail}</pre>
        </details>
      )}
    </div>
  );
}

/** Recent builds in the sidebar: dot and name, linking to the workspace. */
export function RecentBuilds({ projects }: { projects: ProjectSummary[] }) {
  if (projects.length === 0) {
    return <p className="px-3 py-2 text-sm text-grey-400">Your builds will show up here.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {projects.slice(0, 6).map((p) => {
        const tone = projectStatusMeta(p.status, p.chainId).tone;
        return (
          <li key={p.id}>
            <Link
              href={`/p/${p.id}`}
              className="flex items-center gap-2.5 rounded-[12px] px-3 py-2 text-sm text-ink/65 outline-none hover:bg-tint hover:text-violet focus-visible:shadow-focus"
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASS[tone])} aria-hidden />
              <span className="truncate">{p.name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function RecentBuildsSkeleton() {
  return (
    <div className="space-y-2 px-3 py-1" aria-busy="true">
      {[70, 55, 80].map((w) => (
        <div key={w} className="skeleton h-3.5 rounded-full motion-reduce:animate-none" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}
