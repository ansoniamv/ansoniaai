import { Search } from "lucide-react";

export function PageSearchWidget() {
  const openGlobalSearch = () => {
    // Trigger the GlobalSearchPalette's ⌘K/Ctrl+K listener
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
      }),
    );
  };

  return (
    <div data-page-search-ignore>
      <button
        onClick={openGlobalSearch}
        className="fixed bottom-24 right-6 z-40 h-12 w-12 rounded-full bg-card border border-border text-foreground shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
        aria-label="Search the app"
        title="Search the app (⌘K)"
      >
        <Search className="h-4.5 w-4.5" />
      </button>
    </div>
  );
}
