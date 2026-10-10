/**
 * Tab-based browser panel orchestrator.
 *
 * Manages tab CRUD, history persistence, and session persistence.
 * Visual rendering is delegated to sub-components in `./browser/`.
 */

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import type { GrabbedElement } from "@/types";
import { capture } from "@/lib/analytics/analytics";
import { TabBar } from "@/components/TabBar";
import type { BrowserTab } from "./browser/browser-types";
import { MAX_BROWSER_HISTORY } from "./browser/browser-types";
import {
  getDefaultBrowserColorScheme,
  normalizeHistoryUrl,
  normalizeHistoryTitle,
  readBrowserHistory,
  readBrowserSession,
  reorderTabsById,
  resolveNavigationInput,
  writeBrowserHistory,
  writeBrowserSession,
} from "./browser/browser-utils";
import { BrowserStartPage } from "./browser/BrowserStartPage";
import { WebviewInstance } from "./browser/WebviewInstance";
import { useI18n } from "@/lib/i18n";

// ── Props ───────────────────────────────────────────────────────────────

interface BrowserPanelProps {
  persistKey: string;
  /** An idempotent request from an app preview or another workspace surface. */
  openRequest?: { requestId: string; tabId: string; url: string; title: string };
  onElementGrab?: (element: GrabbedElement) => void;
  headerControls?: React.ReactNode;
}

// ── Header icon ─────────────────────────────────────────────────────────

const BrowserHeaderIcon = forwardRef<SVGSVGElement, React.ComponentPropsWithoutRef<typeof Globe>>(
  ({ className, ...rest }, ref) => (
    <Globe ref={ref} {...rest} className={`${className ?? ""} text-sky-600/70 dark:text-sky-200/50`} />
  ),
);

// ── Component ───────────────────────────────────────────────────────────

export function BrowserPanel(props: BrowserPanelProps) {
  // A changed persistence scope must never write the previous scope's tabs.
  return <BrowserPanelState key={props.persistKey} {...props} />;
}

function BrowserPanelState({ persistKey, openRequest, onElementGrab, headerControls }: BrowserPanelProps) {
  const { t } = useI18n();
  const lastOpenRequest = useRef<string | null>(null);
  const [tabs, setTabs] = useState<BrowserTab[]>(() => readBrowserSession(persistKey).tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(() => readBrowserSession(persistKey).activeTabId);
  const [inspectMode, setInspectMode] = useState(false);
  const [emptyInput, setEmptyInput] = useState("");
  const [showEmptySuggestions, setShowEmptySuggestions] = useState(false);
  const [history, setHistory] = useState(readBrowserHistory);

  // ── Persistence effects ─────────────────────────────────────────────

  useEffect(() => {
    writeBrowserHistory(history);
  }, [history]);

  useEffect(() => {
    writeBrowserSession(persistKey, tabs, activeTabId);
  }, [activeTabId, persistKey, tabs]);

  useEffect(() => {
    if (!openRequest || lastOpenRequest.current === openRequest.requestId) return;
    let parsed: URL;
    try { parsed = new URL(openRequest.url); } catch { return; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    lastOpenRequest.current = openRequest.requestId;
    const requestedTab: BrowserTab = { id: openRequest.tabId, url: parsed.href, title: openRequest.title, label: openRequest.title, isLoading: true, colorScheme: getDefaultBrowserColorScheme(), isStartPage: false };
    setTabs((previous) => previous.some((tab) => tab.id === requestedTab.id)
      ? previous.map((tab) => tab.id === requestedTab.id ? { ...tab, ...requestedTab } : tab)
      : [...previous, requestedTab]);
    setActiveTabId(requestedTab.id);
  }, [openRequest]);

  // ── History management ──────────────────────────────────────────────

  const addHistoryEntry = useCallback((raw: string, title?: string) => {
    const normalized = normalizeHistoryUrl(raw);
    if (!normalized) return;
    const resolvedTitle = normalizeHistoryTitle(title, normalized);
    setHistory((prev) => {
      const deduped = prev.filter((entry) => entry.url !== normalized);
      return [{ url: normalized, title: resolvedTitle }, ...deduped].slice(0, MAX_BROWSER_HISTORY);
    });
  }, []);

  // ── Tab management ──────────────────────────────────────────────────

  const createTab = useCallback((url?: string) => {
    const isStartPage = !url;
    const tab: BrowserTab = {
      id: crypto.randomUUID(),
      url: url ?? "",
      title: t("New Tab"),
      label: t("New Tab"),
      isLoading: !isStartPage,
      colorScheme: getDefaultBrowserColorScheme(),
      isStartPage,
    };
    setTabs((prev) => [...prev, tab]);
    capture("browser_tab_created");
    setActiveTabId(tab.id);
  }, [t]);

  const openFirstTab = useCallback((value?: string) => {
    const source = value ?? emptyInput;
    const resolved = resolveNavigationInput(source);
    if (!resolved) return;
    createTab(resolved);
    setEmptyInput("");
    setShowEmptySuggestions(false);
  }, [createTab, emptyInput]);

  const openTabFromStartPage = useCallback((tabId: string, input: string) => {
    const resolved = resolveNavigationInput(input);
    if (!resolved) return false;
    setTabs((prev) => prev.map((tab) => (tab.id === tabId
      ? { ...tab, url: resolved, isLoading: true, isStartPage: false }
      : tab)));
    return true;
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const updateTab = useCallback((tabId: string, updates: Partial<BrowserTab>) => {
    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== tabId) return tab;
      const merged = { ...tab, ...updates };
      merged.label = merged.title || t("New Tab");
      return merged;
    }));
  }, [t]);

  const reorderTabs = useCallback((fromTabId: string, toTabId: string) => {
    setTabs((prev) => reorderTabsById(prev, fromTabId, toTabId));
  }, []);

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onNewTab={() => createTab()}
        headerIcon={BrowserHeaderIcon}
        headerLabel={t("Browser")}
        renderTabIcon={(tab) =>
          tab.isLoading ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin opacity-50" />
          ) : (
            <Globe className="h-2.5 w-2.5 opacity-50" />
          )
        }
        tabMaxWidth="max-w-24"
        activeClass="bg-foreground/[0.08] text-foreground/80"
        inactiveClass="text-foreground/35 hover:text-foreground/55 hover:bg-foreground/[0.04]"
        onReorderTabs={reorderTabs}
        headerActions={headerControls}
      />

      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 flex flex-col ${tab.id === activeTabId ? "visible" : "invisible"}`}
          >
            {tab.isStartPage ? (
              <BrowserStartPage
                input={emptyInput}
                setInput={setEmptyInput}
                showSuggestions={showEmptySuggestions}
                setShowSuggestions={setShowEmptySuggestions}
                history={history}
                onOpen={(value) => {
                  const opened = openTabFromStartPage(tab.id, value);
                  if (opened) {
                    setEmptyInput("");
                    setShowEmptySuggestions(false);
                  }
                }}
                recentHistory={history.slice(0, 6)}
              />
            ) : (
              <WebviewInstance
                tab={tab}
                onUpdateTab={(updates) => updateTab(tab.id, updates)}
                onNavigate={(url) => updateTab(tab.id, { url, isLoading: true, isStartPage: false })}
                history={history}
                onVisitUrl={addHistoryEntry}
                inspectMode={inspectMode && tab.id === activeTabId}
                onToggleInspect={onElementGrab ? () => setInspectMode((prev) => !prev) : undefined}
                onElementGrab={onElementGrab ? (element) => {
                  setInspectMode(false);
                  onElementGrab(element);
                } : undefined}
                onInspectCancel={() => setInspectMode(false)}
              />
            )}
          </div>
        ))}
        {tabs.length === 0 && (
          <BrowserStartPage
            input={emptyInput}
            setInput={setEmptyInput}
            showSuggestions={showEmptySuggestions}
            setShowSuggestions={setShowEmptySuggestions}
            history={history}
            onOpen={(value) => openFirstTab(value)}
            recentHistory={history.slice(0, 6)}
          />
        )}
      </div>
    </div>
  );
}
