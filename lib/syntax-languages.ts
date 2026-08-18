/**
 * Shared Prism language registry for the light build of
 * react-syntax-highlighter.
 *
 * The full `Prism` export bundles refractor with *every* language (~1.1MB of
 * JS parsed on first paint even though a typical chat uses a handful). The
 * light build ships no languages; we register a curated set that covers the
 * vast majority of code shown in chats and the file viewer. Unknown
 * languages fall back to plain monospace text (SyntaxHighlighter handles an
 * unregistered language by skipping tokenization).
 */
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import lua from "react-syntax-highlighter/dist/esm/languages/prism/lua";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import nginx from "react-syntax-highlighter/dist/esm/languages/prism/nginx";
import perl from "react-syntax-highlighter/dist/esm/languages/prism/perl";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import r from "react-syntax-highlighter/dist/esm/languages/prism/r";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import scala from "react-syntax-highlighter/dist/esm/languages/prism/scala";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";

const LANGUAGES: Record<string, unknown> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  docker,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  lua,
  markdown,
  nginx,
  perl,
  php,
  python,
  r,
  ruby,
  rust,
  scala,
  sql,
  swift,
  toml,
  typescript,
  xml: markup,
  yaml,
};

// Common markdown fence aliases seen in model output.
const ALIAS_MAP: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  python3: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  yml: "yaml",
  html: "markup",
  svg: "markup",
  vue: "markup",
  md: "markdown",
  dockerfile: "docker",
  makefile: "bash",
  patch: "diff",
};

/** Register all curated languages on a light SyntaxHighlighter instance. */
export function registerSyntaxLanguages(register: (name: string, lang: unknown) => void): void {
  for (const [name, lang] of Object.entries(LANGUAGES)) register(name, lang);
}

/**
 * Normalize a fence info string / file extension to a registered language
 * name (or undefined for plain text). Handles `lang`, `lang x=y` metadata,
 * and common aliases.
 */
export function resolveSyntaxLanguage(raw: string | undefined): string | undefined {
  const lang = (raw ?? "").trim().split(/[\s{]/)[0].toLowerCase();
  if (!lang || lang === "text" || lang === "plaintext" || lang === "txt") return undefined;
  if (LANGUAGES[lang]) return lang;
  const alias = ALIAS_MAP[lang];
  return alias && LANGUAGES[alias] ? alias : undefined;
}
