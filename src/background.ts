// import browser from "webextension-polyfill";
import supabase from "./lib/supabase-client";
import { v4 as uuidv4 } from "uuid";

type Message =
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

type ResponseCallback = (data: any) => void;

const chromeStorageKeys = {
  supabaseAccessToken: "supabaseAccessToken",
  supabaseRefreshToken: "supabaseRefreshToken",
  supabaseUserData: "supabaseUserData",
  supabaseExpiration: "supabaseExpiration",
  supabaseUserId: "supabaseUserId",
};

//grabbing keys from local.storage
async function getKeyFromStorage(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result[key]);
      }
    });
  });
}

//setting keys in local storage
async function setKeyInStorage(
  keyValuePairs: Record<string, any>
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.local.set(keyValuePairs, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

//removing keys from local storage
async function removeKeysFromStorage(keys: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

//handling the messages from popup
async function handleMessage(
  { action, value }: Message,
  response: ResponseCallback
) {
  if (action === "signin") {
    console.log("requesting auth");
    const { data, error } = await supabase.auth.signInWithPassword(value);
    console.log("token expiration", data.session.expires_at);
    if (data && data.session) {
      await setKeyInStorage({
        [chromeStorageKeys.supabaseAccessToken]: data.session.access_token,
        [chromeStorageKeys.supabaseRefreshToken]: data.session.refresh_token,
        [chromeStorageKeys.supabaseUserData]: data.user,
        [chromeStorageKeys.supabaseExpiration]: data.session.expires_at,
        [chromeStorageKeys.supabaseUserId]: data.user.id,
      });
      console.log("User data stored in chrome.storage.sync");
      response({ data, error });
    } else {
      response({ data: null, error: "No active session" });
    }
  } else if (action === "signup") {
    const { data, error } = await supabase.auth.signUp(value);
    if (data) {
      await setKeyInStorage({
        [chromeStorageKeys.supabaseAccessToken]: data.session.access_token,
        [chromeStorageKeys.supabaseRefreshToken]: data.session.refresh_token,
        [chromeStorageKeys.supabaseUserData]: data.user,
        [chromeStorageKeys.supabaseExpiration]: data.session.expires_at,
        [chromeStorageKeys.supabaseUserId]: data.user.id,
      });
      console.log("User data stored in chrome.storage.sync");
      response({ message: "Successfully signed up!", data: data });
    } else {
      response({ data: null, error: error?.message || "Signup failed" });
    }
  } else if (action === "signout") {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      await removeKeysFromStorage([
        chromeStorageKeys.supabaseAccessToken,
        chromeStorageKeys.supabaseRefreshToken,
        chromeStorageKeys.supabaseUserData,
        chromeStorageKeys.supabaseExpiration,
        chromeStorageKeys.supabaseUserId,
      ]);
      console.log("User data removed from chrome.storage.sync");
      response({ message: "Successfully signed out!" });
    } else {
      response({ error: error?.message || "Signout failed" });
    }
  } else if (action === "refresh") {
    const refreshToken = (await getKeyFromStorage(
      chromeStorageKeys.supabaseRefreshToken
    )) as string;
    if (refreshToken) {
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });

      console.log("token data", data);

      // If either data.session or data.user is null, log the user out
      if (!data || !data.session || !data.user) {
        await handleMessage({ action: "signout", value: null }, console.log);
        response({
          data: null,
          error: "Session expired. Please log in again.",
        });
      } else {
        await setKeyInStorage({
          [chromeStorageKeys.supabaseAccessToken]: data.session.access_token,
          [chromeStorageKeys.supabaseRefreshToken]: data.session.refresh_token,
          [chromeStorageKeys.supabaseUserData]: data.user,
          [chromeStorageKeys.supabaseExpiration]: data.session.expires_at,
          [chromeStorageKeys.supabaseUserId]: data.user.id,
        });

        console.log("User data refreshed in chrome.storage.sync");
        response({ data: data });
      }
    } else {
      response({ data: null, error: "No refresh token available" });
    }
  } else if (action === "fetchSmoothies") {
    const { data, error } = await supabase.from("smoothies").select();

    if (error) {
      response({
        data: null,
        error: error.message || "Fetching smoothies failed",
      });
    } else {
      response({ data, error: null });
    }
  } else if (action === "addSmoothie") {
    try {
      const { title, method, rating } = value;
      const { data, error } = await supabase
        .from("smoothies")
        .insert([{ title, method, rating }]);
      if (error) {
        response({ error: error.message, data: null });
      } else {
        response({ error: null, data: data });
      }
    } catch (error) {
      response({ error: error.message, data: null });
    }
  } else if (action === "fetchTopics") {
    const { data, error } = await supabase.from("topics").select();

    if (error) {
      response({
        data: null,
        error: error.message || "Fetching topics failed",
      });
    } else {
      response({ data, error: null });
    }
  }
}

//@ts-ignore - essential code below
chrome.runtime.onMessage.addListener((msg, sender, response) => {
  handleMessage(msg, response);
  return true;
});

// init the sessions
let activeSession = {
  startTime: null,
  endTime: null,
  id: null,
  user_id: null,
};
let isSessionActive = false;
let inactivityTimeout;

console.log("isSessionActive", isSessionActive);

// listening to content script to restart timer
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "userActive") {
    resetInactivityTimeout();
  }
});

// reset active session
function resetActiveSession() {
  activeSession = {
    startTime: null,
    endTime: null,
    id: null,
    user_id: null,
  };
}

// check for active session
function isActiveSessionChecker(historyItem) {
  console.log("inside isActiveSessionChecker");
  console.log("isSessionActive", isSessionActive);

  if (isSessionActive == false) {
    console.log("session started");
    resetActiveSession();
    activeSession.startTime = historyItem.lastVisitTime;
    createSessionId();
    isSessionActive = true;
  }
}

// reset inactivity timer
function resetInactivityTimeout() {
  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
    console.log("timer has been cleared");
  }
  inactivityTimeout = setTimeout(() => {
    console.log("timer has finished");
    if (isSessionActive) {
      activeSession.endTime = Date.now();
      console.log("end session upload");
      endSessionUpload();
      isSessionActive = false;
    }
  }, 120000); // 120 seconds
}

// create a session ID
async function createSessionId() {
  activeSession.id = uuidv4();
  // activeSession.sessionStart = Date.now();

  console.log("activeSession.sessionId", activeSession.id);
  console.log("inside the createSessionId function");

  const { supabaseAccessToken, supabaseExpiration, userId } =
    await getSupabaseKeys();
  validateToken(supabaseAccessToken, supabaseExpiration);
  await startSessionUpload(supabaseAccessToken, userId);
}

// timer needs to start once the service worker is loaded
resetInactivityTimeout();

// upload the start session
async function startSessionUpload(supabaseAccessToken, userId) {
  const SUPABASE_URL_ =
    "https://veedcagxcbafijuaremr.supabase.co/rest/v1/browsingSessions";

  const randomId = uuidv4();
  activeSession.id = randomId;
  activeSession.user_id = userId;

  console.log("inside startSessionUpload");
  console.log("activeSession contents", activeSession);

  const response = await fetch(SUPABASE_URL_, {
    method: "POST",
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(activeSession),
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(`HTTP error! status: ${response.status}`);
  }
}

// upload the end session time
async function endSessionUpload() {
  const { supabaseAccessToken, supabaseExpiration } = await getSupabaseKeys();
  validateToken(supabaseAccessToken, supabaseExpiration);

  const sessionId = activeSession.id; // Get the ID of the session to update
  const SUPABASE_URL_ = `https://veedcagxcbafijuaremr.supabase.co/rest/v1/browsingSessions?id=eq.${sessionId}`; // Use a horizontal filter in the URL

  const response = await fetch(SUPABASE_URL_, {
    method: "PATCH", // Change method to PATCH for updating
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ endTime: Date.now() }), // Update endTime to the current timestamp
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(`HTTP error! status: ${response.status}`);
  }
}

// get the supabase keys
async function getSupabaseKeys() {
  const supabaseAccessToken = await getKeyFromStorage(
    chromeStorageKeys.supabaseAccessToken
  );
  const supabaseExpiration = (await getKeyFromStorage(
    chromeStorageKeys.supabaseExpiration
  )) as number;
  const userId = await getKeyFromStorage(chromeStorageKeys.supabaseUserId);

  return { supabaseAccessToken, supabaseExpiration, userId };
}

// validate the token
function validateToken(supabaseAccessToken, supabaseExpiration) {
  const currentTime = Math.floor(Date.now() / 1000);
  if (!supabaseAccessToken) {
    throw new Error("No Supabase access token found");
  }
  if (currentTime > supabaseExpiration) {
    handleMessage({ action: "refresh", value: null }, console.log);
    throw new Error("Supabase access token is expired");
  }
}

// upload the objectToPush2 object
async function uploadHistory(supabaseAccessToken, userId, objectToPush2) {
  const SUPABASE_URL_ =
    "https://veedcagxcbafijuaremr.supabase.co/rest/v1/historyItems";

  objectToPush2.user_id = userId;
  objectToPush2.id = uuidv4();

  const response = await fetch(SUPABASE_URL_, {
    method: "POST",
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(objectToPush2),
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(`HTTP error! status: ${response.status}`);
  }
}

// get the favicon url
function getFaviconUrl(url, size = 64) {
  try {
    // Extract the domain from the input URL using regex
    const regex = /^(?:https?:\/\/)?(?:www\.)?([^\/]+)/i;
    const match = url.match(regex);
    const domain = match && match[1];

    if (!domain) {
      console.error("Error processing URL:", url);
      return null;
    }

    // Build the Google Favicon Downloader API URL
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;

    return faviconUrl;
  } catch (error) {
    console.error("Error processing URL:", error);
    return null;
  }
}

type TransitionType =
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

interface VisitItem {
  id: string;
  referringVisitId: string;
  transition: TransitionType;
  visitId: string;
  visitTime?: number;
}

type HistoryItem = {
  id: string;
  lastVisitTime?: number;
  title?: string;
  typedCount: number;
  url?: string;
  visitCount: number;
};

// make the async chrome.tabs.query function return a promise
function promisify(func) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      func(...args, function (response) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  };
}

// query the tab with the historyItem
async function historyTabQuery(historyUrl, objectToPush2) {
  const tabs = await promisify(chrome.tabs.query)({ url: historyUrl });
  console.log("tabs", tabs);
  if (tabs[0] != undefined) {
    console.log("historyTabsQuery", tabs);
    objectToPush2.tabId = tabs[0].id;
    objectToPush2.tabWindowId = tabs[0].windowId;
    objectToPush2.tabStatus = tabs[0].status;
    objectToPush2.tabFaviconUrl = tabs[0].favIconUrl;
  }
  return tabs;
}

// query the active tab
async function activeTabQuery(objectToPush2) {
  const tabs = await promisify(chrome.tabs.query)({
    active: true,
    lastFocusedWindow: true,
    highlighted: true,
  });
  if (tabs[0] != undefined) {
    console.log("activeTab info", tabs[0]);
    objectToPush2.activeTabId = tabs[0].id;
    objectToPush2.activeTabWindowId = tabs[0].windowId;
  }
  return tabs;
}

// query the visitItems of the historyItem
async function getVisitsQuery(historyItem: HistoryItem, objectToPush2) {
  const visitItems = (await promisify(chrome.history.getVisits)({
    url: historyItem.url,
  })) as VisitItem[];

  const tolerance = 1000;

  const filteredItems = visitItems.filter(
    (visitItem) =>
      Math.abs(visitItem.visitTime - historyItem.lastVisitTime) <= tolerance &&
      visitItem.id == historyItem.id
  );

  // If there is at least one item
  if (filteredItems.length > 0) {
    // Look for a non-"link" item
    const nonLinkItem = filteredItems.find(
      (item) => item.transition !== "link"
    );

    // If a non-"link" item is found, use its transition type
    if (nonLinkItem) {
      objectToPush2.transitionType = nonLinkItem.transition;
      // console.log("filteredItems[0]", nonLinkItem);
    }
    // If no non-"link" item is found, but there are other items, use the transition type of the first item
    else if (filteredItems[0].transition === "link") {
      objectToPush2.transitionType = filteredItems[0].transition;
      // console.log("filteredItems[0]", filteredItems[0]);
    }
  }

  return objectToPush2.transitionType;
}

// new attempt at history listener - now WORKING
chrome.history.onVisited.addListener(async function (historyItem: HistoryItem) {
  const objectToPush2 = {
    id: null,
    url: null,
    node: null,
    link: null,
    activeTabId: null,
    activeTabWindowId: null,
    title: null,
    tabFaviconUrl: null,
    tabWindowId: null,
    tabId: null,
    tabStatus: null,
    user_id: null,
    time: null,
    transitionType: null,
    linkTransition: null,
  };

  isActiveSessionChecker(historyItem);

  objectToPush2.url = historyItem.url;
  objectToPush2.title = historyItem.title;
  objectToPush2.time = historyItem.lastVisitTime;

  /* await historyTabQuery(historyItem.url, objectToPush2);
  await activeTabQuery(objectToPush2);
  await getVisitsQuery(historyItem, objectToPush2);

  if (
    objectToPush2.tabFaviconUrl == "" ||
    objectToPush2.tabFaviconUrl == null ||
    objectToPush2.tabFaviconUrl == undefined
  ) {
    objectToPush2.tabFaviconUrl = getFaviconUrl(objectToPush2.url);
  }

  if (
    objectToPush2.transitionType == "link" &&
    objectToPush2.activeTabId != objectToPush2.tabId &&
    objectToPush2.tabWindowId == objectToPush2.activeTabWindowId
  ) {
    objectToPush2.linkTransition = "newTab";
  }

  if (objectToPush2.activeTabId == objectToPush2.tabId) {
    objectToPush2.linkTransition = "sameTab";
  } */

  try {
    // Call all three asynchronous functions simultaneously
    await Promise.all([
      historyTabQuery(historyItem.url, objectToPush2),
      activeTabQuery(objectToPush2),
      getVisitsQuery(historyItem, objectToPush2),
    ]);

    if (
      objectToPush2.tabFaviconUrl == "" ||
      objectToPush2.tabFaviconUrl == null ||
      objectToPush2.tabFaviconUrl == undefined
    ) {
      objectToPush2.tabFaviconUrl = getFaviconUrl(objectToPush2.url);
    }

    if (
      objectToPush2.transitionType == "link" &&
      objectToPush2.activeTabId != objectToPush2.tabId &&
      objectToPush2.tabWindowId == objectToPush2.activeTabWindowId
    ) {
      objectToPush2.linkTransition = "newTab";
    }

    if (objectToPush2.activeTabId == objectToPush2.tabId) {
      objectToPush2.linkTransition = "sameTab";
    }

    // Call the Supabase upload function here
    const { supabaseAccessToken, supabaseExpiration, userId } =
      await getSupabaseKeys();
    validateToken(supabaseAccessToken, supabaseExpiration);
    await uploadHistory(supabaseAccessToken, userId, objectToPush2);

    // Call the supabase uploader function here
    // supabaseUploader(objectToPush2);
  } catch (error) {
    // Handle any errors that occurred in any of the promises
    console.error(error);
  }
});
