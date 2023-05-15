// import browser from "webextension-polyfill";
import supabase from "./lib/supabase-client";
import { v4 as uuidv4 } from "uuid";

/* ------------------------------------------------------------------------- */

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

/* ---------------------------------------------------------------------- */

// init the sessions
let activeSession = { sessionStart: null, sessionEnd: null, sessionId: null };
let isSessionActive = false;
let inactivityTimeout;

// listening to content script to restart timer
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "userActive") {
    resetInactivityTimeout();
  }
});

// reset active session
function resetActiveSession() {
  activeSession = { sessionStart: null, sessionEnd: null, sessionId: null };
}

// check for active session
function isActiveSessionChecker(historyItem) {
  if (!isSessionActive) {
    console.log("session started");
    resetActiveSession();
    activeSession.sessionStart = historyItem.lastVisitTime;
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
      activeSession.sessionEnd = Date.now();
      endSession();
    }
  }, 10000); // 120 seconds - 2 minutes but currently set to 10 seconds for testing
}

// not sure what this code is supposed to do
/* async function endSession() {
  const SUPABASE_URL_ =
    "https://veedcagxcbafijuaremr.supabase.co/rest/v1/historySessions";

  const supabaseAccessUserId = await getKeyFromStorage(
    chromeStorageKeys.supabaseUserId
  );

  const supabaseAccessToken = await getKeyFromStorage(
    chromeStorageKeys.supabaseAccessToken
  );

  //we need to create code for adding this document to browsing sessions table

  try {
    // the actual upload commencing
    const response = await fetch(SUPABASE_URL_, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${supabaseAccessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        sessionId: "",
        sessionStart: "",
        sessionEnd: "",
      }),
    });

    if (!response.ok) {
      const errorResponse = await response.json();
      console.error("Error response:", errorResponse);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log("URL uploaded successfully:", sessionId);
  } catch (error) {
    console.error("Error uploading URL:", error.message);
  }
} */

// create a session ID
function createSessionId() {
  activeSession.sessionId = uuidv4();
  console.log("activeSession.sessionId", activeSession.sessionId);
}

resetInactivityTimeout();

//mass console logger function
function massConsoleLogger() {
  console.log("visitItemList", visitItemList);
  console.log("historyItemList", historyItemList);
  console.log("activeTabList", activeTabItemList);
  console.log("tabItemList", tabItemList);
}

/* -------------------------------------------------------------------------------------- */
// the actual uploading of the history item to the database

//uploading URL basic version - WORKS
/* chrome.history.onVisited.addListener(async function (historyItem) {
  console.log("historyItem inside");

  const SUPABASE_URL_ =
    "https://veedcagxcbafijuaremr.supabase.co/rest/v1/historyItems";

  try {
    // wait and await for the access tokens
    const supabaseAccessToken = await getKeyFromStorage(
      chromeStorageKeys.supabaseAccessToken
    );

    const supabaseExpiration = (await getKeyFromStorage(
      chromeStorageKeys.supabaseExpiration
    )) as number;

    const userId = await getKeyFromStorage(chromeStorageKeys.supabaseUserId);

    // check if there's not access token
    if (!supabaseAccessToken) {
      console.error("No Supabase access token found");
      return;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    console.log("currentTime", currentTime);
    console.log("supabaseExpiration", supabaseExpiration);

    // Check if the token is expired
    if (currentTime > supabaseExpiration) {
      console.log("Supabase access token is expired");
      console.log("accessToken checker", supabaseAccessToken);
      // Here you can call the "refresh" action or redirect the user to login
      // For example:
      handleMessage({ action: "refresh", value: null }, console.log);
      return;
    }

    const randomId = uuidv4();
    console.log(userId);

    // the actual upload commencing
    const response = await fetch(SUPABASE_URL_, {
      method: "POST",
      headers: {
        apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${supabaseAccessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        url: historyItem.url,
        id: randomId,
        user_id: userId,
      }),
    });

    if (!response.ok) {
      const errorResponse = await response.json();
      console.error("Error response:", errorResponse);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log("URL uploaded successfully:", historyItem.url);
  } catch (error) {
    console.error("Error uploading URL:", error.message);
  }
}); */

/* async function supabaseUploader() {
  const SUPABASE_URL_ =
    "https://veedcagxcbafijuaremr.supabase.co/rest/v1/historyItems";

  try {
    // wait and await for the access tokens
    const supabaseAccessToken = await getKeyFromStorage(
      chromeStorageKeys.supabaseAccessToken
    );

    const supabaseExpiration = (await getKeyFromStorage(
      chromeStorageKeys.supabaseExpiration
    )) as number;

    const userId = await getKeyFromStorage(chromeStorageKeys.supabaseUserId);

    // check if there's not access token
    if (!supabaseAccessToken) {
      console.error("No Supabase access token found");
      return;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    console.log("currentTime", currentTime);
    console.log("supabaseExpiration", supabaseExpiration);

    // Check if the token is expired
    if (currentTime > supabaseExpiration) {
      console.log("Supabase access token is expired");
      console.log("accessToken checker", supabaseAccessToken);
      // Here you can call the "refresh" action or redirect the user to login
      // For example:
      handleMessage({ action: "refresh", value: null }, console.log);
      return;
    }

    const randomId = uuidv4();
    console.log(userId);

    // the actual upload commencing
    const response = await fetch(SUPABASE_URL_, {
      method: "POST",
      headers: {
        apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${supabaseAccessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        url: historyItem.url,
        id: randomId,
        user_id: userId,
      }),
    });

    if (!response.ok) {
      const errorResponse = await response.json();
      console.error("Error response:", errorResponse);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log("URL uploaded successfully:", historyItem.url);
  } catch (error) {
    console.error("Error uploading URL:", error.message);
  }
} */

/* ------------------------------------------------------------------------------------------------- */

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

async function uploadHistory(historyItem, supabaseAccessToken, userId) {
  const randomId = uuidv4();
  const response = await fetch(SUPABASE_URL_, {
    method: "POST",
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      url: historyItem.url,
      id: randomId,
      user_id: userId,
    }),
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(`HTTP error! status: ${response.status}`);
  }
}

function handleError(error) {
  console.error("Error occurred:", error.message);
}

// modular update example that worked
/* chrome.history.onVisited.addListener(async function (historyItem) {
  try {
    console.log("historyItem inside");

    const { supabaseAccessToken, supabaseExpiration, userId } =
      await getSupabaseKeys();
    validateToken(supabaseAccessToken, supabaseExpiration);
    await uploadHistory(historyItem, supabaseAccessToken, userId);

    console.log("URL uploaded successfully:", historyItem.url);
  } catch (error) {
    handleError(error);
  }
}); */

/* ---------------------------------------------------------------------------------------------------- */

function createDocData(objectToPush) {
  const tempHistoryItemList = [];
  const tempVisitItemList = [];
  const tempTabItemList = [];
  const tempActiveTabItemList = [];

  let historyObjectDocRef;
  let historyObjectDocId;
  let tabFaviconUrl;
  let activeTabId;
  let tabId;

  let historyItemUrl;

  // function massConsoleLogger2() {
  //   console.log("activeTabId", activeTabId)
  //   console.log("tabId", tabId)
  //   console.log("tabFaviconUrl", tabFaviconUrl)
  //   console.log("historyItemUrl", historyItemUrl)
  // }

  // console.log("tempActiveTabItemList[0].id 1", tempActiveTabItemList[0].id)
  // console.log("tempTabItemList[0].id 1", tempTabItemList[0].id)

  objectToPush.map((obj) => {
    if (obj.type === "historyItem") {
      tempHistoryItemList.push(obj);
    } else if (obj.type === "visitItem") {
      tempVisitItemList.push(obj);
    } else if (obj.type === "tabItem") {
      tempTabItemList.push(obj);
    } else if (obj.type === "activeTabItem") {
      tempActiveTabItemList.push(obj);
    }
  });

  tabFaviconUrl = null;
  let linkTransition = null;
  let node = null;
  let timeToExport;

  // console.log("tempActiveTabList", tempActiveTabItemList)
  // console.log("tempActiveTabItemList[0].id 2", tempActiveTabItemList[0].id)
  // console.log("tempTabItemList[0].id 2", tempTabItemList[0].id)

  function docGenerator(linkTransition, node) {
    if (tempActiveTabItemList[0].id != tempTabItemList[0].id) {
      console.log("newTab inscriber");
      linkTransition = "newTab";
    }

    if (
      typeof tempTabItemList[0].favIconUrl === "string" &&
      tempTabItemList[0].favIconUrl != ""
    ) {
      console.log("typeChecker for favIcon");
      // node = { id: null, img: tempTabItemList[0].favIconUrl };
      tabFaviconUrl = tempTabItemList[0].favIconUrl;
      console.log("first node function", node);
    }

    if (
      tempTabItemList[0].favIconUrl == "" ||
      tempTabItemList[0].favIconUrl == null ||
      tempTabItemList[0].favIconUrl == undefined
    ) {
      console.log("undefined checker for favIconUrl");
      // node = {id: null, img: getFaviconUrl(tempHistoryItemList[0].url)}
      tabFaviconUrl = getFaviconUrl(tempHistoryItemList[0].url);
      console.log("second Node function", node);
    }

    timeToExport = Date.now();

    return {
      time: timeToExport,
      transitionType: tempVisitItemList[0].transition,
      linkTransition: linkTransition,
      node: null,
      link: null,
      activeTabId: tempActiveTabItemList[0].id,
      activeTabWindowId: tempActiveTabItemList[0].windowId,
      tabId: tempTabItemList[0].id,
      tabStatus: tempTabItemList[0].status,
      tabWindowId: tempTabItemList[0].windowId,
      url: tempHistoryItemList[0].url,
      title: tempHistoryItemList[0].title,
      tabFaviconUrl: tabFaviconUrl,
      activeSession: activeSession,
    };
  }
}

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

async function supabaseUploader(objectToPush) {
  // console.log("tempActiveTabList", tempActiveTabItemList)
  // console.log("tempActiveTabItemList[0].id 2", tempActiveTabItemList[0].id)
  // console.log("tempTabItemList[0].id 2", tempTabItemList[0].id)

  function docGenerator(objectToPush) {
    // temp list initialization
    const tempHistoryItemList = [];
    const tempVisitItemList = [];
    const tempTabItemList = [];
    const tempActiveTabItemList = [];

    // other varialbe inits
    let tabFaviconUrl;
    let linkTransition = null;
    let timeToExport;
    tabFaviconUrl = null;

    objectToPush.map((obj) => {
      if (obj.type === "historyItem") {
        tempHistoryItemList.push(obj);
      } else if (obj.type === "visitItem") {
        tempVisitItemList.push(obj);
      } else if (obj.type === "tabItem") {
        tempTabItemList.push(obj);
      } else if (obj.type === "activeTabItem") {
        tempActiveTabItemList.push(obj);
      }
    });

    /* if (tempActiveTabItemList[0].id != tempTabItemList[0].id) {
      console.log("newTab inscriber");
      linkTransition = "newTab";
    } */

    /* if (
      typeof tempTabItemList[0].favIconUrl === "string" &&
      tempTabItemList[0].favIconUrl != ""
    ) {
      console.log("typeChecker for favIcon");
      // node = { id: null, img: tempTabItemList[0].favIconUrl };
      tabFaviconUrl = tempTabItemList[0].favIconUrl;
    } */

    /* if (
      tempTabItemList[0].favIconUrl == "" ||
      tempTabItemList[0].favIconUrl == null ||
      tempTabItemList[0].favIconUrl == undefined
    ) {
      console.log("undefined checker for favIconUrl");
      // node = {id: null, img: getFaviconUrl(tempHistoryItemList[0].url)}
      tabFaviconUrl = getFaviconUrl(tempHistoryItemList[0].url);
    } */

    console.log("tempActiveTabItemList", tempActiveTabItemList);
    console.log("tempTabItemList", tempTabItemList);
    console.log("tempHistoryItemList", tempHistoryItemList);
    console.log("tempVisitItemList", tempVisitItemList);

    return {
      transitionType: tempVisitItemList[0].transition,
      activeTabId: tempActiveTabItemList[0].id,
      url: tempHistoryItemList[0].url,
      title: tempHistoryItemList[0].title,
    };
  }

  /* const createDoc = (objectToPush) => {
    // Decompose objectToPush into respective categories
    const tempHistoryItemList = objectToPush.filter(
      (obj) => obj.type === "historyItem"
    );
    const tempVisitItemList = objectToPush.filter(
      (obj) => obj.type === "visitItem"
    );
    const tempTabItemList = objectToPush.filter(
      (obj) => obj.type === "tabItem"
    );
    const tempActiveTabItemList = objectToPush.filter(
      (obj) => obj.type === "activeTabItem"
    );

    // Default values
    let linkTransition = null;
    let tabFaviconUrl = null;
    let activeSession = null;
    let count = tempHistoryItemList.length;

    if (tempActiveTabItemList[0].id !== tempTabItemList[0].id) {
      linkTransition = "newTab";
    }

    if (
      typeof tempTabItemList[0]?.favIconUrl === "string" &&
      tempTabItemList[0]?.favIconUrl !== ""
    ) {
      tabFaviconUrl = tempTabItemList[0].favIconUrl;
    } else {
      tabFaviconUrl = getFaviconUrl(tempHistoryItemList[0]?.url);
    }

    return {
      userUID: userId,
      count: count,
      transitionType: tempVisitItemList[0]?.transition,
      linkTransition: linkTransition,
      node: null,
      link: null,
      activeTabId: tempActiveTabItemList[0]?.id,
      activeTabWindowId: tempActiveTabItemList[0]?.windowId,
      tabId: tempTabItemList[0]?.id,
      tabStatus: tempTabItemList[0]?.status,
      tabWindowId: tempTabItemList[0]?.windowId,
      url: tempHistoryItemList[0]?.url,
      title: tempHistoryItemList[0]?.title,
      tabFaviconUrl: tabFaviconUrl,
      activeSession: activeSession,
    };
  }; */

  /* try {
    console.log("historyItem inside");

    const { supabaseAccessToken, supabaseExpiration, userId } =
      await getSupabaseKeys();
    validateToken(supabaseAccessToken, supabaseExpiration);
    await uploadHistory(historyItem, supabaseAccessToken, userId);
  } catch (error) {
    handleError(error);
  } */

  async function uploadFunction(objectToPush) {
    const SUPABASE_URL_ =
      "https://veedcagxcbafijuaremr.supabase.co/rest/v1/historyItems";

    const { supabaseAccessToken, supabaseExpiration, userId } =
      await getSupabaseKeys();
    validateToken(supabaseAccessToken, supabaseExpiration);

    const data = docGenerator(objectToPush);
    console.log("data", data);

    // Add user_id to the data object
    if (userId) {
      Object.assign(data, { user_id: userId });
    }

    const randomId = uuidv4();
    if (randomId) {
      Object.assign(data, { id: randomId });
    }

    const response = await fetch(SUPABASE_URL_, {
      method: "POST",
      headers: {
        apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${supabaseAccessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorResponse = await response.json();
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  }

  uploadFunction(objectToPush);
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */

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

const objectToPush2 = {
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

async function historyTabQuery(historyUrl) {
  const tabs = await promisify(chrome.tabs.query)({ url: historyUrl });
  console.log("tabs", tabs);
  if (tabs[0] != undefined) {
    objectToPush2.tabId = tabs[0].id;
    objectToPush2.tabWindowId = tabs[0].windowId;
    objectToPush2.tabStatus = tabs[0].status;
  }
  return tabs;
}

async function activeTabQuery() {
  const tabs = await promisify(chrome.tabs.query)({
    active: true,
    lastFocusedWindow: true,
  });
  if (tabs[0] != undefined) {
    objectToPush2.activeTabId = tabs[0].id;
    objectToPush2.activeTabWindowId = tabs[0].windowId;
  }
  return tabs;
}

async function getVisitsQuery(historyItem: HistoryItem) {
  const visitItems = (await promisify(chrome.history.getVisits)({
    url: historyItem.url,
  })) as VisitItem[];

  // Apply the filter
  const filteredItems = visitItems.filter(
    (visitItem) =>
      visitItem.visitTime &&
      visitItem.visitTime >= historyItem.lastVisitTime &&
      visitItem.id == historyItem.id
  );

  // If there is at least one item, get the transitionType of the first item
  if (filteredItems.length > 0) {
    objectToPush2.transitionType = filteredItems[0].transition;
  }

  return objectToPush2.transitionType;
}

// new attempt at history listener
chrome.history.onVisited.addListener(async function (historyItem: HistoryItem) {
  objectToPush2.url = historyItem.url;
  objectToPush2.title = historyItem.title;
  objectToPush2.time = historyItem.lastVisitTime;

  try {
    // Call all three asynchronous functions simultaneously
    await Promise.all([
      historyTabQuery(historyItem.url),
      activeTabQuery(),
      getVisitsQuery(historyItem),
    ]);

    console.log("objectToPush2", objectToPush2);
    // Call the supabase uploader function here
    // supabaseUploader(objectToPush2);
  } catch (error) {
    // Handle any errors that occurred in any of the promises
    console.error(error);
  }
});

chrome.history.onVisited.addListener(function (historyItem: HistoryItem) {
  console.log(historyItem);
  console.log(historyItem.url);
  chrome.tabs.query(
    { url: historyItem.url },
    //query the tabItem
    function (tab) {
      console.log("tab", tab);
    }
  );
});
