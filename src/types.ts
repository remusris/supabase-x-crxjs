// TransitionType
export type TransitionType =
  | "link"
  | "typed"
  | "auto_bookmark"
  | "auto_subframe"
  | "manual_subframe"
  | "generated"
  | "auto_toplevel"
  | "form_submit"
  | "reload"
  | "keyword"
  | "keyword_generated";

export interface VisitItem {
  id: string;
  referringVisitId: string;
  transition: TransitionType;
  visitId: string;
  visitTime?: number;
}

export type HistoryItem = {
  id: string;
  lastVisitTime?: number;
  title?: string;
  typedCount: number;
  url?: string;
  visitCount: number;
};

// setting the type for the object that gets uploaded
export type objectToPush = {
  id: string | null;
  url: string | null;
  node: string | null;
  link: { source: string | null; target: string | null };
  activeTabId: number | null;
  activeTabWindowId: number | null;
  title: string | null;
  tabFaviconUrl: string | null;
  tabWindowId: number | null;
  tabId: number | null;
  tabStatus: string | null;
  tabWindowLength: number | null;
  user_id: string | null;
  time: number | null;
  transitionType: TransitionType | null;
  linkTransition: string | null;
  activatedTab: { lastQueryTime: number | null; url: string | null };
  highlightedTab: { lastQueryTime: number | null; url: string | null };
  session_id: string | null;
};

export interface MutedInfo {
  muted: boolean;
  reason?: string;
}

export type TabStatus = "unloaded" | "loading" | "complete";

export interface Tab {
  active: boolean;
  audible?: boolean;
  autoDiscardable: boolean;
  discarded: boolean;
  favIconUrl?: string;
  groupId: number;
  height?: number;
  highlighted: boolean;
  id?: number;
  incognito: boolean;
  index: number;
  mutedInfo?: MutedInfo;
  openerTabId?: number;
  pendingUrl?: string;
  pinned: boolean;
  selected: boolean;
  sessionId?: string;
  status?: TabStatus;
  title?: string;
  url?: string;
  width?: number;
  windowId: number;
}

export type Message =
  | {
      action: "getSession" | "signout" | "refresh";
      value: null;
    }
  | {
      action: "signup" | "signin";
      value: {
        email: string;
        password: string;
      };
    }
  | {
      action: "addSmoothie";
      value: {
        title: string;
        method: string;
        rating: number;
      };
    }
  | {
      action: "fetchSmoothies";
      value: null;
    }
  | {
      action: "fetchTopics";
      value: null;
    };

export type ResponseCallback = (data: any) => void;
