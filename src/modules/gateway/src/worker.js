// Derived from YouTube Digest (MIT); see LICENSE and NOTICE.
export function mountWorker(api) {
  const DEBUG = false;
  const debugLog = () => {};
  async function closePanelForTab(tabId, windowId) {
    // Chrome 141 added an explicit close API. On older supported versions,
    // disabling the tab-specific panel below remains the compatibility path.
    if (typeof chrome.sidePanel.close !== "function") return;

    try {
      // This closes the tab-specific panel used by YouTube Scaffold.
      await chrome.sidePanel.close({ tabId });
      return;
    } catch (error) {
      // Chrome 145+ rejects tabId when the visible instance is global. Close
      // that instance by window instead.
    }

    if (Number.isInteger(windowId)) {
      await chrome.sidePanel.close({ windowId }).catch(() => {});
    }
  }
  async function updatePanelForTab(tabId, url, windowId) {
    const isYouTube = (url || "").startsWith("https://www.youtube.com");
    if (!isYouTube) {
      // Close the visible instance first. Then disable this tab so Chrome cannot
      // reopen the global default panel as navigation settles.
      await closePanelForTab(tabId, windowId);
      await chrome.sidePanel
        .setOptions({ tabId, enabled: false })
        .catch(() => {});
      return;
    }

    // setOptions can reject if the tab just closed. Ignore that harmlessly.
    await chrome.sidePanel
      .setOptions({ tabId, path: "sidepanel.html", enabled: true })
      .catch(() => {});
  }
  function getNavigationUrl(changeInfo, tab) {
    if (changeInfo.url) return changeInfo.url;
    if (changeInfo.status !== "loading" && changeInfo.status !== "complete") {
      return "";
    }
    return tab.pendingUrl || tab.url || "";
  }
  async function getPlayerVideoDetails(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          try {
            const player = document.getElementById("movie_player");
            const details = player?.getPlayerResponse?.()?.videoDetails;
            if (!details) return null;
            return {
              title: details.title || "",
              channelName: details.author || "",
              description: details.shortDescription || "",
              duration: Number(details.lengthSeconds) || 0,
            };
          } catch (e) {
            return null;
          }
        },
      });
      return results?.[0]?.result || null;
    } catch (e) {
      console.warn(
        "[YouTube Scaffold BG] Player details unavailable:",
        e.message,
      );
      return null;
    }
  }
  async function handleGetVideoInfo(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        action: "getVideoInfo",
      });
      return response;
    } catch (error) {
      return { title: "", channelName: "", description: "" };
    }
  }
  chrome.storage.local
    .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch((error) =>
      console.warn(
        "[YouTube Scaffold] Could not restrict storage access:",
        error,
      ),
    );
  chrome.action.onClicked.addListener((tab) => {
    if (!(tab.url || "").startsWith("https://www.youtube.com")) {
      void updatePanelForTab(tab.id, tab.url, tab.windowId);
      return;
    }

    // Re-enable + open without awaiting — preserves user gesture context
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "sidepanel.html",
      enabled: true,
    });
    chrome.sidePanel.open({ tabId: tab.id });
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === "install") chrome.runtime.openOptionsPage();
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = getNavigationUrl(changeInfo, tab);
    if (!url) return; // Ignore title and favicon-only updates.
    void updatePanelForTab(tabId, url, tab.windowId);
  });
  chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      void updatePanelForTab(tabId, tab.url || tab.pendingUrl, windowId);
    } catch (e) {
      // Tab vanished before we could read it — nothing to do.
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id && sender.id !== chrome.runtime.id) {
      sendResponse({ success: false, error: "Invalid sender" });
      return false;
    }
    // Extension options opened in a normal tab also have sender.tab.
    // Trust the exact extension origin, never the absence of a tab object.
    const trusted = !!sender.url?.startsWith(chrome.runtime.getURL(""));
    if (
      !trusted &&
      sender.tab &&
      !["saveNote", "openSidePanel", "checkConfig"].includes(message.action)
    ) {
      sendResponse({ success: false, error: "Untrusted action" });
      return false;
    }
    if (message.action === "getVideoInfo") {
      handleGetVideoInfo(message.tabId)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }
    if (message.action === "openOptions") {
      chrome.runtime.openOptionsPage();
      sendResponse({ success: true });
      return false;
    }
    if (message.action === "openSidePanel") {
      const tabId = sender.tab?.id;
      debugLog(
        "[YouTube Scaffold BG] openSidePanel requested from tab:",
        tabId,
      );

      // Re-enable the panel (it may have been disabled by auto-close) and open it.
      // IMPORTANT: we call setOptions + open synchronously (no await between them)
      // to preserve the user gesture context. Chrome requires sidePanel.open()
      // to be called within a user gesture — awaiting anything first can expire it.
      if (tabId) {
        chrome.sidePanel.setOptions({
          tabId,
          path: "sidepanel.html",
          enabled: true,
        });
        chrome.sidePanel
          .open({ tabId })
          .then(() => {
            // Broadcast to side panel to start digest (in case it's already open)
            setTimeout(() => {
              chrome.runtime
                .sendMessage({ action: "startDigestFromButton" })
                .catch(() => {});
            }, 300);
          })
          .catch((err) => {
            console.error("[YouTube Scaffold BG] openSidePanel error:", err);
          });
      } else {
        // Fallback: find the active tab
        chrome.tabs
          .query({ active: true, lastFocusedWindow: true })
          .then((tabs) => {
            if (tabs[0]) {
              chrome.sidePanel.setOptions({
                tabId: tabs[0].id,
                path: "sidepanel.html",
                enabled: true,
              });
              chrome.sidePanel.open({ tabId: tabs[0].id }).catch((err) => {
                console.error(
                  "[YouTube Scaffold BG] openSidePanel fallback error:",
                  err,
                );
              });
            }
          });
      }

      sendResponse({ success: true });
      return false;
    }
    if (message.action === "relayToContent") {
      debugLog("[YouTube Scaffold BG] Relay request:", message.payload?.action);
      (async () => {
        try {
          // Query specifically for YouTube tabs to avoid side panel context issues
          // Try multiple query strategies to find the right tab
          let tabs = await chrome.tabs.query({
            active: true,
            lastFocusedWindow: true,
          });
          debugLog(
            "[YouTube Scaffold BG] Active tab in last focused window:",
            tabs.length,
            tabs[0]?.url,
          );

          if (message.targetTabId) {
            const target = await chrome.tabs.get(message.targetTabId);
            tabs = [target];
          }
          if (tabs[0]) {
            const actual = new URL(tabs[0].url || "about:blank");
            if (
              actual.origin !== "https://www.youtube.com" ||
              (message.expectedVideoId &&
                actual.searchParams.get("v") !== message.expectedVideoId)
            )
              throw new Error("Video target changed");
          }
          if (tabs[0]) {
            debugLog(
              "[YouTube Scaffold BG] Sending to tab:",
              tabs[0].id,
              "URL:",
              tabs[0].url,
            );
            let response = await chrome.tabs.sendMessage(
              tabs[0].id,
              message.payload,
            );

            // For getVideoInfo, PREFER YouTube's own player data over the
            // DOM scrape. The player's videoDetails is canonical: its `author`
            // is always THIS video's channel and its `shortDescription` is the
            // full text. The DOM scrape is unreliable — e.g. on a playlist page
            // it grabbed the playlist owner's name ("Zara Zhang") instead of the
            // real channel ("Replit and Stripe"), and its description is
            // truncated while the box is collapsed. We fall back to the DOM
            // only for fields the player didn't provide.
            if (message.payload?.action === "getVideoInfo") {
              const playerInfo = await getPlayerVideoDetails(tabs[0].id);
              if (playerInfo) {
                response = {
                  title: playerInfo.title || response?.title || "",
                  channelName:
                    playerInfo.channelName || response?.channelName || "",
                  duration: playerInfo.duration || response?.duration || 0,
                  description:
                    playerInfo.description || response?.description || "",
                };
              }
            }

            debugLog(
              "[YouTube Scaffold BG] Got response from content:",
              response,
            );
            sendResponse({ success: true, response });
          } else {
            debugLog("[YouTube Scaffold BG] No YouTube tab found");
            sendResponse({ success: false, error: "No YouTube tab found" });
          }
        } catch (err) {
          console.error("[YouTube Scaffold BG] Relay error:", err.message);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // Keep channel open for async response
    }
    api
      .dispatch(message, {
        trusted,
        sourceUrl: trusted ? null : sender.tab?.url || null,
      })
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  });
}
