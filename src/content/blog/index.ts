import { celoPosts } from "./celo";
import { comparePosts } from "./compare";
import { freePosts } from "./free";
import { ideasPosts } from "./ideas";
import { minipayPosts } from "./minipay";
import { vibePosts } from "./vibe";
import type { Post } from "./types";

export const POSTS: Post[] = [...minipayPosts, ...celoPosts, ...comparePosts, ...freePosts, ...ideasPosts, ...vibePosts];

export function getPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function relatedPosts(post: Post): Post[] {
  return post.related.map(getPost).filter((p): p is Post => Boolean(p));
}

export function readMinutes(post: Post): number {
  const text = [post.intro, ...post.sections.flatMap((s) => [...(s.paragraphs ?? []), ...(s.bullets ?? []), ...(s.steps ?? [])])].join(" ");
  return Math.max(2, Math.round(text.split(/\s+/).length / 220));
}
