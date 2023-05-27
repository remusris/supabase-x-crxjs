// import browser from "webextension-polyfill";
import supabase from "./lib/supabase-client";
import { v4 as uuidv4 } from "uuid";
import {
  VisitItem,
  HistoryItem,
  objectToPush,
  Tab,
  Message,
  ResponseCallback,
} from "./types";

// init variables, loadBalancer for storing historyItems, uploadTimeout for the setTimeout function
let loadBalancer = [];
let uploadTimeout = null;

// more basic implementation of an activeUser
let isUserActive = false;

// activated tab init
const activatedTab = {
  info: null,
  tabId: null,
  lastQueryTime: null,
};

// highlighted tab init
const highlightedTab = {
  info: null,
  tabId: null,
  lastQueryTime: null,
};

// init the sessions -- this is created within the createSession function instead
/* let activeSession = {
  startTime: null,
  endTime: null,
  id: null,
  user_id: null,
}; */

// Create a queue for handling HistoryItems
const historyItemQueue = [];
let isProcessing = false;

// init chrome storage keys
const chromeStorageKeys = {
  supabaseAccessToken: "supabaseAccessToken",
  supabaseRefreshToken: "supabaseRefreshToken",
  supabaseUserData: "supabaseUserData",
  supabaseExpiration: "supabaseExpiration",
  supabaseUserId: "supabaseUserId",
};

// end of variable inits
/* ---------------------------------------------------------------------------------------------------------------------------------------------------------------- */

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
    // console.log("token expiration", data.session.expires_at);
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
      console.log("failed login attempt", error);
      // response({ data: null, error: "No active session" }); -- this is the old response
      response({ data: null, error: error });
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

      // If error exists, return it immediately
      if (error) {
        response({ data: null, error: error.message });
        return;
      }

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

//@ts-ignore - essential code below - messaging from popup script
chrome.runtime.onMessage.addListener((msg, sender, response) => {
  handleMessage(msg, response);
  return true;
});

// this is polling sever function
async function updateServer() {
  if (isUserActive) {
    //function to update endSessionTime to server -- this will have to be deleted
    console.log("updateServer function is called");

    const currentTime = Date.now();
    getLastActiveSession(currentTime);

    isUserActive = false;
  } else {
    console.log("user is not active in the last minute");
  }
}

// this is polling for checking the active session
setInterval(updateServer, 60000);

// listening to content script to restart timer
chrome.runtime.onMessage.addListener(function (message) {
  if (message.type === "userActive") {
    // this is the old way of doing it
    // resetInactivityTimeout();

    // now when the interval is triggered, we check the server for the last session
    isUserActive = true;
  }
});

// reset active session -- still needed and used -- not needed anymore
/* function resetActiveSession() {
  activeSession = {
    startTime: null,
    endTime: null,
    id: null,
    user_id: null,
  };
} */

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
  // objectToPush2.id = uuidv4();

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
    throw new Error(
      `HTTP error! status: ${response.status}, message: ${errorResponse.message}`
    );
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

// modified promisify function that scares me
function promisify<T, A extends any[]>(
  func: (...args: [...A, (response: T) => void]) => void
): (...args: A) => Promise<T> {
  return function (...args: A) {
    return new Promise<T>((resolve, reject) => {
      func(...args, function (response: T) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  };
}

// query the tab with the historyItem -- with try/catch block
async function historyTabQuery(
  historyUrl: string,
  objectToPush2: objectToPush
) {
  try {
    const tabs = await promisify<Tab[], [{ url: string }]>(chrome.tabs.query)({
      url: historyUrl,
    });
    console.log("tabs", tabs);
    if (tabs.length > 0) {
      console.log("historyTabsQuery", tabs);
      objectToPush2.tabId = tabs[0].id;
      objectToPush2.tabWindowId = tabs[0].windowId;
      objectToPush2.tabStatus = tabs[0].status;
      objectToPush2.tabFaviconUrl = tabs[0].favIconUrl;
    }
    return tabs;
  } catch (error) {
    console.error(`Error querying tab: ${error.message}`);
  }
}

// query the number of tabs in the tabWindowId -- with try/catch block
async function windowLengthQuery(
  windowId: number,
  objectToPush2: objectToPush
) {
  try {
    const windowTabs = await promisify<Tab[], [{ windowId: number }]>(
      chrome.tabs.query
    )({ windowId: windowId });

    console.log("window", windowTabs);
    console.log("windowLength", windowTabs.length);

    if (windowTabs.length > 0) {
      const windowLength = windowTabs.length;
      console.log("windowLength", windowLength);
      objectToPush2.tabWindowLength = windowLength;
    } else {
      console.error(`No window found with ID ${windowId}`);
    }
  } catch (error) {
    console.error(`Error querying window length: ${error.message}`);
  }
}

// query the active tab with try/catch block
async function activeTabQuery(objectToPush2: objectToPush) {
  try {
    const tabs = await promisify<
      Tab[],
      [{ active: boolean; lastFocusedWindow: boolean; highlighted: boolean }]
    >(chrome.tabs.query)({
      active: true,
      lastFocusedWindow: true,
      highlighted: true,
    });

    if (tabs.length > 0) {
      console.log("activeTab info with highlighted true", tabs[0]);
      objectToPush2.activeTabId = tabs[0].id;
      objectToPush2.activeTabWindowId = tabs[0].windowId;
    }
    return tabs;
  } catch (error) {
    console.error(`Error querying active tab: ${error.message}`);
  }
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

// NEW VERSION w/ queue
chrome.history.onVisited.addListener(async function (historyItem: HistoryItem) {
  // Instead of processing the HistoryItem immediately, add it to the queue
  historyItemQueue.push(historyItem);

  // If we're not currently processing any HistoryItems, start processing
  if (!isProcessing) {
    processHistoryItemQueue();
  }
});

// ESSENTIALLY THE NEW CHROME.HISTORY.ONVISITED FUNCTION
// a que function to prevent race conditions on each of the historyItems
async function processHistoryItemQueue() {
  if (historyItemQueue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;

  // Dequeue the next HistoryItem
  const historyItem = historyItemQueue.shift();

  try {
    const objectToPush2 = {
      id: null,
      url: null,
      user_id: null,
      url_id: null,
      domain_id: null,
      activeTabId: null,
      title: null,
      transitionType: null,
      activeTabWindowId: null,
      linkTransition: null,
      tabFaviconUrl: null,
      tabId: null,
      tabStatus: null,
      tabWindowId: null,
      tabWindowLength: null,
      time: null,
      session_id: null,
      activatedTab: { lastQueryTime: null, url: null },
      highlightedTab: { lastQueryTime: null, url: null },
      link: { source: null, target: null },
      node: null,
    };

    // get the last activeSession from the server
    const session_id = await getLastActiveSession(historyItem.lastVisitTime);

    objectToPush2.url = historyItem.url;
    objectToPush2.title = historyItem.title;
    objectToPush2.time = historyItem.lastVisitTime;
    objectToPush2.id = uuidv4();

    //adding the sessionId that should have been grabbed from getLastActiveSession()
    objectToPush2.session_id = session_id;

    // Call all three asynchronous functions simultaneously -- w/out retry
    /* await Promise.all([
      historyTabQuery(historyItem.url, objectToPush2),
      activeTabQuery(objectToPush2),
      getVisitsQuery(historyItem, objectToPush2),
    ]); */

    await Promise.all([
      retry(() => historyTabQuery(historyItem.url, objectToPush2)),
      retry(() => activeTabQuery(objectToPush2)),
      retry(() => getVisitsQuery(historyItem, objectToPush2)),
    ]);

    if (objectToPush2.tabWindowId != undefined || null) {
      await windowLengthQuery(objectToPush2.tabWindowId, objectToPush2);
    }

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
      objectToPush2.linkTransition = "openInNewTab";
    }

    if (objectToPush2.activeTabId == objectToPush2.tabId) {
      objectToPush2.linkTransition = "sameTab";
    }

    if (objectToPush2.transitionType == "typed") {
      objectToPush2.linkTransition = "sameTab";
    }

    console.log("before queryByTimeTabIdAndWindowId");

    const { supabaseAccessToken, supabaseExpiration } = await getSupabaseKeys();
    validateToken(supabaseAccessToken, supabaseExpiration);
    await queryByTimeTabIdAndWindowId(
      supabaseAccessToken,
      objectToPush2.time,
      highlightedTab.tabId,
      objectToPush2,
      objectToPush2.tabWindowId
    );

    if (
      objectToPush2.linkTransition == "openInNewTab" &&
      objectToPush2.tabWindowId != null
    ) {
      await newTabLinkAppend(
        objectToPush2.time,
        objectToPush2,
        objectToPush2.tabWindowId
      );
    }

    console.log("after queryByTimeTabIdAndWindowId");
    console.log("objectToPush2", objectToPush2);

    // processURL function to deal with duplicate and replicate URLs
    await processURL(objectToPush2);

    //this will likely be deleted
    // await queryHistoryItem(objectToPush2.time, supabaseAccessToken);

    // we update the activated tab after the activatedTab data gets pushed
    await updateActivatedTab();
    //we update the highlighted tab after the highlightedTab data gets pushed
    await updateHighlightedTab();
  } catch (error) {
    // Handle any errors that occurred in any of the promises
    console.error(error);
  }

  // Once you've finished processing the HistoryItem, recursively call this function again
  await processHistoryItemQueue();
}

// retry function in case there are any errors that emerge
async function retry(fn, retriesLeft = 5, interval = 500) {
  try {
    const result = await fn();
    return result;
  } catch (error) {
    if (retriesLeft) {
      // Wait for the specified interval, then retry
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(retry(fn, retriesLeft - 1, interval));
        }, interval);
      });
    } else {
      // If no retries left, throw the error
      throw error;
    }
  }
}

// processURL function
async function processURL(urlObject) {
  // push the new URL onto the loadBalancer array
  loadBalancer.push(urlObject);
  console.log("loadBalancer", loadBalancer);

  const uploadDelay = 1500;

  // remove any consecutive duplicate URLs
  await removeConsecutiveDuplicates(loadBalancer);

  // Apply appendIdsToEntry to each element in loadBalancer array
  // await Promise.all(loadBalancer.map((entry) => appendIdsToEntry(entry)));
  await appendIdsToEntry(loadBalancer);

  // if there isn't already a timeout running, start one
  if (!uploadTimeout) {
    uploadTimeout = setTimeout(function () {
      // upload the URLs and clear the array
      uploadAll(loadBalancer);

      loadBalancer = [];
      // clear the timeout
      uploadTimeout = null;
    }, uploadDelay);
  }
}

// new version that hopefully should work
function normalizeURL(url) {
  if (!url) {
    return url;
  }

  const urlObj = new URL(url);
  let normalizedURL = urlObj.hostname + urlObj.pathname;

  // Include the search parameters and hash fragment if they exist
  if (urlObj.search) {
    normalizedURL += urlObj.search;
  }
  if (urlObj.hash) {
    normalizedURL += urlObj.hash;
  }

  // Remove 'www.' prefix if exists
  normalizedURL = normalizedURL.replace(/^www\./, "");

  console.log("normalizedURL", normalizedURL);

  return normalizedURL;
}

// strip URL of 'www.' prefix and trailing slash
function normalizeDomain(url) {
  if (!url) {
    return url;
  }

  const urlObj = new URL(url);
  let normalizedDomain = urlObj.hostname;

  // Remove 'www.' prefix if exists
  normalizedDomain = normalizedDomain.replace(/^www\./, "");

  console.log("inside the normalizedDomain function", normalizedDomain);

  return normalizedDomain;
}

// remove any consecutive duplicate URLs -- NEW VERSION
async function removeConsecutiveDuplicates(loadBalancer) {
  let i = 0;
  while (i < loadBalancer.length - 1) {
    const currentURL = normalizeURL(loadBalancer[i].url);
    const nextURL = normalizeURL(loadBalancer[i + 1].url);
    console.log("currentURL", currentURL);
    console.log("nextURL", nextURL);
    console.log("loadBalancer[i].tabId", loadBalancer[i].tabId);
    console.log("loadBalancer[i + 1].tabId", loadBalancer[i + 1].tabId);

    // Remove if transitionType is 'form_submit'
    if (loadBalancer[i].transitionType === "form_submit") {
      loadBalancer.splice(i, 1);
      console.log("Removed URL with form_submit transitionType");
    }

    // remove if there's no tabId or tabWindowId
    if (!loadBalancer[i].tabId || !loadBalancer[i].tabWindowId) {
      loadBalancer.splice(i, 1);
      console.log("removed entry with null tabId and or null activeTabId");
    }

    if (currentURL === nextURL) {
      console.log("inside the equal URLs if statement");
      if (!loadBalancer[i].tabId) {
        console.log("loadBalancer[i].tabId", loadBalancer[i].tabId);
        loadBalancer.splice(i, 1); // remove this item if it has null tabId
        console.log("first item as null splice");
      } else if (!loadBalancer[i + 1].tabId) {
        console.log("loadBalancer[i + 1].tabId", loadBalancer[i + 1].tabId);
        loadBalancer.splice(i + 1, 1); // remove the next item if it has null tabId
        console.log("second item as null splice");
      } else if (
        loadBalancer[i].tabId === loadBalancer[i + 1].tabId &&
        loadBalancer[i].windowId === loadBalancer[i + 1].windowId
      ) {
        if (
          loadBalancer[i].transitionType === "link" &&
          loadBalancer[i + 1].transitionType !== "link"
        ) {
          loadBalancer.splice(i, 1); // remove this item, it's the same as the next one and it has transition type 'link'
          console.log("loadBalancer first splice", loadBalancer);
        } else if (
          loadBalancer[i + 1].transitionType === "link" &&
          loadBalancer[i].transitionType !== "link"
        ) {
          loadBalancer.splice(i + 1, 1); // remove the next item, it's the same as the current one and it has transition type 'link'
          console.log("loadBalancer second splice", loadBalancer);
        } else {
          loadBalancer.splice(i + 1, 1); // remove the next item, it's the same as the current one or it has transition type 'link'
          console.log("loadBalancer third splice", loadBalancer);
        }
      } else {
        i++; // if the URLs, tabId or windowId are not the same, move on to the next item
      }
    } else {
      i++; // if the URLs are not the same, move on to the next item
    }
  }
}

// adding domaindId and urlId to each entry -- NEW
async function appendIdsToEntry(loadBalancer) {
  for (const entry of loadBalancer) {
    console.log("inside appendIdsToEntry - entry", entry);
    console.log("inside appendIdsToEntry - entry.url", entry.url);

    try {
      // Get the domainId and urlId from the server
      const domainId = await retry(() => getDomainId(entry.url));
      console.log("domainId in appendIdsToEntry", domainId);

      const urlId = await retry(() => getUrlId(entry.url, domainId));
      console.log("urlId in appendIdsToEntry", urlId);

      // Append the domain_id and url_id
      entry.domain_id = domainId;
      entry.url_id = urlId;
    } catch (error) {
      console.error("Error appending domainId and urlId to entry:", error);
    }
  }
}

// upload URLs
function uploadAll(loadBalancer) {
  //update the chrome.tabs.get function
  // updateActivatedTab();

  console.log("inside uploadAll");
  loadBalancer.forEach(async (urlObject) => {
    const { supabaseAccessToken, supabaseExpiration, userId } =
      await getSupabaseKeys();
    validateToken(supabaseAccessToken, supabaseExpiration);
    await uploadHistory(supabaseAccessToken, userId, urlObject);
  });
  console.log("this should be the end");
}

// capturing the activatedTab info
chrome.tabs.onActivated.addListener(async (activeTab) => {
  console.log("activeTab.tabId", activeTab.tabId);
  console.log("activeTab.windowId", activeTab.windowId);
  activatedTab.tabId = activeTab.tabId;

  chrome.tabs.get(activeTab.tabId, async (tab) => {
    console.log("tab info on the activated tab", tab);

    activatedTab.lastQueryTime = Date.now();
    activatedTab.info = tab;

    console.log("activatedTab", activatedTab);
  });
});

// capturing the highlightedTab info
chrome.tabs.onHighlighted.addListener(async (onHighlightedTab) => {
  console.log("highlightedTab.tabIds", onHighlightedTab.tabIds);
  console.log("highlightedTab.windowId", onHighlightedTab.windowId);

  chrome.tabs.get(onHighlightedTab.tabIds[0], async (tab) => {
    console.log("tab info on the highlighted tab", tab);

    highlightedTab.lastQueryTime = Date.now();
    highlightedTab.info = tab;
    highlightedTab.tabId = tab.id;
  });
});

// updating the activatedTab info
async function updateActivatedTab() {
  chrome.tabs.get(activatedTab.tabId, async (tab) => {
    console.log("tab info on the activated tab", tab);
    console.log("let's break it test");

    activatedTab.lastQueryTime = Date.now();
    activatedTab.info = tab;
    activatedTab.tabId = tab.id;

    console.log(
      "activatedTab in the updateActivatedTab function",
      activatedTab
    );
  });
}

// updating the highlightedTab info
async function updateHighlightedTab() {
  chrome.tabs.get(highlightedTab.tabId, async (tab) => {
    console.log("tab info on the highlighted tab", tab);
    console.log("let's break it test");

    highlightedTab.lastQueryTime = Date.now();
    highlightedTab.info = tab;
    highlightedTab.tabId = tab.id;

    console.log(
      "highlightedTab in the updateHighlightedTab function",
      highlightedTab
    );
  });
}

// query the last historyItem to add the link information before it needs to be updated
async function queryByTimeTabIdAndWindowId(
  supabaseAccessToken,
  time,
  tabId,
  objectToPush2,
  tabWindowId
) {
  const SUPABASE_URL_ = `https://veedcagxcbafijuaremr.supabase.co/rest/v1/historyItems?select=*&time=lte.${time}&tabId=eq.${tabId}&tabWindowId=eq.${tabWindowId}&order=time.desc`;

  const response = await fetch(SUPABASE_URL_, {
    method: "GET",
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      Range: "0-1",
    },
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(
      `HTTP error! status: ${response.status}, message: ${errorResponse.message}`
    );
  }

  const data = await response.json();
  // const referralUrlId = data[0].id;
  console.log("data from queryByTimeAndTabId", data);
  // console.log("referralUrlId", referralUrlId);
  if (data.length > 0) {
    objectToPush2.link.source = data[0].id;
    objectToPush2.link.target = objectToPush2.id;
    // we don't need this anymore
    // const { supabaseAccessToken, supabaseExpiration } = await getSupabaseKeys();
    // validateToken(supabaseAccessToken, supabaseExpiration);
    // updateLink(data[0].id, objectId, supabaseAccessToken);
  }

  if (data.length == 0) {
    if (
      objectToPush2.linkTransition != "openInNewTab" ||
      objectToPush2.linkTransition != "generated" ||
      objectToPush2.linkTransition != "typed"
    ) {
      if (objectToPush2.tabWindowLength == 1) {
        objectToPush2.linkTransition = "newWindow";

        newWindowLinkAppend(time, objectToPush2);
      }
    }
  }

  return data;
}

// when a newWindow event is detected this gets appended
async function newWindowLinkAppend(time, objectToPush2) {
  const { supabaseAccessToken, supabaseExpiration } = await getSupabaseKeys();
  validateToken(supabaseAccessToken, supabaseExpiration);

  // const SUPABASE_URL_ = `https://veedcagxcbafijuaremr.supabase.co/rest/v1/historyItems?select=*&time=lte.${time}&tabId=eq&order=time.desc`;
  const SUPABASE_URL_ = `https://veedcagxcbafijuaremr.supabase.co/rest/v1/historyItems?select=*&time=lte.${time}&order=time.desc`;

  const response = await fetch(SUPABASE_URL_, {
    method: "GET",
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      Range: "0-1",
    },
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(
      `HTTP error! status: ${response.status}, message: ${errorResponse.message}`
    );
  }

  const data = await response.json();
  // const referralUrlId = data[0].id;
  console.log("data from queryByTimeAndTabId", data);
  // console.log("referralUrlId", referralUrlId);

  objectToPush2.link.source = data[0].id;
  objectToPush2.link.target = objectToPush2.id;

  return data;
}

// when a newTab linkTransition is detected, the link data gets appended to the objectToPush2 object
async function newTabLinkAppend(time, objectToPush2, windowId) {
  const { supabaseAccessToken, supabaseExpiration } = await getSupabaseKeys();
  validateToken(supabaseAccessToken, supabaseExpiration);

  // const SUPABASE_URL_ = `https://veedcagxcbafijuaremr.supabase.co/rest/v1/historyItems?select=*&time=lte.${time}&tabId=eq&order=time.desc`;
  const SUPABASE_URL_ = `https://veedcagxcbafijuaremr.supabase.co/rest/v1/historyItems?select=*&time=lte.${time}&tabWindowId=eq.${windowId}&order=time.desc`;

  const response = await fetch(SUPABASE_URL_, {
    method: "GET",
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      Range: "0-1",
    },
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(
      `HTTP error! status: ${response.status}, message: ${errorResponse.message}`
    );
  }

  const data = await response.json();
  // const referralUrlId = data[0].id;
  console.log("data from queryByTimeAndTabId", data);
  // console.log("referralUrlId", referralUrlId);

  if (data[0] != undefined && data.length > 0) {
    objectToPush2.link.source = data[0].id;
    objectToPush2.link.target = objectToPush2.id;
  }

  return data;
}

// create a new session
async function createNewSession(baseTime) {
  const { supabaseAccessToken, supabaseExpiration, userId } =
    await getSupabaseKeys();
  validateToken(supabaseAccessToken, supabaseExpiration);

  const SUPABASE_URL_ =
    "https://veedcagxcbafijuaremr.supabase.co/rest/v1/browsingSessions";

  const randomId = uuidv4();

  // move on from this method
  /* activeSession.id = randomId;
  activeSession.user_id = userId;

  activeSession.startTime = baseTime;
  // this value will continue to get updated every 30 seconds
  activeSession.endTime = baseTime + 120000; */

  // Prepare the session data
  const sessionData = {
    id: randomId,
    user_id: userId,
    startTime: baseTime,
    endTime: baseTime + 120000,
  };

  console.log("inside createNewSession");

  const response = await fetch(SUPABASE_URL_, {
    method: "POST",
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(sessionData),
  });

  // I don't think will be needed anymore
  // activeSession = sessionData;

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(
      `HTTP error! status: ${response.status}, message: ${errorResponse.message}`
    );
  }

  return sessionData;
}

// update the EndSessionTime
async function updateEndSession(sessionId) {
  const { supabaseAccessToken, supabaseExpiration } = await getSupabaseKeys();
  validateToken(supabaseAccessToken, supabaseExpiration);

  /* const sessionId = activeSession.id; // Get the ID of the session to update */
  const SUPABASE_URL_ = `https://veedcagxcbafijuaremr.supabase.co/rest/v1/browsingSessions?id=eq.${sessionId}`; // Use a horizontal filter in the URL
  const endTimeQuantity = Date.now() + 120000; // Set the new endTime to 2 minutes from now

  const response = await fetch(SUPABASE_URL_, {
    method: "PATCH", // Change method to PATCH for updating
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ endTime: endTimeQuantity }), // Update endTime to the current timestamp
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(
      `HTTP error! status: ${response.status}, message: ${errorResponse.message}`
    );
  }
}

// get the last active session from the endSession
async function getLastActiveSession(baseTime) {
  const { supabaseAccessToken, supabaseExpiration } = await getSupabaseKeys();
  validateToken(supabaseAccessToken, supabaseExpiration);

  const SUPABASE_URL_ = `https://veedcagxcbafijuaremr.supabase.co/rest/v1/browsingSessions?select=*&order=startTime.desc`;

  const response = await fetch(SUPABASE_URL_, {
    method: "GET",
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      Range: "0",
    },
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(
      `HTTP error! status: ${response.status}, message: ${errorResponse.message}`
    );
  }

  const data = await response.json();
  console.log("data from getActiveSessionFromServer", data);

  if (!data[0]) {
    // I don't think we're doing any more local saves
    // resetActiveSession();
    const newSession = await createNewSession(baseTime);
    return newSession.id;
  }

  if (data[0].endTime < baseTime) {
    // I don't think we're doing any more local saves
    // resetActiveSession();
    const newSession = await createNewSession(baseTime);
    return newSession.id; // You might want to return something here
  }

  if (data[0].endTime > baseTime) {
    updateEndSession(data[0].id);
    return data[0].id;
  }

  // this is the old method
  /* if (data[0] != undefined || (data[0] != null && data.length > 0)) {
    if (data[0].endTime < baseTime) {
      resetActiveSession();
      createNewSession(baseTime);
    }

    if (data[0].endTime > baseTime) {
      // by grabbing the session from the server it puts less emphasis on the local storage
      // activeSession = data[0];

      updateEndSession(data[0].id);
      return data[0].id;
    }
  } */
}

// domainId from the domain table
async function getDomainId(urlObject) {
  const { supabaseAccessToken, supabaseExpiration } = await getSupabaseKeys();
  validateToken(supabaseAccessToken, supabaseExpiration);

  console.log("getDomainId urlObject", urlObject);
  //strip url to the domain
  const domainToCheck = normalizeDomain(urlObject);

  const SUPABASE_URL_ = `https://veedcagxcbafijuaremr.supabase.co/rest/v1/domains?select=*&domain=eq.${domainToCheck}`;

  const response = await fetch(SUPABASE_URL_, {
    method: "GET",
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      Range: "0",
    },
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(
      `HTTP error! status: ${response.status}, message: ${errorResponse.message}`
    );
  }

  const data = await response.json();

  // return domainId if it exists
  if (data && data.length > 0) {
    return data[0].id; // assuming 'id' is the name of the field containing the domain id
  }

  console.log("domainToCheck", domainToCheck);

  // If no domain found, create a new one
  const newDomainId = await createDomainId(domainToCheck);

  return newDomainId;
}

// create a new domain
async function createDomainId(domainToUpload) {
  const { supabaseAccessToken, supabaseExpiration, userId } =
    await getSupabaseKeys();
  validateToken(supabaseAccessToken, supabaseExpiration);

  console.log("createDomainId - domainToUpload", domainToUpload);

  const SUPABASE_URL_ =
    "https://veedcagxcbafijuaremr.supabase.co/rest/v1/domains";

  const domainId = uuidv4();

  const domainObject = {
    id: domainId,
    domain: domainToUpload,
    user_id: userId,
  };

  console.log("inside createNewSession");

  const response = await fetch(SUPABASE_URL_, {
    method: "POST",
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(domainObject),
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(
      `HTTP error! status: ${response.status}, message: ${errorResponse.message}`
    );
  }

  // Return the ID of the newly created domain
  return domainId;
}

// urlId from the url table -- New Version
async function getUrlId(urlObject, domainId) {
  const { supabaseAccessToken, supabaseExpiration } = await getSupabaseKeys();
  validateToken(supabaseAccessToken, supabaseExpiration);

  const urlToCheck = normalizeURL(urlObject);
  console.log("urlToCheck in getUrlId", urlToCheck);

  //slight modification to the url
  const encodedUrlToCheck = encodeURIComponent(urlToCheck);

  // had just urlToCheck before
  const SUPABASE_URL_ = `https://veedcagxcbafijuaremr.supabase.co/rest/v1/urls?select=*&url=eq.${encodedUrlToCheck}&domain_id=eq.${domainId}`;
  console.log("SUPABASE_URL_", SUPABASE_URL_);
  console.log("urlToCheck:", urlToCheck);
  console.log("domainId:", domainId);

  const response = await fetch(SUPABASE_URL_, {
    method: "GET",
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      Range: "0",
    },
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(
      `HTTP error! status: ${response.status}, message: ${errorResponse.message}`
    );
  }

  const data = await response.json();

  // Check if data is an array and if it has any elements
  if (Array.isArray(data) && data.length > 0) {
    const urlId = data[0].id;
    if (!urlId) {
      console.error("No id property in data[0]:", data[0]);
      throw new Error("No id property in data[0]");
    }
    return urlId;
  } else if (Array.isArray(data) && data.length === 0) {
    const newUrlId = await createUrlId(urlObject, domainId);
    if (!newUrlId) {
      console.error("createUrlId did not return a new urlId");
      throw new Error("createUrlId did not return a new urlId");
    }
    console.log("a new urlId was created");
    return newUrlId;
  } else {
    console.error("Unexpected data format from Supabase:", data);
    throw new Error("Unexpected data format from Supabase");
  }
}

// create a new urlId for the url table
async function createUrlId(url, domainId) {
  const { supabaseAccessToken, supabaseExpiration, userId } =
    await getSupabaseKeys();
  validateToken(supabaseAccessToken, supabaseExpiration);

  const SUPABASE_URL_ = "https://veedcagxcbafijuaremr.supabase.co/rest/v1/urls";

  const normalizedUrl = normalizeURL(url);
  console.log("normalizedUrl inside createUrlId", normalizedUrl);

  const urlId = uuidv4();

  const urlObject = {
    id: urlId,
    domain_id: domainId,
    user_id: userId,
    url: normalizedUrl,
  };

  console.log("inside createNewSession");

  const response = await fetch(SUPABASE_URL_, {
    method: "POST",
    headers: {
      apikey: import.meta.env.VITE_APP_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${supabaseAccessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(urlObject),
  });

  if (!response.ok) {
    const errorResponse = await response.json();
    throw new Error(
      `HTTP error! status: ${response.status}, message: ${errorResponse.message}`
    );
  }

  return urlId;
}
