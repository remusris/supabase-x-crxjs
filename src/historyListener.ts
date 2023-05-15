// history listener - tried and true method with an activeTab query that seems to fail but is SYNCHRONOUS
chrome.history.onVisited.addListener(function (historyItem) {
  isActiveSessionChecker(historyItem);
  objectToPush.push(Object.assign(historyItem, { type: "historyItem" }));
  // objectToPush2.push(Object.assign(historyItem, {type: "historyItem"}))
  historyItemList.push(Object.assign(historyItem, { type: "historyItem" }));
  console.log("marker - historyItemList", historyItemList);
  console.log("1");

  //query tab with new URL
  chrome.tabs.query(
    { url: historyItem.url },
    //query the tabItem
    function (tab) {
      if (tab[0] != undefined) {
        objectToPush.push(Object.assign(tab[0], { type: "tabItem" }));
        // objectToPush2.push(Object.assign(tab[0], {type: "tabItem"}))
        tabItemList.push(Object.assign(tab[0], { type: "tabItem" }));
        console.log("2");
        console.log("tabWindowId check event listener", tab[0].windowId);
        console.log("tabId check event listener", tab[0].id);
        //tab.length query
        if (tab[0].windowId != undefined) {
          chrome.tabs.query({ windowId: tab[0].windowId }, function (tab) {
            // objectToPush.push(Object.assign({tabLength: tab.length}, {type: "windowTabLength"}))
            for (let i = 0, ie = objectToPush.length; i < ie; i++) {
              if (objectToPush[i].type == "tabItem") {
                Object.assign(objectToPush[i], { tabLength: tab.length });
                // Object.assign(objectToPush2[i], {tabLength: tab.length})
                //this could be added to the main doc instead
              }
            }
            console.log("tabLength", tab.length);
            console.log("3");
          });
        }
      }

      //query the active tab
      chrome.tabs.query(
        { active: true, lastFocusedWindow: true },
        function (tab) {
          console.log("activeTab was queried");
          if (tab[0] != undefined) {
            objectToPush.push(Object.assign(tab[0], { type: "activeTabItem" }));
            activeTabItemList.push(
              Object.assign(tab[0], { type: "activeTabItem" })
            );
            console.log("4");
            console.log("activeTabId check event listener", tab[0].id);
            console.log(
              "activeTabWindowId check event listener",
              tab[0].windowId
            );
          }
        }
      );
    }
  );

  //get visitItem data
  chrome.history.getVisits({ url: historyItem.url }, function (visitItem) {
    for (let i = 0, ie = visitItem.length; i < ie; i++) {
      if (
        visitItem[i].visitTime >= historyItem.lastVisitTime &&
        visitItem[i].id == historyItem.id
      ) {
        objectToPush.push(Object.assign(visitItem[i], { type: "visitItem" }));
        // objectToPush2.push(Object.assign(visitItem[i], {type: "visitItem"}))
        visitItemList.push(Object.assign(visitItem[i], { type: "visitItem" }));
        visitItemList.push({ marker: "indicator" });
        console.log(visitItemList);
        console.log("5");
      }
    }

    console.log("6");

    if (objectToPush.length != 0) {
      // old way below
      /* massConsoleLogger();     
        // objectToPush2.push({marker: "indicator"})
        supabaseUploader(objectToPush);
        // console.log("second ObjectToPush2", objectToPush2)
        console.log("7"); */

      try {
        console.log("historyItem inside");

        // uploadHistory(historyItem, supabaseAccessToken, userId);
        // supabaseUploader(objectToPush);

        // console.log("URL uploaded successfully:", historyItem.url);
      } catch (error) {
        handleError(error);
      }
    }
  });
});

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

async function historyTabQuery(url) {
  const tabs = await promisify(chrome.tabs.query)({ url: url });
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

    // Call the supabase uploader function here
    // supabaseUploader(objectToPush2);
  } catch (error) {
    // Handle any errors that occurred in any of the promises
    console.error(error);
  }
});
