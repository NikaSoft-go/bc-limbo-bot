// Check if we've already initialized to prevent duplicate declarations
if (typeof window.bcGameLimboTrackerInitialized === "undefined") {
  window.bcGameLimboTrackerInitialized = true

  // Store the last known limbo values to detect changes
  let lastLimboValues = []
  let isObservingLimboValues = false
  let limboValueObserver = null
  let pageFullyLoaded = false
  let extensionContextValid = true
  let localLimboData = [] // Store data locally when disconnected

  // Store the last bet amount and cashout values
  let lastBetAmount = null
  let lastCashoutAt = null

  // Game state tracking
  let currentGameState = {
    isCollecting: false,
    currentMultiplier: null,
    playerCount: null,
    gameStartTime: null,
    isInBettingPhase: false, // Track if we're in the betting phase
  }

  // Configuration for stability detection
  const IGNORE_FIRST_GAME = true // Whether to ignore the first game when starting collection

  // Function to check if extension context is valid
  function isExtensionContextValid() {
    try {
      // This will throw an error if the context is invalid
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
        return true
      } else {
        return false
      }
    } catch (error) {
      return false
    }
  }

  // Function to log messages
  function log(message) {
    // console.log(`[Limbo Tracker] ${message}`)
  }

  // Function to log errors
  function logError(message) {
    // console.error(`[Limbo Tracker] ${message}`)
  }

  // Function to safely send messages to background
  function safelySendMessage(message) {
    return new Promise((resolve) => {
      // Check if extension context is valid before attempting to send message
      if (!isExtensionContextValid()) {
        extensionContextValid = false
        resolve({ success: false, error: "Extension context invalidated" })
        return
      }

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            logError(`Message error: ${chrome.runtime.lastError.message}`)
            resolve({ success: false, error: chrome.runtime.lastError.message })
          } else {
            resolve(response || { success: true })
          }
        })
      } catch (error) {
        extensionContextValid = false
        logError(`Failed to send message: ${error.message}`)
        resolve({ success: false, error: error.message })
      }
    })
  }

  // Function to check if the page is fully loaded
  function checkPageLoaded() {
    // Check for game elements to confirm the game is loaded
    const gameElements =
      document.querySelector(".grid-auto-flow-column") ||
      document.querySelector(".input.font-extrabold") ||
      document.querySelector(".button.button-brand.button-m.w-full.p-2")
    return !!gameElements
  }

  // Function to properly parse a limbo value string
  function parseLimboValue(valueText) {
    if (!valueText) return null

    // Remove any non-numeric characters except dots and commas
    const cleanedValue = valueText.replace(/[^\d.,]/g, "")

    // Replace commas with dots if needed
    const normalizedValue = cleanedValue.replace(/,/g, ".")

    // Parse the value
    const multiplier = Number.parseFloat(normalizedValue)

    if (!isNaN(multiplier)) {
      return multiplier
    }

    return null
  }

  // Function to parse money amount (e.g., "$10,594.02")
  function parseMoneyAmount(amountText) {
    if (!amountText) return null

    // Remove currency symbol and any non-numeric characters except dots and commas
    const cleanedValue = amountText.replace(/[^\d.,]/g, "")

    // Replace commas with dots if needed for decimal, but handle thousand separators
    // This is a simplified approach and might need adjustment based on locale
    let normalizedValue = cleanedValue
    if (cleanedValue.indexOf(",") < cleanedValue.indexOf(".")) {
      // Format like $1,234.56
      normalizedValue = cleanedValue.replace(/,/g, "")
    } else if (cleanedValue.indexOf(",") > cleanedValue.indexOf(".")) {
      // Format like $1.234,56
      normalizedValue = cleanedValue.replace(/\./g, "").replace(/,/g, ".")
    } else if (cleanedValue.indexOf(",") >= 0 && cleanedValue.indexOf(".") === -1) {
      // Format like $1,234
      normalizedValue = cleanedValue.replace(/,/g, "")
    } else if (cleanedValue.indexOf(".") >= 0 && cleanedValue.indexOf(",") === -1) {
      // Format like $1.234
      normalizedValue = cleanedValue
    }

    // Parse the value
    const amount = Number.parseFloat(normalizedValue)

    if (!isNaN(amount)) {
      return amount
    }

    return null
  }

  // Function to format multiplier with 2 decimal places
  function formatMultiplier(value) {
    return Number(value).toFixed(2)
  }

  // Function to extract all limbo values from BCGame UI
  function extractLimboValues() {
    // Look for the grid that contains limbo values
    const limboGrid = document.querySelector(".grid.grid-auto-flow-column.gap-1")
    if (!limboGrid) {
      log("No limbo grid found")
      return []
    }

    // Find all limbo value elements within the grid
    // Each limbo value is in a span with class containing "text-left whitespace-nowrap font-extrabold"
    const valueElements = limboGrid.querySelectorAll(
      "span",
    )
    if (valueElements.length === 0) {
      log("No limbo value elements found")
      return []
    }

    // Extract values from each element
    const values = []
    valueElements.forEach((element) => {
      const valueText = element.textContent.trim()
      const multiplier = parseLimboValue(valueText)

      if (multiplier !== null) {
        values.push(multiplier)
      }
    })

    if (values.length > 0) {
      log(`Found ${values.length} limbo values: ${values.slice(0, 5).join(", ")}...`)
    } else {
      log("No limbo values found in elements")
    }

    // Reverse the array so the newest value is at index 0
    return values.reverse()
  }

  // Function to check if the game is in betting phase
  function isInBettingPhase() {
    try {
      // Check if the bet button exists and doesn't have a "Next Round" span
      const betButton = document.querySelector(".button.button-brand.button-m.w-full.p-2")
      if (!betButton) {
        log("Bet button not found")
        return false
      }

      const buttonText = betButton.textContent.trim()
      const isDisabled = betButton.hasAttribute("disabled");

      // Also check if the button text is "Bet" (not "Next Round" or something else)
      const isBetButton = buttonText === "Bet";
      
      const result = isBetButton && !isDisabled;
      // console.log(`Button text: "${buttonText}", Is disabled: ${isDisabled}, Can bet: ${result}`);
      return result
    } catch (error) {
      logError(`Error checking betting phase: ${error.message}`)
      return false
    }
  }

  // Function to check if limbo values have changed and handle game state
  function checkForNewLimboValues() {
    const currentValues = extractLimboValues()

    if (currentValues.length === 0) {
      return null
    }

    // If we don't have previous values, consider all current values as new
    if (lastLimboValues.length === 0) {
      log(`Initial limbo values detected: ${currentValues.slice(0, 5).join(", ")}...`)

      // Update last known values
      lastLimboValues = [...currentValues]

      // If we're ignoring the first game when starting collection, don't return data
      if (IGNORE_FIRST_GAME && currentGameState.isCollecting) {
        log("Ignoring first game as requested")
        currentGameState.isCollecting = false
        return null
      }

      // Return the latest value as new data
      const now = new Date()
      return {
        multiplier: currentValues[0],
        timestamp: now.getTime(),
        dateTime: `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`,
      }
    }

    // Check if the pattern has changed (new value added)
    if (currentValues.length !== lastLimboValues.length) {
      log(`Limbo values count changed: ${currentValues.length} (previous: ${lastLimboValues.length})`)

      // Update last known values
      lastLimboValues = [...currentValues]

      const now = new Date()
      return {
        multiplier: currentValues[0],
        timestamp: now.getTime(),
        dateTime: `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`,
      }
    }

    return null
  }

  // Function to set input value using a more robust approach
  function setInputValue(input, value) {
    if (!input) return false

    try {
      // Try multiple approaches

      // 1. Use the Object.getOwnPropertyDescriptor approach
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set

      nativeInputValueSetter.call(input, value.toString())

      // 2. Dispatch events
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new Event("change", { bubbles: true }))

      // 3. Try to find and update any React or Vue component properties
      // This is a more advanced approach that tries to find the component instance
      for (const key in input) {
        if (key.startsWith("__reactProps$") || key.startsWith("__reactEventHandlers$")) {
          // This might be a React component
          const reactKey = key
          const reactProps = input[reactKey]

          if (reactProps && typeof reactProps.onChange === "function") {
            // Create a synthetic event
            const syntheticEvent = {
              target: { value: value.toString() },
              currentTarget: { value: value.toString() },
              preventDefault: () => {},
              stopPropagation: () => {},
            }

            // Call the onChange handler
            reactProps.onChange(syntheticEvent)
            log(`Called React onChange handler for ${input.name || "input"}`)
          }
        }
      }

      // 4. Try to use the valueAsNumber property for number inputs
      if (input.type === "number" || input.inputMode === "decimal") {
        input.valueAsNumber = Number.parseFloat(value)
      }

      return true
    } catch (error) {
      logError(`Error setting input value: ${error.message}`)
      return false
    }
  }

  // Function to place a bet with specified amount and cashout
  function placeBet(amount, cashoutAt) {
    log(`Attempting to place bet: Amount=${amount}, Cashout=${cashoutAt}`)

    // Check if we're in the betting phase
    if (!isInBettingPhase()) {
      log("Cannot place bet - game is not in betting phase")
      return false
    }

    // Store the values for persistence
    lastBetAmount = amount
    lastCashoutAt = cashoutAt

    // Find the bet amount input with the specific attributes
    const amountInput = document.querySelector('input[inputmode="decimal"][size="lg"]')
    const amountInputContainer = document.querySelector(".input.font-extrabold.pr-1.nowidth-input")

    if (amountInput) {
      log("Found amount input field")

      // Focus and click the input first
      amountInput.focus()
      amountInput.click()

      // Try to set the value using our robust approach
      const amountSuccess = setInputValue(amountInput, amount)

      if (amountSuccess) {
        log(`Set amount to: ${amount}`)
      } else {
        log("Failed to set amount using standard methods, trying alternative approaches")

        // Try clicking the container and then setting the value
        if (amountInputContainer) {
          amountInputContainer.click()
          setTimeout(() => {
            setInputValue(amountInput, amount)
          }, 100)
        }
      }
    } else {
      log("Amount input field not found")
      return false
    }

    // Set cashout value - find the input in the cashout container
    const cashoutInputAmount = document.querySelector(".relative.font-extrabold input:not([disabled])");
    const cashoutContainer = document.querySelector(".relative.font-extrabold")

    if (cashoutInputAmount) {
      log("Found cashout input field")

      // Focus and click the input first
      cashoutInputAmount.focus()
      cashoutInputAmount.click()

      // Try to set the value using our robust approach
      const cashoutSuccess = setInputValue(cashoutInputAmount, cashoutAt)

      if (cashoutSuccess) {
        log(`Set cashout to: ${cashoutAt}`)
      } else {
        log("Failed to set cashout using standard methods, trying alternative approaches")

        // Try clicking the container and then setting the value
        if (cashoutContainer) {
          cashoutContainer.click()
          setTimeout(() => {
            setInputValue(cashoutInputAmount, cashoutAt)
          }, 100)
        }
      }
    } else {
      log("Cashout input field not found")
      return false
    }

    // Click the bet button
    const betButton = document.querySelector(".button.button-brand.button-m.w-full.p-2")

    if (betButton) {
      betButton.click()
      return true
    } else {
      log("Bet button not found")
      return false
    }
  }

  // Function to restore bet values if they've been reset
  function restoreBetValues() {
    if (!lastBetAmount || !lastCashoutAt) return

    const amountInput = document.querySelector('input[inputmode="decimal"][size="lg"]')
    const cashoutInput = document.querySelector(".relative.font-extrabold input:not([disabled])")

    if (amountInput && amountInput.value === "" && lastBetAmount !== "") {
      log(`Restoring bet amount to ${lastBetAmount}`)
      setInputValue(amountInput, lastBetAmount)
    }

    if (cashoutInput && cashoutInput.value === "" && lastCashoutAt !== "") {
      log(`Restoring cashout to ${lastCashoutAt}`)
      setInputValue(cashoutInput, lastCashoutAt)
    }
  }

  // Function to observe limbo values
  function startObservingLimboValues() {
    if (isObservingLimboValues) return true
    log("Starting to observe limbo values")

    try {
      // Initialize game state
      currentGameState = {
        isCollecting: true,
        currentMultiplier: null,
        playerCount: null,
        gameStartTime: Date.now(),
        isInBettingPhase: isInBettingPhase(),
      }

      // Get initial limbo values
      const initialValues = extractLimboValues()
      if (initialValues.length > 0) {
        lastLimboValues = [...initialValues]
        log(`Initialized with ${initialValues.length} limbo values. Latest: ${initialValues[0]}x`)

        // If we're ignoring the first game, don't send initial value
        if (IGNORE_FIRST_GAME) {
          log("Ignoring first game as requested")
        } else {
          // Send initial value
          const now = new Date()
          const initialData = {
            multiplier: initialValues[0],
            timestamp: now.getTime(),
            dateTime: `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`,
          }

          if (isExtensionContextValid()) {
            safelySendMessage({
              action: "newLimboData",
              data: [initialData],
            })
          } else {
            localLimboData.push(initialData)
          }
        }
      }

      const targetNode = document.body
      const config = { childList: true, subtree: true, characterData: true }

      limboValueObserver = new MutationObserver((mutations) => {
        // Check for new limbo values
        const newData = checkForNewLimboValues()

        // Check if bet values need to be restored
        restoreBetValues()

        if (newData) {
          // Check extension context before sending
          if (isExtensionContextValid()) {
            try {
              safelySendMessage({
                action: "newLimboData",
                data: [newData], // Send as array for consistency with background script
              })
            } catch (error) {
              extensionContextValid = false
              log(`Error sending limbo data: ${error.message}`)

              // Store locally since we can't send to background
              localLimboData.push(newData)
              log(`Stored limbo value locally: ${newData.multiplier}x. Total: ${localLimboData.length}`)
            }
          } else {
            // Store locally since extension context is invalid
            localLimboData.push(newData)
            log(`Stored limbo value locally: ${newData.multiplier}x. Total: ${localLimboData.length}`)
          }
        }
      })

      limboValueObserver.observe(targetNode, config)
      isObservingLimboValues = true

      // Set up an interval to periodically check and restore bet values
      setInterval(restoreBetValues, 1000)

      return true
    } catch (error) {
      logError(`Error starting observer: ${error.message}`)
      return false
    }
  }

  // Create a status indicator element
  function createStatusIndicator() {
    const statusDiv = document.createElement("div")
    statusDiv.id = "bcgame-tracker-status"
    statusDiv.style.position = "fixed"
    statusDiv.style.bottom = "10px"
    statusDiv.style.right = "10px"
    statusDiv.style.backgroundColor = "rgba(0, 0, 0, 0.7)"
    statusDiv.style.color = "#fff"
    statusDiv.style.padding = "5px 10px"
    statusDiv.style.borderRadius = "5px"
    statusDiv.style.fontSize = "12px"
    statusDiv.style.zIndex = "9999"
    statusDiv.style.display = "none"
    document.body.appendChild(statusDiv)

    return statusDiv
  }

  // Update status indicator
  function updateStatusIndicator() {
    const statusDiv = document.getElementById("bcgame-tracker-status") || createStatusIndicator()

    if (!extensionContextValid) {
      statusDiv.style.display = "block"
      statusDiv.style.backgroundColor = "rgba(255, 0, 0, 0.7)"
      statusDiv.textContent = `Limbo Tracker: Disconnected (${localLimboData.length} values stored locally)`
    } else {
      statusDiv.style.display = "none"
    }
  }

  let statusCheckInterval = null

  // Periodically check extension context and update status
  function startStatusCheck() {
    if (statusCheckInterval) return

    statusCheckInterval = setInterval(() => {
      // Check if extension context is valid
      const wasValid = extensionContextValid
      extensionContextValid = isExtensionContextValid()

      // If status changed, update the indicator
      if (wasValid !== extensionContextValid) {
        log(`Extension context ${extensionContextValid ? "restored" : "invalidated"}`)

        // If context was restored, try to send any locally stored data
        if (extensionContextValid && localLimboData.length > 0) {
          log(`Attempting to send ${localLimboData.length} locally stored limbo values`)

          try {
            safelySendMessage({
              action: "newLimboData",
              data: localLimboData,
            }).then((response) => {
              if (response.success) {
                log(`Successfully sent ${localLimboData.length} locally stored limbo values`)
                localLimboData = []
              }
            })
          } catch (error) {
            extensionContextValid = false
            logError(`Failed to send locally stored data: ${error.message}`)
          }
        }
      }

      updateStatusIndicator()
    }, 5000) // Check every 5 seconds
  }

  // Function to extract user's current balance
  function extractUserBalance() {
    try {
      // Try multiple selectors to find the balance element
      const selectors = [
        // Main selector from previous implementation
        ".relative.mr-1.flex.cursor-pointer.select-none.items-center.ml-1\\.5.flex-auto",
        // Alternative selectors to try
        ".flex.items-center.cursor-pointer",
        ".font-extrabold.flex.items-center",
        ".font-extrabold.text-base",
      ]

      let balanceText = null

      // Try each selector until we find a balance
      for (const selector of selectors) {
        const element = document.querySelector(selector)
        if (element) {
          // Get text content from this element or its children
          const text = element.textContent.trim()

          // Check if the text contains a number
          if (/\d/.test(text)) {
            balanceText = text
            log(`Found balance text with selector "${selector}": ${balanceText}`)
            break
          }
        }
      }

      if (!balanceText) {
        log("Balance element not found with any selector")
        return null
      }

      // Extract just the number part, regardless of currency position
      // This regex looks for any number with optional decimal places
      const balanceMatch = balanceText.match(/(\d+(?:[.,]\d+)?)/)

      if (balanceMatch) {
        // Replace comma with dot if needed
        const balanceStr = balanceMatch[0].replace(",", ".")
        const balanceValue = Number.parseFloat(balanceStr)
        log(`Extracted balance value: ${balanceValue}`)
        return balanceValue
      } else {
        log("Could not extract number from balance text")
        return null
      }
    } catch (error) {
      logError(`Error extracting balance: ${error.message}`)
      return null
    }
  }

  // Listen for messages from background script
  try {
    // Ensure chrome is defined before using it
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // Ping action to check if content script is ready
        if (request.action === "ping") {
          sendResponse({ success: true, message: "Content script is ready" })
          return true
        } else if (request.action === "getLimboData") {
          // Check if page is fully loaded
          if (!pageFullyLoaded) {
            pageFullyLoaded = checkPageLoaded()
            if (!pageFullyLoaded) {
              log("Page not fully loaded yet, can't get limbo data")
              sendResponse({ success: false, error: "Page not fully loaded" })
              return true
            }
          }

          // Get current limbo values
          const currentValues = extractLimboValues()

          // Create data object for the latest value if it exists
          const now = new Date()
          const data =
            currentValues.length > 0
              ? [
                  {
                    multiplier: currentValues[0],
                    timestamp: now.getTime(),
                    dateTime: `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`,
                  },
                ]
              : []

          // If we have locally stored data and extension context is valid, include it
          if (extensionContextValid && localLimboData.length > 0) {
            log(`Including ${localLimboData.length} locally stored limbo values`)
            const combinedData = [...data, ...localLimboData]
            localLimboData = [] // Clear local data after sending
            sendResponse({ success: true, data: combinedData })
          } else {
            sendResponse({ success: true, data })
          }

          return true
        } else if (request.action === "startMonitoring") {
          // Check if page is fully loaded
          pageFullyLoaded = checkPageLoaded()
          if (pageFullyLoaded) {
            const success = startObservingLimboValues()
            sendResponse({ success })
          } else {
            log("Page not fully loaded yet, will start monitoring when ready")
            sendResponse({ success: false, error: "Page not fully loaded" })
          }
          return true
        } else if (request.action === "placeBet") {
          // Check if page is fully loaded
          if (!pageFullyLoaded) {
            pageFullyLoaded = checkPageLoaded()
            if (!pageFullyLoaded) {
              log("Page not fully loaded yet, can't place bet")
              sendResponse({ success: false, error: "Page not fully loaded" })
              return true
            }
          }

          // Check if we're in betting phase
          if (!isInBettingPhase()) {
            log("Cannot place bet - game is not in betting phase")
            sendResponse({ success: false, error: "Game is not in betting phase" })
            return true
          }

          const success = placeBet(request.amount, request.cashoutAt)
          sendResponse({ success })
          return true
        } else if (request.action === "getBalance") {
          // Always try to get the balance, even if page isn't fully loaded
          const balance = extractUserBalance()
          sendResponse({ success: true, balance: balance })
          return true
        } else if (request.action === "getGameState") {
          // Return the current game state including betting phase
          currentGameState.isInBettingPhase = isInBettingPhase()
          sendResponse({
            success: true,
            isInBettingPhase: currentGameState.isInBettingPhase,
          })
          return true
        }
      })
    }
  } catch (error) {
    extensionContextValid = false
    logError(`Error setting up message listener: ${error.message}`)
  }

  // Initialize observer when script loads
  try {
    if (document.readyState === "complete") {
      log("Document already complete, setting up observers")
      pageFullyLoaded = checkPageLoaded()
      if (pageFullyLoaded) {
        // Don't automatically start observing - wait for user to click Start Collection
        log("Page loaded, but waiting for user to start collection")
      }
    } else {
      log("Document not complete, waiting for load event")
      window.addEventListener("load", () => {
        log("Document loaded, setting up observers")
        pageFullyLoaded = checkPageLoaded()
        if (pageFullyLoaded) {
          // Don't automatically start observing - wait for user to click Start Collection
          log("Page loaded, but waiting for user to start collection")
        }
      })
    }

    // Start status check
    startStatusCheck()

    // Create initial status indicator
    createStatusIndicator()
  } catch (error) {
    logError(`Error initializing content script: ${error.message}`)
  }

  // Log that we've initialized
  log("Content script initialized for BCGame")
}
