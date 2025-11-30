#!/usr/bin/env node
import{execSync as l}from"child_process";import{join as n}from"path";import{homedir as c}from"os";import{existsSync as f}from"fs";import{join as t,dirname as p,basename as x}from"path";import{homedir as s}from"os";import{fileURLToPath as u}from"url";function d(){return typeof __dirname<"u"?__dirname:p(u(import.meta.url))}var T=d(),e=process.env.RAD_MEM_DATA_DIR||t(s(),".rad-mem"),r=process.env.CLAUDE_CONFIG_DIR||t(s(),".claude"),y=t(e,"archives"),S=t(e,"logs"),A=t(e,"trash"),w=t(e,"backups"),P=t(e,"settings.json"),E=t(e,"rad-mem.db"),I=t(e,"vector-db"),C=t(r,"settings.json"),b=t(r,"commands"),v=t(r,"CLAUDE.md");function i(){return parseInt(process.env.RAD_MEM_PORT||"38888",10)}var g=n(c(),".claude","plugins","marketplaces","thedotmack"),h=n(g,"node_modules");f(h)||(console.error(`
---
\u{1F389}  Note: This appears under Plugin Hook Error, but it's not an error. That's the only option for 
   user messages in Claude Code UI until a better method is provided.
---

\u26A0\uFE0F  Rad-Mem: First-Time Setup

Dependencies have been installed in the background. This only happens once.

\u{1F4A1} TIPS:
   \u2022 Memories will start generating while you work
   \u2022 Use /init to write or update your CLAUDE.md for better project context
   \u2022 Try /clear after one session to see what context looks like

Thank you for installing Rad-Mem!

This message was not added to your startup context, so you can continue working as normal.
`),process.exit(3));try{let o=n(c(),".claude","plugins","marketplaces","thedotmack","plugin","scripts","context-hook.js"),a=l(`node "${o}" --colors`,{encoding:"utf8"}),m=i();console.error(`

\u{1F4DD} Rad-Mem Context Loaded
   \u2139\uFE0F  Note: This appears as stderr but is informational only

`+a+`

\u{1F4AC} Feedback & Support
https://github.com/thedotmack/rad-mem/discussions/110

\u{1F4FA} Watch live in browser http://localhost:${m}/
`)}catch(o){console.error(`\u274C Failed to load context display: ${o}`)}process.exit(3);
