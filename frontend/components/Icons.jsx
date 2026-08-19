"use client";

import React from "react";

/* Crisp stroke icons (lucide-style, hand-rolled, no deps). They draw in
 * currentColor, so they're white on the navy sidebar and take each
 * feature's blue in content — always sharp, never emoji-fuzzy. */

const PATHS = {
  home: (<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></>),
  board: (<><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M9 3v18M15 3v12" /></>),
  finance: (<><rect x="2.5" y="5.5" width="19" height="13.5" rx="2.5" /><path d="M2.5 9.5h19" /><path d="M6 15h4" /></>),
  todos: (<><rect x="3" y="3" width="18" height="18" rx="4.5" /><path d="m8 12.2 2.8 2.8L16 9.5" /></>),
  graph: (<><circle cx="5.5" cy="6" r="2.3" /><circle cx="18.5" cy="6" r="2.3" /><circle cx="12" cy="18" r="2.3" /><path d="M7.8 6h8.4M6.6 8.1 10.9 16M17.4 8.1 13.1 16" /></>),
  note: (<><path d="M12.8 4.8 4 13.6 3 21l7.4-1L19.2 11.2" /><path d="M15.5 3.5a2.3 2.3 0 0 1 3.2 0l1.8 1.8a2.3 2.3 0 0 1 0 3.2l-1.3 1.3-5-5Z" /></>),
  video: (<><rect x="2.5" y="4.5" width="19" height="15" rx="3.5" /><path d="m10 9 5.2 3L10 15Z" /></>),
  book: (<><path d="M12 6.2C10 4.5 7 4 4 4.2V19c3-.2 6 .3 8 2 2-1.7 5-2.2 8-2V4.2c-3-.2-6 .3-8 2Z" /><path d="M12 6.2V21" /></>),
  doc: (<><path d="M14 3H7a1.6 1.6 0 0 0-1.6 1.6v14.8A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6V7.6Z" /><path d="M14 3v4.6h4.6" /><path d="M9 12.5h6M9 16h6" /></>),
  tag: (<><path d="M12.9 2.9 21 11a2.1 2.1 0 0 1 0 3l-7 7a2.1 2.1 0 0 1-3 0L2.9 12.9A2.1 2.1 0 0 1 2.3 11.4V4.4a2.1 2.1 0 0 1 2.1-2.1h7a2.1 2.1 0 0 1 1.5.6Z" /><circle cx="7.6" cy="7.6" r="1.4" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><path d="m20.6 20.6-4.6-4.6" /></>),
  ai: (<><path d="M11 4.5 12.6 9l4.4 1.6-4.4 1.6L11 16.7l-1.6-4.5L5 10.6 9.4 9Z" /><path d="M18.5 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z" /></>),
  trash: (<><path d="M4 7h16" /><path d="M9.5 7V5.2A1.7 1.7 0 0 1 11.2 3.5h1.6a1.7 1.7 0 0 1 1.7 1.7V7" /><path d="m6.3 7 .8 12a1.7 1.7 0 0 0 1.7 1.5h6.4a1.7 1.7 0 0 0 1.7-1.5l.8-12" /><path d="M10 11v5.5M14 11v5.5" /></>),
  settings: (<><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" /></>),
  bell: (<><path d="M18 9a6 6 0 0 0-12 0c0 6-2.4 7.2-2.4 7.2h16.8S18 15 18 9Z" /><path d="M10 20a2.2 2.2 0 0 0 4 0" /></>),
  plus: (<><path d="M12 4.5v15M4.5 12h15" /></>),
  menu: (<><path d="M3.5 5h17M3.5 12h17M3.5 19h17" /></>),
  calendar: (<><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10.5h17" /></>),
};

export function Ic({ name, size = 18, className = "", strokeWidth = 1.7 }) {
  const p = PATHS[name];
  if (!p) return null;
  return (
    <svg className={`icn ${className}`} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p}
    </svg>
  );
}
