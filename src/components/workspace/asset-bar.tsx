"use client";

import * as React from "react";
import { Box, Check, ChevronDown, ImageIcon, ImagePlus, Loader2, Music, Type, X } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AssetInfo, AssetKind } from "@/server/agent/assets";
import { isImage } from "@/server/agent/assets";

export const KIND_LABEL: Record<AssetKind, string> = { logo: "Logo", image: "Image", reference: "Design reference", audio: "Sound", font: "Font", model: "3D model" };
export const KIND_HELP: Record<AssetKind, string> = {
  logo: "Shown in the header and as the favicon; colours come from it",
  image: "A photo or illustration to use on the site",
  reference: "A screenshot or mockup to match (not shown in the app)",
  audio: "A sound the app can play",
  font: "A font the app's text can use",
  model: "A 3D model for a 3D app",
};
const KINDS: AssetKind[] = ["logo", "image", "reference"];
export const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml,audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav,.woff2,.woff,.ttf,.otf,.glb";
const EXTENSIONS = /\.(png|jpe?g|webp|svg|mp3|ogg|wav|woff2?|ttf|otf|glb)$/i;

/** Files from a drop or paste that GoodBuild can use (others are ignored). Browsers don't know fonts or .glb, so the name counts. */
export function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((f) => ACCEPT.split(",").includes(f.type) || EXTENSIONS.test(f.name));
}

function KindIcon({ asset }: { asset: AssetInfo }) {
  const Icon = asset.kind === "audio" ? Music : asset.kind === "font" ? Type : asset.kind === "model" ? Box : ImageIcon;
  return <Icon className="size-4" aria-hidden />;
}

/**
 * Uploaded files as chips above the composer (DESIGN_SYSTEM §3 chips). The kind label is a
 * menu: a logo uploaded as an image (or a screenshot dropped in) can be re-classified, and the
 * server re-describes it for its new role.
 */
export function AssetBar({
  assets,
  assetUrls,
  onRemove,
  onChangeKind,
}: {
  assets: AssetInfo[];
  assetUrls: Record<string, string>;
  onRemove: (id: string) => void;
  onChangeKind: (id: string, kind: AssetKind) => void;
}) {
  if (!assets.length) return null;
  return (
    <ul className="mb-3 flex flex-wrap gap-2" aria-label="Uploaded files">
      {assets.map((a) => (
        <li key={a.id} className="flex items-center gap-1.5 rounded-full bg-tint py-1 pr-1.5 pl-1 text-[13px] font-medium text-violet" title={a.description || a.name}>
          {isImage(a.mime) && assetUrls[a.name] ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL thumbnail
            <img src={assetUrls[a.name]} alt="" className="size-6 rounded-full bg-surface object-cover" />
          ) : (
            <KindIcon asset={a} />
          )}
          <span className="max-w-[9rem] truncate">{a.name}</span>
          {!isImage(a.mime) ? (
            <span className="px-1.5 text-[11px] font-normal text-grey-600">{KIND_LABEL[a.kind]}</span>
          ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${a.name} is a ${KIND_LABEL[a.kind].toLowerCase()}. Change`}
                className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-normal text-grey-600 outline-none hover:bg-surface hover:text-violet focus-visible:shadow-focus"
              >
                {KIND_LABEL[a.kind]}
                <ChevronDown className="size-3" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Use as</DropdownMenuLabel>
              {KINDS.map((k) => (
                <DropdownMenuItem key={k} disabled={k === a.kind} onSelect={() => onChangeKind(a.id, k)}>
                  <Check className={k === a.kind ? "mt-0.5 size-4 text-violet" : "mt-0.5 size-4 opacity-0"} aria-hidden />
                  <span className="min-w-0">
                    <span className="block font-medium">{KIND_LABEL[k]}</span>
                    <span className="block text-xs text-grey-600">{KIND_HELP[k]}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          )}
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            aria-label={`Remove ${a.name}`}
            className="grid size-5 place-items-center rounded-full text-grey-600 outline-none hover:bg-surface hover:text-violet focus-visible:shadow-focus"
          >
            <X className="size-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The attach button: pick what the file is for, then choose it. The chosen kind travels with
 * the file input (data-kind), so a drop, a paste or a test that sets the input's files directly
 * all go through the same path as the file dialog.
 */
export function AttachMenu({ onUpload, uploading }: { onUpload: (file: File, kind: AssetKind) => void; uploading: boolean }) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        data-kind="image"
        aria-label="Choose a file"
        className="hidden"
        onChange={(e) => {
          const kind = (e.target.dataset.kind as AssetKind | undefined) ?? "image";
          for (const file of imageFiles(e.target.files)) onUpload(file, kind);
          e.target.value = "";
          e.target.dataset.kind = "image";
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Attach a file"
            title="Attach a logo, image, sound, font or 3D model (or drop or paste a file)"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-surface text-grey-600 outline-none hover:text-violet focus-visible:shadow-focus disabled:opacity-55"
            disabled={uploading}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Attach</DropdownMenuLabel>
          {KINDS.map((k) => (
            <DropdownMenuItem
              key={k}
              onSelect={() => {
                if (input.current) input.current.dataset.kind = k;
                // Let the menu close before the file dialog opens.
                setTimeout(() => input.current?.click(), 0);
              }}
            >
              <span className="min-w-0">
                <span className="block font-medium">{KIND_LABEL[k]}</span>
                <span className="block text-xs text-grey-600">{KIND_HELP[k]}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onSelect={() => {
              if (input.current) input.current.dataset.kind = "image";
              setTimeout(() => input.current?.click(), 0);
            }}
          >
            <span className="min-w-0">
              <span className="block font-medium">Sound, font or 3D model</span>
              <span className="block text-xs text-grey-600">MP3, OGG, WAV, WOFF2, TTF, OTF or GLB</span>
            </span>
          </DropdownMenuItem>
          <p className="px-3 py-2 text-[11px] text-grey-600">Images up to 5 MB, sounds up to 10 MB, 3D models up to 15 MB, fonts up to 2 MB. You can also drop or paste a file.</p>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
