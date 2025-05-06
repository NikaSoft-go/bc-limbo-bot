/**
 * BCGame Limbo Tracker - Background Script
 * Optimized version with better organization, error handling, and performance
 */

// ===== STATE MANAGEMENT =====
const state = {
  // Limbo data collection
  isMonitoring: false,
  lastLimboValueTime: 0,
  
  // Auto-betting
  isAutoBetting: false,
  currentBetAmount: 0,
  consecutiveFailures: 0,
  waitingForGameEnd: false,
  lastBetTime: 0,
  currentBalance: 0,
  
  // Settings
  autoBetSettings: {
    basicAmount: 1.0,
    cashoutAt: 2.0,
    maxLimit: 0,
    minLimit: 0,
  },
  
  // Timers
  timers: {
    autoBet: null,
    betPlacementAttempt: null,
    keepAlive: null,
    balanceCheck: null
  }
};

// ===== STORAGE OPERATIONS =====
const storage = {
  /**
   * Save limbo data to storage
   * @param {Array} data - Array of limbo data objects
   * @returns {Promise<boolean>} - True if new data was added
   */
  saveData: async (data) => {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(["limboHistory"], (result) => {
          const existingData = result.limboHistory || [];
          
          // Filter out duplicates with a more efficient approach
          const existingMap = new Map();
          existingData.forEach(item => {
            // Create a unique key for each item
            const key = `${Math.floor(item.timestamp)}_${item.multiplier.toFixed(2)}`;
            existingMap.set(key, true);
          });
          
          // Filter new data using the map for O(1) lookups
          const uniqueNewData = data.filter(item => {
            const key = `${Math.floor(item.timestamp)}_${item.multiplier.toFixed(2)}`;
            if (existingMap.has(key)) return false;
            existingMap.set(key, true);
            return true;
          });
          
          if (uniqueNewData.length === 0) {
            resolve(false);
            return;
          }
          
          const updatedData = [...existingData, ...uniqueNewData];
          chrome.storage.local.set({ limboHistory: updatedData }, () => {
            resolve(true);
          });
        });
      } catch (error) {
        console.error("Error saving data:", error);
        resolve(false);
      }
    });
  },
  
  /**
   * Clear all limbo data
   * @returns {Promise<boolean>} - True if successful
   */
  clearData: async () => {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ limboHistory: [] }, () => {
          resolve(true);
        });
      } catch (error) {
        console.error("Error clearing data:", error);
        resolve(false);
      }
    });
  },
  
  /**
   * Save current state to storage
   * @param {Object} stateUpdate - State properties to update
   */
  saveState: (stateUpdate = {}) => {
    try {
      chrome.storage.local.set(stateUpdate);
    } catch (error) {
      console.error("Error saving state:", error);
    }
  },
  
  /**
   * Load state from storage
   * @returns {Promise<void>}
   */
  loadState: async () => {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([
          "isMonitoring",
          "isAutoBetting",
          "autoBetSettings",
          "currentBetAmount",
          "consecutiveFailures",
          "waitingForGameEnd",
        ], (result) => {
          // Update state with stored values
          state.isMonitoring = result.isMonitoring === true;
          state.isAutoBetting = result.isAutoBetting === true;
          state.waitingForGameEnd = result.waitingForGameEnd === true;
          
          if (result.autoBetSettings) {
            state.autoBetSettings = result.autoBetSettings;
          }
          
          if (result.currentBetAmount !== undefined) {
            state.currentBetAmount = result.currentBetAmount;
          }
          
          if (result.consecutiveFailures !== undefined) {
            state.consecutiveFailures = result.consecutiveFailures;
          }
          
          console.log(`Loaded state - Monitoring: ${state.isMonitoring ? "active" : "inactive"}, Auto-betting: ${state.isAutoBetting ? "active" : "inactive"}`);
          resolve();
        });
      } catch (error) {
        console.error("Error loading state:", error);
        resolve();
      }
    });
  }
};

// ===== TAB & CONTENT SCRIPT MANAGEMENT =====
const tabManager = {
  /**
   * Safely send message to a tab
   * @param {number} tabId - Tab ID to send message to
   * @param {Object} message - Message to send
   * @returns {Promise<Object>} - Response from content script
   */
  sendMessage: async (tabId, message) => {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            console.log(`Error sending message: ${chrome.runtime.lastError.message}`);
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: "No response" });
          }
        });
      } catch (error) {
        console.error("Error in sendMessage:", error);
        resolve({ success: false, error: error.message });
      }
    });
  },
  
  /**
   * Check if content script is ready in a tab
   * @param {number} tabId - Tab ID to check
   * @returns {Promise<boolean>} - True if content script is ready
   */
  isContentScriptReady: async (tabId) => {
    try {
      const response = await tabManager.sendMessage(tabId, { action: "ping" });
      return response.success;
    } catch (error) {
      return false;
    }
  },
  
  /**
   * Ensure content script is injected and ready
   * @param {number} tabId - Tab ID to inject into
   * @returns {Promise<boolean>} - True if content script is ready
   */
  ensureContentScriptReady: async (tabId) => {
    // First check if content script is already ready
    const isReady = await tabManager.isContentScriptReady(tabId);
    if (isReady) return true;
    
    // If not ready, try to inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"]
      });
      
      // Wait a bit for the script to initialize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check again if it's ready
      return await tabManager.isContentScriptReady(tabId);
    } catch (error) {
      console.error("Error injecting content script:", error);
      return false;
    }
  },
  
  /**
   * Find active limbo game tab
   * @returns {Promise<Object|null>} - Tab object or null if not found
   */
  findLimboTab: async () => {
    try {
      const tabs = await chrome.tabs.query({ url: "https://bc.game/game/limbo*" });
      return tabs.length > 0 ? tabs[0] : null;
    } catch (error) {
      console.error("Error finding limbo tab:", error);
      return null;
    }
  },
  
  /**
   * Check if game is in betting phase
   * @param {number} tabId - Tab ID to check
   * @returns {Promise<boolean>} - True if in betting phase
   */
  isInBettingPhase: async (tabId) => {
    try {
      const response = await tabManager.sendMessage(tabId, { action: "getGameState" });
      return response?.success && response.isInBettingPhase === true;
    } catch (error) {
      console.error("Error checking betting phase:", error);
      return false;
    }
  }
};

// ===== LIMBO DATA COLLECTION =====
const limboTracker = {
  /**
   * Collect and save limbo data from active tab
   * @param {Object} tab - Tab object to collect from
   * @returns {Promise<Object>} - Result of collection
   */
  collectAndSaveLimboData: async (tab) => {
    try {
      // Check if tab is valid and on the correct page
      if (!tab || !tab.url || !tab.url.includes("bc.game/game/limbo")) {
        return { success: false, error: "Not on BCGame limbo page" };
      }
      
      // Ensure content script is ready
      const isReady = await tabManager.ensureContentScriptReady(tab.id);
      if (!isReady) {
        return { success: false, error: "Content script not ready" };
      }
      
      // Send message to content script to get limbo data
      const response = await tabManager.sendMessage(tab.id, { action: "getLimboData" });
      
      if (response?.success) {
        const saved = await storage.saveData(response.data);
        if (saved) {
          console.log("New limbo data saved successfully");
          // Update the last limbo value time
          state.lastLimboValueTime = Date.now();
          
          // Send message to update popup if it's open
          try {
            chrome.runtime.sendMessage({ action: "newDataAvailable" });
          } catch (error) {
            // Ignore errors when popup is not open
            console.log("Error notifying popup (probably not open):", error.message);
          }
          
          // Process new limbo data for auto-betting
          if (state.isAutoBetting && response.data.length > 0) {
            autoBetting.processLimboValue(response.data[0].multiplier);
          }
        }
        return { success: saved, count: response.data.length };
      }
      return { success: false, error: response.error || "Failed to get limbo data" };
    } catch (error) {
      console.error("Error collecting limbo data:", error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Start real-time monitoring
   * @returns {Promise<Object>} - Result of starting monitoring
   */
  startMonitoring: async () => {
    if (state.isMonitoring) return { success: true, message: "Already running" };
    
    state.isMonitoring = true;
    console.log("Started real-time monitoring");
    
    // Save monitoring state
    storage.saveState({ isMonitoring: true });
    
    // Start the keep-alive interval
    if (!state.timers.keepAlive) {
      state.timers.keepAlive = setInterval(limboTracker.checkAndUpdateTabs, 30000); // Check every 30 seconds
    }
    
    // Start the balance check interval if auto-betting is active
    if (state.isAutoBetting && !state.timers.balanceCheck) {
      state.timers.balanceCheck = setInterval(autoBetting.updateBalance, 5000); // Check every 5 seconds
    }
    
    // Notify any active tabs to start monitoring
    try {
      const tabs = await chrome.tabs.query({ url: "https://bc.game/game/limbo*" });
      
      if (tabs.length === 0) {
        return { success: true, message: "No limbo tabs found, will monitor when available" };
      }
      
      let successCount = 0;
      for (const tab of tabs) {
        const isReady = await tabManager.ensureContentScriptReady(tab.id);
        if (isReady) {
          const response = await tabManager.sendMessage(tab.id, { action: "startMonitoring" });
          if (response.success) successCount++;
        }
      }
      
      return {
        success: true,
        message: `Monitoring started on ${successCount} of ${tabs.length} tabs`
      };
    } catch (error) {
      console.error("Error starting monitoring:", error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Stop real-time monitoring
   */
  stopMonitoring: () => {
    if (state.isMonitoring) {
      state.isMonitoring = false;
      console.log("Stopped real-time monitoring");
      
      // Save monitoring state
      storage.saveState({ isMonitoring: false });
      
      // Clear the keep-alive interval
      if (state.timers.keepAlive) {
        clearInterval(state.timers.keepAlive);
        state.timers.keepAlive = null;
      }
      
      // Clear the balance check interval
      if (state.timers.balanceCheck) {
        clearInterval(state.timers.balanceCheck);
        state.timers.balanceCheck = null;
      }
    }
  },
  
  /**
   * Check and update tabs for monitoring
   */
  checkAndUpdateTabs: async () => {
    if (!state.isMonitoring) return;
    
    console.log("Keep-alive check: monitoring is active");
    
    // Check for any limbo tabs and ensure they're monitoring
    chrome.tabs.query({ url: "https://bc.game/game/limbo*" }, async (tabs) => {
      if (tabs.length > 0) {
        for (const tab of tabs) {
          const isReady = await tabManager.ensureContentScriptReady(tab.id);
          if (isReady) {
            tabManager.sendMessage(tab.id, { action: "startMonitoring" });
          }
        }
      }
    });
  }
};

// ===== AUTO-BETTING =====
const autoBetting = {
  /**
   * Start auto-betting with given settings
   * @param {Object} settings - Auto-betting settings
   * @returns {Object} - Result of starting auto-betting
   */
  start: (settings) => {
    limboTracker.startMonitoring()

    if (state.isAutoBetting) {
      return { success: true, message: "Auto-betting already running" };
    }
    
    // Save settings
    state.autoBetSettings = settings;
    
    // Reset martingale variables
    state.currentBetAmount = settings.basicAmount;
    state.consecutiveFailures = 0;
    state.waitingForGameEnd = false;
    
    // Set flag
    state.isAutoBetting = true;
    
    // Save state to storage
    storage.saveState({
      isAutoBetting: true,
      autoBetSettings: settings,
      currentBetAmount: state.currentBetAmount,
      consecutiveFailures: state.consecutiveFailures,
      waitingForGameEnd: state.waitingForGameEnd,
    });
    
    console.log("Auto-betting started, waiting for current game to end");
    
    // Set up timer to check if it's time to place a bet
    if (state.timers.autoBet) {
      clearInterval(state.timers.autoBet);
    }
    
    state.timers.autoBet = setInterval(autoBetting.checkBetTiming, 500);
    
    // Start balance check timer
    if (!state.timers.balanceCheck) {
      state.timers.balanceCheck = setInterval(autoBetting.updateBalance, 1000);
    }

    limboTracker.startMonitoring()

    setTimeout(() => {
      autoBetting.attemptToPlaceBet();
    }, 100); // Small delay to ensure everything is initialized
    
    return { success: true, message: "Auto-betting started" };
  },
  
  /**
   * Stop auto-bettings
   * @returns {Object} - Result of stopping auto-betting
   */
  stop: () => {
    if (!state.isAutoBetting) {
      return { success: true, message: "Auto-betting already stopped" };
    }
    
    // Clear timers
    if (state.timers.autoBet) {
      clearInterval(state.timers.autoBet);
      state.timers.autoBet = null;
    }
    
    if (state.timers.betPlacementAttempt) {
      clearInterval(state.timers.betPlacementAttempt);
      state.timers.betPlacementAttempt = null;
    }
    
    if (state.timers.balanceCheck) {
      clearInterval(state.timers.balanceCheck);
      state.timers.balanceCheck = null;
    }
    
    // Reset flags
    state.isAutoBetting = false;
    state.waitingForGameEnd = false;
    
    // Save state to storage
    storage.saveState({
      isAutoBetting: false,
      waitingForGameEnd: false,
      consecutiveFailures: 0,
      currentBetAmount: state.autoBetSettings.basicAmount,
    });

    limboTracker.stopMonitoring()
    
    return { success: true, message: "Auto-betting stopped" };
  },
  
  /**
   * Check if it's time to place a bet
   */
  checkBetTiming: async () => {
    if (!state.isAutoBetting) return;
    
    if (state.waitingForGameEnd) {
      // Still waiting for current game to end
      console.log("Still waiting for current game to end...");
      return;
    }
    
    // Check balance limits
    if (autoBetting.checkBalanceLimits()) {
      return; // Limits reached, auto-betting stopped
    }
  },
  
  /**
   * Check if balance limits have been reached
   * @returns {boolean} - True if limits reached and auto-betting stopped
   */
  checkBalanceLimits: () => {
    // Check if balance has reached or exceeded the max limit
    if (state.autoBetSettings.maxLimit > 0 && state.currentBalance >= state.autoBetSettings.maxLimit) {
      console.log(`Max limit reached (${state.currentBalance} >= ${state.autoBetSettings.maxLimit}), stopping auto-betting`);
      autoBetting.stop();
      try {
        chrome.runtime.sendMessage({
          action: "limitReached",
          balance: state.currentBalance,
          limit: state.autoBetSettings.maxLimit,
          isMaxLimit: true
        });
      } catch (error) {
        console.log("Error notifying popup of max limit (probably not open):", error.message);
      }
      return true;
    }
    
    // Check if balance has fallen below the min limit
    if (state.autoBetSettings.minLimit > 0 && state.currentBalance < state.autoBetSettings.minLimit) {
      console.log(`Min limit reached (${state.currentBalance} < ${state.autoBetSettings.minLimit}), stopping auto-betting`);
      autoBetting.stop();
      try {
        chrome.runtime.sendMessage({
          action: "limitReached",
          balance: state.currentBalance,
          limit: state.autoBetSettings.minLimit,
          isMaxLimit: false
        });
      } catch (error) {
        console.log("Error notifying popup of min limit (probably not open):", error.message);
      }
      return true;
    }
    
    return false;
  },
  
  /**
   * Attempt to place a bet with retries
   */
  attemptToPlaceBet: async () => {
    // Clear any existing attempt timer
    if (state.timers.betPlacementAttempt) {
      clearInterval(state.timers.betPlacementAttempt);
    }
    
    // Get active limbo tab
    const tab = await tabManager.findLimboTab();
    if (!tab) {
      console.log("No limbo tabs found for auto-betting");
      return;
    }
    
    const isReady = await tabManager.ensureContentScriptReady(tab.id);
    if (!isReady) {
      console.error("Content script not ready for auto-betting");
      return;
    }
    
    // Check if we're in betting phase
    const inBettingPhase = await tabManager.isInBettingPhase(tab.id);
    if (!inBettingPhase) {
      console.log("Not in betting phase, will retry in 0.5 second");
      
      // Set up a timer to retry placing the bet
      state.timers.betPlacementAttempt = setInterval(async () => {
        // Check if we're still auto-betting
        if (!state.isAutoBetting) {
          clearInterval(state.timers.betPlacementAttempt);
          state.timers.betPlacementAttempt = null;
          return;
        }
        
        // Check if we're in betting phase now
        const nowInBettingPhase = await tabManager.isInBettingPhase(tab.id);
        if (nowInBettingPhase) {
          console.log("Now in betting phase, attempting to place bet");
          clearInterval(state.timers.betPlacementAttempt);
          state.timers.betPlacementAttempt = null;
          autoBetting.placeBet();
        } else {
          console.log("Still not in betting phase, will retry");
        }
      }, 500); // Check every second
      
      return;
    }
    
    // If we are in betting phase, place the bet immediately
    autoBetting.placeBet();
  },
  
  /**
   * Place a bet with the strategy settings
   */
  placeBet: async () => {
    // Get active limbo tab
    const tab = await tabManager.findLimboTab();
    if (!tab) {
      console.log("No limbo tabs found for auto-betting");
      return;
    }
    
    // Check balance limits before placing bet
    if (autoBetting.checkBalanceLimits()) {
      return; // Limits reached, auto-betting stopped
    }
    
    // Save current bet amount to storage
    storage.saveState({
      currentBetAmount: state.currentBetAmount,
      waitingForGameEnd: false,
      consecutiveFailures: state.consecutiveFailures,
    });
    
    // Place the bet
    const isReady = await tabManager.ensureContentScriptReady(tab.id);
    
    if (isReady) {
      console.log(`Placing auto bet: Amount=${state.currentBetAmount.toFixed(2)}, Cashout=${state.autoBetSettings.cashoutAt.toFixed(2)}`);
      
      const response = await tabManager.sendMessage(tab.id, {
        action: "placeBet",
        amount: state.currentBetAmount,
        cashoutAt: state.autoBetSettings.cashoutAt
      });
      
      if (response?.success) {
        state.lastBetTime = Date.now(); // Update the last bet time
        console.log(`Auto bet placed: ${state.currentBetAmount.toFixed(2)} @ ${state.autoBetSettings.cashoutAt.toFixed(2)}x`);
        
        // Set waiting for game end flag to true
        state.waitingForGameEnd = true;
        
        // Save state to storage
        storage.saveState({
          lastBetTime: state.lastBetTime,
          waitingForGameEnd: true,
        });
      } else {
        console.error(`Failed to place auto bet: ${response?.error || "Unknown error"}`);
        
        // If the error is because the game is not in betting phase, try again later
        if (response?.error === "Game is not in betting phase") {
          console.log("Will retry placing bet when game is in betting phase");
          autoBetting.attemptToPlaceBet();
        }
      }
    } else {
      console.error("Content script not ready for auto-betting");
    }
  },
  
  /**
   * Process a new limbo value for auto-betting
   * @param {number} newLimboValue - The new limbo value
   */
  processLimboValue: (newLimboValue) => {
    // Check if this affects our bet
    if (state.isAutoBetting) {
      // Check bet result if we have an active bet
      console.log(`Checking bet result: Limbo value ${newLimboValue}x, Cashout at ${state.autoBetSettings.cashoutAt}x`);
      
      // Only process if we're waiting for a game end
      if (state.waitingForGameEnd) {
        // Check if our bet is below 1.1
        if (newLimboValue < 1.1) {
          state.currentBetAmount = state.currentBetAmount == 0 ? state.autoBetSettings.basicAmount : state.currentBetAmount * 2
        } else {
          state.currentBetAmount = 0
        }
        autoBetting.attemptToPlaceBet();

        storage.saveState({
          currentBetAmount: state.currentBetAmount,
          consecutiveFailures: state.consecutiveFailures,
        });
        
        // Reset waiting for game end flag
        state.waitingForGameEnd = false;
      }
    }
  },
  
  /**
   * Update current balance
   */
  updateBalance: async () => {
    if (!state.isAutoBetting) return;
    
    try {
      const tab = await tabManager.findLimboTab();
      if (!tab) return;
      
      const isReady = await tabManager.ensureContentScriptReady(tab.id);
      if (!isReady) return;
      
      const response = await tabManager.sendMessage(tab.id, { action: "getBalance" });
      
      if (response?.success && response.balance !== null) {
        state.currentBalance = response.balance;
        console.log(`Updated current balance: ${state.currentBalance.toFixed(2)}`);
        
        // Check balance limits
        autoBetting.checkBalanceLimits();
      }
    } catch (error) {
      console.error("Error updating balance:", error);
    }
  }
};

// ===== EVENT LISTENERS =====

// Set up content script when tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url?.includes("bc.game/game/limbo")) {
    console.log("Tab updated, injecting content script");
    
    // Wait a bit for the page to fully load before injecting
    setTimeout(async () => {
      try {
        const isReady = await tabManager.ensureContentScriptReady(tabId);
        if (isReady && state.isMonitoring) {
          tabManager.sendMessage(tabId, { action: "startMonitoring" });
        }
      } catch (error) {
        console.error("Error setting up content script:", error);
      }
    }, 3000); // 3 second delay
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "newLimboData") {
    storage.saveData(request.data).then((saved) => {
      if (saved) {
        console.log("New limbo data saved from content script");
        // Update the last limbo value time
        state.lastLimboValueTime = Date.now();
        
        try {
          chrome.runtime.sendMessage({ action: "newDataAvailable" });
          
          // Process new limbo data for auto-betting
          if (request.data.length > 0) {
            autoBetting.processLimboValue(request.data[0].multiplier);
          }
        } catch (error) {
          // Ignore errors when popup is not open
          console.log("Error notifying popup (probably not open):", error.message);
        }
      }
    });
  } else if (request.action === "log") {
    console.log("Content script log:", request.message);
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startAutoBetting") {
    const result = autoBetting.start(request.settings);
    sendResponse(result);
    return true;
  } else if (request.action === "stopAutoBetting") {
    const result = autoBetting.stop();
    sendResponse(result);
    return true;
  } else if (request.action === "getAutoBettingStatus") {
    sendResponse({
      isAutoBetting: state.isAutoBetting,
      currentBetAmount: state.currentBetAmount,
      consecutiveFailures: state.consecutiveFailures,
      waitingForGameEnd: state.waitingForGameEnd,
      lastBetTime: state.lastBetTime,
      settings: state.autoBetSettings,
      currentBalance: state.currentBalance,
    });
    return true;
  } else if (request.action === "getStatus") {
    sendResponse({
      isRunning: state.isMonitoring,
      interval: "realtime"
    });
    return true;
  } else if (request.action === "getHistory") {
    try {
      chrome.storage.local.get(["limboHistory"], (result) => {
        sendResponse({ history: result.limboHistory || [] });
      });
    } catch (error) {
      console.error("Error getting history:", error);
      sendResponse({ history: [] });
    }
    return true; // Indicates async response
  } else if (request.action === "placeBet") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0] && tabs[0].url?.includes("bc.game/game/limbo")) {
        // Ensure content script is ready
        const isReady = await tabManager.ensureContentScriptReady(tabs[0].id);
        if (!isReady) {
          sendResponse({ success: false, error: "Content script not ready" });
          return;
        }
        
        const response = await tabManager.sendMessage(tabs[0].id, {
          action: "placeBet",
          amount: request.amount,
          cashoutAt: request.cashoutAt
        });
        
        sendResponse(response);
      } else {
        sendResponse({ success: false, error: "Not on BCGame limbo page" });
      }
    });
    return true;
  } else if (request.action === "getBalance") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0] && tabs[0].url?.includes("bc.game/game/limbo")) {
        // Ensure content script is ready
        const isReady = await tabManager.ensureContentScriptReady(tabs[0].id);
        if (!isReady) {
          sendResponse({ success: false, error: "Content script not ready" });
          return;
        }
        
        const response = await tabManager.sendMessage(tabs[0].id, {
          action: "getBalance"
        });
        
        if (response?.success && response.balance !== null) {
          // Update our stored balance
          state.currentBalance = response.balance;
        }
        
        sendResponse(response);
      } else {
        sendResponse({ success: false, error: "Not on BCGame limbo page" });
      }
    });
    return true;
  } else if (request.action === "clearHistory") {
    try {
      chrome.storage.local.set({ limboHistory: [] }, () => {
        sendResponse({ success: true });
      });
    } catch (error) {
      console.error("Error clearing history:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  } else if (request.action === "downloadHistory") {
    try {
      chrome.storage.local.get(["limboHistory"], (result) => {
        sendResponse({
          success: true,
          data: result.limboHistory || [],
          filename: `bcgame_limbo_history_${new Date().toISOString().split("T")[0]}.json`
        });
      });
    } catch (error) {
      console.error("Error downloading history:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  } else if (request.action === "reloadContentScript") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ["content.js"]
          });
          sendResponse({ success: true });
        } catch (error) {
          console.error("Error reloading content script:", error);
          sendResponse({ success: false, error: error.message });
        }
      } else {
        sendResponse({ success: false, error: "No active tab" });
      }
    });
    return true;
  }
});

// ===== INITIALIZATION =====

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  // Set monitoring to false by default
  storage.saveState({ isMonitoring: false });
  console.log("Monitoring set to inactive by default");
  
  // Load saved state
  storage.loadState().then(() => {
    // If auto-betting was active, restart it
    if (state.isAutoBetting) {
      autoBetting.start(state.autoBetSettings);
    }
    
    // If monitoring was active, restart it
    if (state.isMonitoring) {
      limboTracker.startMonitoring()
        .then((result) => console.log("Monitoring restarted:", result))
        .catch((error) => console.error("Error restarting monitoring:", error));
    }
  });
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.isMonitoring) {
    state.isMonitoring = changes.isMonitoring.newValue;
  }
});

console.log("BCGame Limbo Tracker background script initialized");