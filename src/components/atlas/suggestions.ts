/**
 * Shared prompt suggestions, kept out of the component files so the .tsx files
 * export components only (react-refresh warns on mixed exports).
 */

/** Starting points on the empty state. Clicking one sends it. */
export const ATLAS_SUGGESTIONS = [
  "How does deal scoring work?",
  "Give me a tour of the platform",
  "What deals are in LOI right now?",
  "How do I add a capital partner?",
];

/** The compact row above the composer once a thread has messages — suggestions
 * used to disappear for good after the first turn. */
export const ATLAS_FOLLOW_UPS = [
  "Summarise that as a table",
  "Which deals are affected?",
  "What should I look at next?",
];
