 │ Rad-Mem Landing Page Refinements                                                                                                                        │
     │                                                                                                                                                         │
     │ Overview                                                                                                                                                │
     │                                                                                                                                                         │
     │ Two main tasks:                                                                                                                                         │
     │ 1. Unified video scroll transform - Single video morphs from fullscreen background → framed inline (lands into AgentExplainer)                          │
     │ 2. Branding update - Change all Claude-Mem references to Rad-Mem (41 occurrences)                                                                       │
     │                                                                                                                                                         │
     │ ---                                                                                                                                                     │
     │ Task 1: Unified Video Scroll Transform                                                                                                                  │
     │                                                                                                                                                         │
     │ Current Problem                                                                                                                                         │
     │                                                                                                                                                         │
     │ - Two separate video elements (Hero + AgentExplainer)                                                                                                   │
     │ - Discontinuous visual experience                                                                                                                       │
     │ - Complex scroll timing between components                                                                                                              │
     │                                                                                                                                                         │
     │ Solution: Single Video with Scroll-Linked Transform                                                                                                     │
     │                                                                                                                                                         │
     │ Approach: Keep a single <video> element that starts fixed fullscreen and transforms via CSS/framer-motion into a framed inline element that "docks"     │
     │ into the AgentExplainer section.                                                                                                                        │
     │                                                                                                                                                         │
     │ Implementation Steps                                                                                                                                    │
     │                                                                                                                                                         │
     │ Step 1: Create useVideoTransform hook                                                                                                                   │
     │                                                                                                                                                         │
     │ New file: src/hooks/useVideoTransform.ts                                                                                                                │
     │ - Unified scroll tracking spanning Hero → AgentExplainer                                                                                                │
     │ - Export transform values for both components to consume                                                                                                │
     │ - Scroll stages:                                                                                                                                        │
     │   - 0 → 0.3: Hero active (video fullscreen, content fades)                                                                                              │
     │   - 0.3 → 0.7: Video transforms (shrinks, gains border-radius)                                                                                          │
     │   - 0.7 → 1.0: Video docked, AgentExplainer content appears                                                                                             │
     │                                                                                                                                                         │
     │ Step 2: Modify Hero.tsx                                                                                                                                 │
     │                                                                                                                                                         │
     │ - Remove local video transforms                                                                                                                         │
     │ - Keep video element with position: fixed                                                                                                               │
     │ - Import transforms from shared hook                                                                                                                    │
     │ - Video wrapper gets scroll-linked: scale, borderRadius, width/maxWidth                                                                                 │
     │                                                                                                                                                         │
     │ Step 3: Modify AgentExplainer.tsx                                                                                                                       │
     │                                                                                                                                                         │
     │ - Remove the duplicate video element entirely                                                                                                           │
     │ - Create a "landing zone" placeholder div that the video visually docks into                                                                            │
     │ - Content appears when video reaches docked state (stage 3)                                                                                             │
     │ - Use position: sticky or calculated offsets so content flows naturally below video                                                                     │
     │                                                                                                                                                         │
     │ Step 4: CSS Updates in globals.css                                                                                                                      │
     │                                                                                                                                                         │
     │ - Video wrapper needs will-change: transform, border-radius                                                                                             │
     │ - Landing zone in AgentExplainer: min-height matching video aspect ratio                                                                                │
     │ - Responsive: maxWidth: clamp(300px, 90vw, 640px) not fixed 640px                                                                                       │
     │                                                                                                                                                         │
     │ Key Framer-Motion APIs                                                                                                                                  │
     │                                                                                                                                                         │
     │ const { scrollYProgress } = useScroll({                                                                                                                 │
     │   target: containerRef,  // Spans Hero + AgentExplainer                                                                                                 │
     │   offset: ["start start", "end center"]                                                                                                                 │
     │ })                                                                                                                                                      │
     │                                                                                                                                                         │
     │ const videoScale = useTransform(scrollYProgress, [0, 0.3, 0.7], [1, 1, 0.85])                                                                           │
     │ const videoBorderRadius = useTransform(scrollYProgress, [0.3, 0.7], [0, 16])                                                                            │
     │ const videoMaxWidth = useTransform(scrollYProgress, [0.3, 0.7], ["100vw", "640px"])                                                                     │
     │                                                                                                                                                         │
     │ Critical Files                                                                                                                                          │
     │                                                                                                                                                         │
     │ - src/components/landing/Hero.tsx                                                                                                                       │
     │ - src/components/landing/AgentExplainer.tsx                                                                                                             │
     │ - src/app/globals.css (lines 610-760 hero styles, 3110-3192 agent-explainer styles)                                                                     │
     │ - New: src/hooks/useVideoTransform.ts                                                                                                                   │
     │                                                                                                                                                         │
     │ ---                                                                                                                                                     │
     │ Task 2: Branding Update (Claude-Mem → Rad-Mem)                                                                                                          │
     │                                                                                                                                                         │
     │ 41 References to Update                                                                                                                                 │
     │                                                                                                                                                         │
     │ TypeScript/TSX Files (38 refs)                                                                                                                          │
     │                                                                                                                                                         │
     │ | File                                        | Changes                              |                                                                  │
     │ |---------------------------------------------|--------------------------------------|                                                                  │
     │ | package.json                                | name, pm2 script names               |                                                                  │
     │ | src/constants/api.ts                        | Comment only                         |                                                                  │
     │ | src/components/landing/ProtocolCTA.tsx      | GitHub URLs (6x)                     |                                                                  │
     │ | src/components/landing/AgentExplainer.tsx   | GitHub URLs (3x)                     |                                                                  │
     │ | src/components/landing/Hero.tsx             | GitHub URLs, install commands (4x)   |                                                                  │
     │ | src/components/landing/UIShowcase.tsx       | Display text, logo src (2x)          |                                                                  │
     │ | src/components/landing/WorkflowAgnostic.tsx | Display text (2x)                    |                                                                  │
     │ | src/components/landing/CompressionDemo.tsx  | Display text (1x)                    |                                                                  │
     │ | src/components/landing/Features.tsx         | Display text (1x)                    |                                                                  │
     │ | src/components/landing/Header.tsx           | Logo src, alt text, GitHub URLs (8x) |                                                                  │
     │ | src/components/landing/Pricing.tsx          | Comment, GitHub URL (2x)             |                                                                  │
     │ | src/components/landing/Footer.tsx           | GitHub URLs, copyright (5x)          |                                                                  │
     │                                                                                                                                                         │
     │ Asset Files (3 renames)                                                                                                                                 │
     │                                                                                                                                                         │
     │ - /public/claude-mem-logomark.webp → rad-mem-logomark.webp                                                                                              │
     │ - /public/assets/claude-mem-logo-for-dark-mode.webp → rad-mem-logo-for-dark-mode.webp                                                                   │
     │ - /public/assets/claude-mem-logomark.webp → rad-mem-logomark.webp                                                                                       │
     │                                                                                                                                                         │
     │ Execution                                                                                                                                               │
     │                                                                                                                                                         │
     │ Use replace_all flag for bulk changes within each file. Rename asset files via Bash mv commands.                                                        │
     │                                                                                                                                                         │
     │ Note: GitHub URLs (thedotmack/claude-mem) should change to thedotmack/rad-mem assuming repo will be renamed.                                            │
     │                                                                                                                                                         │
     │ ---                                                                                                                                                     │
     │ Execution Order                                                                                                                                         │
     │                                                                                                                                                         │
     │ 1. Branding first - Quick wins, no structural changes                                                                                                   │
     │ 2. Video transform - More complex, test thoroughly after                                                                                                │
     │                                                                                                                                                         │
     │ ---                                                                                                                                                     │
     │ Testing Checklist                                                                                                                                       │
     │                                                                                                                                                         │
     │ - Scroll from top to AgentExplainer - video transforms smoothly                                                                                         │
     │ - Fast scroll - no janky jumps                                                                                                                          │
     │ - Mobile viewport - video scales appropriately                                                                                                          │
     │ - All Rad-Mem text/links correct                                                                                                                        │
     │ - Logo images load (after rename)                                                                                                                       │
     │ - PM2 process name updated after package.json change                                                                                                    │